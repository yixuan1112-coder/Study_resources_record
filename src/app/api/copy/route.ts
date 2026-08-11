import { NextRequest, NextResponse } from "next/server";
import { ensureRepo, ghRaw, listDir, writeBinaryFile } from "@/lib/github";
import { getActor, resolveVault, toErrorResponse, unauthorized } from "@/lib/session";
import { isSafeFilename, normalizeCode } from "@/lib/types";

/**
 * Server-side copy limit. The bytes are buffered in the function, and unlike an
 * upload from the browser this never crosses Vercel's request-body cap — the
 * only ceiling is how much the function can comfortably hold.
 */
const MAX_COPY_BYTES = 50 * 1024 * 1024;

/** Copy a file out of a shared vault into one of my own courses. */
export async function POST(req: NextRequest) {
  const actor = await getActor();
  if (!actor) return unauthorized();

  const body = (await req.json().catch(() => null)) as {
    fromOwner?: string;
    fromCode?: string;
    name?: string;
    toCode?: string;
  } | null;

  const source = resolveVault(actor, body?.fromOwner);
  const fromCode = normalizeCode(body?.fromCode ?? "");
  const toCode = normalizeCode(body?.toCode ?? "");
  const name = body?.name ?? "";

  if (!source || !fromCode || !toCode || !isSafeFilename(name)) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (!source.readOnly) {
    return NextResponse.json(
      { error: "That file is already in your vault" },
      { status: 400 },
    );
  }

  try {
    const upstream = await ghRaw(
      actor.token,
      source.owner,
      `courses/${fromCode}/${name}`,
    );
    if (!upstream.ok) {
      return NextResponse.json(
        { error: "Could not read that file — the owner may have unshared it" },
        { status: upstream.status === 404 ? 404 : 502 },
      );
    }

    const declared = Number(upstream.headers.get("content-length") ?? 0);
    if (declared > MAX_COPY_BYTES) {
      return NextResponse.json(
        { error: `That file is too big to copy (limit ${MAX_COPY_BYTES / 1024 / 1024} MB)` },
        { status: 413 },
      );
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (buffer.byteLength > MAX_COPY_BYTES) {
      return NextResponse.json(
        { error: `That file is too big to copy (limit ${MAX_COPY_BYTES / 1024 / 1024} MB)` },
        { status: 413 },
      );
    }

    await ensureRepo(actor.token, actor.owner);
    const existing = await listDir(actor.token, actor.owner, `courses/${toCode}`);
    const finalName = uniqueName(name, new Set(existing.map((e) => e.name)));

    await writeBinaryFile(
      actor.token,
      actor.owner,
      `courses/${toCode}/${finalName}`,
      buffer.toString("base64"),
      `Save ${finalName} from ${source.owner}/${fromCode}`,
    );

    return NextResponse.json({ ok: true, name: finalName, code: toCode });
  } catch (e) {
    return toErrorResponse(e);
  }
}

function uniqueName(raw: string, taken: Set<string>): string {
  if (!taken.has(raw)) return raw;
  const dot = raw.lastIndexOf(".");
  const stem = dot > 0 ? raw.slice(0, dot) : raw;
  const ext = dot > 0 ? raw.slice(dot) : "";
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
}
