import { NextRequest, NextResponse } from "next/server";
import { GitHubError, ensureRepo, listDir, writeFile } from "@/lib/github";
import { getActor, toErrorResponse, unauthorized } from "@/lib/session";
import {
  MAX_CODE_BYTES,
  extOf,
  isCodeFile,
  isSafeFilename,
  normalizeCode,
} from "@/lib/types";

/**
 * Source files a student writes in the browser editor.
 *
 * Notes go through /api/note and stay markdown; this route is its counterpart
 * for code, and refuses anything whose extension the editor does not know, so
 * it can never be used to overwrite a PDF or an image with text.
 *
 * A file is created either empty (with a small stub for the languages where an
 * empty file is useless) or from code the student pasted in — the same route
 * either way, because the only difference is where the first revision's text
 * came from.
 *
 * Like every other write path it ignores any caller-supplied owner: a file can
 * only ever land in the signed-in user's own vault.
 */

/** A few keystrokes saved on the languages where an empty file is useless. */
function starterFor(name: string): string {
  const ext = extOf(name);
  const stem = name.slice(0, name.length - ext.length - 1);

  switch (ext) {
    case "py":
    case "pyw":
      return 'def main():\n    print("Hello")\n\n\nif __name__ == "__main__":\n    main()\n';
    case "java":
      // The class has to match the filename, so only offer this when the stem
      // is actually a legal Java identifier.
      return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(stem)
        ? `public class ${stem} {\n    public static void main(String[] args) {\n        System.out.println("Hello");\n    }\n}\n`
        : "";
    case "c":
      return '#include <stdio.h>\n\nint main(void) {\n    printf("Hello\\n");\n    return 0;\n}\n';
    case "cpp":
    case "cc":
    case "cxx":
      return '#include <iostream>\n\nint main() {\n    std::cout << "Hello" << std::endl;\n    return 0;\n}\n';
    case "html":
    case "htm":
      return `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <title>${stem}</title>\n  </head>\n  <body>\n    <h1>${stem}</h1>\n  </body>\n</html>\n`;
    case "sh":
    case "bash":
      return "#!/usr/bin/env bash\nset -euo pipefail\n\n";
    case "json":
    case "jsonc":
      return "{\n}\n";
    default:
      return "";
  }
}

function tooLong(text: string): boolean {
  return Buffer.byteLength(text, "utf8") > MAX_CODE_BYTES;
}

/** Every other tool that touches the repo expects a trailing newline. */
function endWithNewline(text: string): string {
  return text === "" || text.endsWith("\n") ? text : `${text}\n`;
}

/**
 * Clean up text on its way in from a paste. Code copied out of a Windows
 * editor carries CRLF and code copied out of some web pages carries a BOM;
 * both would otherwise be committed verbatim and show up as noise in the diff
 * the first time the file is edited here.
 */
function fromPaste(text: string): string {
  return endWithNewline(text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n"));
}

/** Create a source file in one of my courses, empty or from pasted code. */
export async function POST(req: NextRequest) {
  const actor = await getActor();
  if (!actor) return unauthorized();

  const body = (await req.json().catch(() => null)) as {
    code?: string;
    name?: string;
    text?: string;
  } | null;

  const code = normalizeCode(body?.code ?? "");
  const name = (body?.name ?? "").trim();
  // Absent means "start from the template"; present but empty means the
  // student deliberately pasted nothing, which is a legitimate empty file.
  const pasted = typeof body?.text === "string" ? fromPaste(body.text) : null;

  if (!code) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (!isSafeFilename(name)) {
    return NextResponse.json(
      { error: "That filename has characters that aren't allowed" },
      { status: 400 },
    );
  }
  if (!isCodeFile(name)) {
    return NextResponse.json(
      {
        error: `The editor doesn't know the .${extOf(name) || "?"} format — give the file an extension like .py, .java or .c`,
      },
      { status: 400 },
    );
  }
  if (pasted !== null && tooLong(pasted)) {
    return NextResponse.json(
      { error: "That snippet is too big to save from the browser" },
      { status: 413 },
    );
  }

  try {
    await ensureRepo(actor.token, actor.owner);
    const existing = await listDir(actor.token, actor.owner, `courses/${code}`);
    if (existing.some((e) => e.name === name)) {
      return NextResponse.json(
        { error: `${code} already has a file called ${name}` },
        { status: 409 },
      );
    }

    const sha = await writeFile(
      actor.token,
      actor.owner,
      `courses/${code}/${name}`,
      pasted ?? starterFor(name),
      `Add ${name} to ${code}`,
    );
    return NextResponse.json({ ok: true, name, sha });
  } catch (e) {
    return toErrorResponse(e);
  }
}

/** Save the buffer that is open in the editor. */
export async function PUT(req: NextRequest) {
  const actor = await getActor();
  if (!actor) return unauthorized();

  const body = (await req.json().catch(() => null)) as {
    code?: string;
    name?: string;
    sha?: string;
    text?: string;
  } | null;

  const code = normalizeCode(body?.code ?? "");
  const name = body?.name ?? "";
  const sha = body?.sha ?? "";
  const text = body?.text ?? "";

  if (!code || !sha || !isSafeFilename(name)) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (!isCodeFile(name)) {
    return NextResponse.json(
      { error: "Only source files can be saved here" },
      { status: 400 },
    );
  }
  if (tooLong(text)) {
    return NextResponse.json(
      { error: "That file is too big to save from the browser" },
      { status: 413 },
    );
  }

  try {
    // An empty source file is a legitimate thing to save, so unlike a note
    // this does not insist on content.
    const next = endWithNewline(text);
    const newSha = await writeFile(
      actor.token,
      actor.owner,
      `courses/${code}/${name}`,
      next,
      `Update ${name} in ${code}`,
      sha,
    );
    return NextResponse.json({ ok: true, sha: newSha });
  } catch (e) {
    // GitHub rejects the write when the blob moved underneath us — someone
    // edited the same file on github.com, or in another tab.
    if (e instanceof GitHubError && (e.status === 409 || e.status === 422)) {
      return NextResponse.json(
        {
          error: `${name} changed somewhere else since you opened it. Close the tab and open it again to get the newer version.`,
          conflict: true,
        },
        { status: 409 },
      );
    }
    return toErrorResponse(e);
  }
}
