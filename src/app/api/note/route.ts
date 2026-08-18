import { NextRequest, NextResponse } from "next/server";
import { ensureRepo, listDir, writeFile } from "@/lib/github";
import { getActor, toErrorResponse, unauthorized } from "@/lib/session";
import { isSafeFilename, kindOf, normalizeCode, slugifyTitle } from "@/lib/types";

/**
 * Notes are written through the contents API, which sends the whole body as
 * base64 in a JSON payload. They are meant to be a few paragraphs, so cap them
 * well below anything that would strain that.
 */
const MAX_NOTE_BYTES = 100_000;

/** "Week 1 summary" -> "week-1-summary.md", avoiding names already in use. */
function uniqueNoteName(stem: string, taken: Set<string>): string {
  const first = `${stem}.md`;
  if (!taken.has(first)) return first;
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}.md`;
    if (!taken.has(candidate)) return candidate;
  }
}

function tooLong(text: string): boolean {
  return Buffer.byteLength(text, "utf8") > MAX_NOTE_BYTES;
}

/**
 * Write a new note into one of my courses.
 *
 * Deliberately ignores any caller-supplied owner: like every other write path,
 * a note can only ever land in the signed-in user's own vault.
 */
export async function POST(req: NextRequest) {
  const actor = await getActor();
  if (!actor) return unauthorized();

  const body = (await req.json().catch(() => null)) as {
    code?: string;
    title?: string;
    text?: string;
  } | null;

  const code = normalizeCode(body?.code ?? "");
  const title = (body?.title ?? "").trim();
  const text = (body?.text ?? "").trim();

  if (!code) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (!title && !text) {
    return NextResponse.json(
      { error: "Write a title or some words first" },
      { status: 400 },
    );
  }
  if (tooLong(text)) {
    return NextResponse.json(
      { error: "That note is too long — keep it under 100 KB" },
      { status: 413 },
    );
  }

  try {
    await ensureRepo(actor.token, actor.owner);
    const existing = await listDir(actor.token, actor.owner, `courses/${code}`);
    const name = uniqueNoteName(
      slugifyTitle(title || text.split("\n")[0] || "note"),
      new Set(existing.map((e) => e.name)),
    );

    // The title becomes an H1 so the note reads properly in the preview pane
    // and on github.com. Editing later works on the raw markdown.
    const content = title ? `# ${title}\n\n${text}\n` : `${text}\n`;

    await writeFile(
      actor.token,
      actor.owner,
      `courses/${code}/${name}`,
      content,
      `Add note ${name} to ${code}`,
    );
    return NextResponse.json({ ok: true, name });
  } catch (e) {
    return toErrorResponse(e);
  }
}

/** Update the text of a note I already wrote. */
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
  // Only notes are editable here — this must not become a way to overwrite a
  // PDF with text.
  if (kindOf(name) !== "markdown") {
    return NextResponse.json(
      { error: "Only notes can be edited here" },
      { status: 400 },
    );
  }
  if (!text.trim()) {
    return NextResponse.json(
      { error: "A note cannot be empty — delete it instead" },
      { status: 400 },
    );
  }
  if (tooLong(text)) {
    return NextResponse.json(
      { error: "That note is too long — keep it under 100 KB" },
      { status: 413 },
    );
  }

  try {
    await writeFile(
      actor.token,
      actor.owner,
      `courses/${code}/${name}`,
      text.endsWith("\n") ? text : `${text}\n`,
      `Update note ${name} in ${code}`,
      sha,
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return toErrorResponse(e);
  }
}
