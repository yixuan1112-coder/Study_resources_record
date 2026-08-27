import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile } from "@/lib/github";
import { getActor, resolveVault, toErrorResponse, unauthorized } from "@/lib/session";
import { isSafeFilename, kindOf, normalizeCode } from "@/lib/types";
import {
  MAX_ANNOTATIONS,
  annotationsPath,
  parseAnnotations,
  type AnnotationFile,
} from "@/lib/annotations";

/** Read the highlights on a PDF — mine, or a friend's shared vault. */
export async function GET(req: NextRequest) {
  const actor = await getActor();
  if (!actor) return unauthorized();

  const params = req.nextUrl.searchParams;
  const code = normalizeCode(params.get("code") ?? "");
  const name = params.get("name") ?? "";
  const vault = resolveVault(actor, params.get("owner"));

  if (!code || !vault || !isSafeFilename(name) || kindOf(name) !== "pdf") {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  try {
    const file = await readFile(
      actor.token,
      vault.owner,
      annotationsPath(code, name),
    );
    // No file yet is the ordinary case — a PDF nobody has marked up.
    if (!file) return NextResponse.json({ items: [], sha: null });

    const parsed = JSON.parse(file.text) as unknown;
    return NextResponse.json({ items: parseAnnotations(parsed), sha: file.sha });
  } catch (e) {
    // A hand-mangled JSON file should not make the PDF unopenable.
    if (e instanceof SyntaxError) {
      return NextResponse.json({ items: [], sha: null });
    }
    return toErrorResponse(e);
  }
}

/**
 * Replace the highlights on one of my PDFs.
 *
 * The whole set is sent every time rather than a diff: it is a few kilobytes,
 * and one blob per PDF means a save can never interleave two edits into a
 * half-applied state. Like every write path this ignores any caller-supplied
 * owner — annotations can only land in the signed-in user's own vault.
 */
export async function PUT(req: NextRequest) {
  const actor = await getActor();
  if (!actor) return unauthorized();

  const body = (await req.json().catch(() => null)) as {
    code?: string;
    name?: string;
    sha?: string | null;
    items?: unknown;
  } | null;

  const code = normalizeCode(body?.code ?? "");
  const name = body?.name ?? "";

  if (!code || !isSafeFilename(name) || kindOf(name) !== "pdf") {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  if (Array.isArray(body?.items) && body.items.length > MAX_ANNOTATIONS) {
    return NextResponse.json(
      { error: `That is more than ${MAX_ANNOTATIONS} highlights on one PDF` },
      { status: 413 },
    );
  }

  const items = parseAnnotations({ items: body?.items } as unknown);
  const payload: AnnotationFile = { version: 1, file: name, items };

  try {
    const sha = await writeFile(
      actor.token,
      actor.owner,
      annotationsPath(code, name),
      `${JSON.stringify(payload, null, 2)}\n`,
      items.length === 0
        ? `Clear notes on ${name}`
        : `Update notes on ${name} (${items.length})`,
      body?.sha ?? undefined,
    );
    return NextResponse.json({ ok: true, sha });
  } catch (e) {
    return toErrorResponse(e);
  }
}
