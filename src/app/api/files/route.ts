import { NextRequest, NextResponse } from "next/server";
import { deleteFile, listDir, movePath, readFile } from "@/lib/github";
import { getActor, resolveVault, toErrorResponse, unauthorized } from "@/lib/session";
import { isSafeFilename, kindOf, normalizeCode, type VaultFile } from "@/lib/types";
import { annotationsPath } from "@/lib/annotations";

/**
 * A PDF's highlights live in a sibling file, so renaming or deleting the PDF
 * has to take them along — otherwise the notes are orphaned under a name
 * nothing points at any more.
 *
 * Best effort on purpose: losing track of the highlights is a much smaller
 * problem than a rename that reports failure after the file has already moved.
 */
async function followAnnotations(
  token: string,
  owner: string,
  code: string,
  name: string,
  to: { code: string; name: string } | null,
): Promise<void> {
  if (kindOf(name) !== "pdf") return;
  const from = annotationsPath(code, name);
  try {
    const existing = await readFile(token, owner, from);
    if (!existing) return;
    if (to) {
      await movePath(
        token,
        owner,
        from,
        annotationsPath(to.code, to.name),
        existing.sha,
        `Move notes for ${name}`,
      );
    } else {
      await deleteFile(token, owner, from, existing.sha, `Delete notes for ${name}`);
    }
  } catch {
    // Swallowed: see above.
  }
}

/** List every file in a course folder — mine, or a friend's shared vault. */
export async function GET(req: NextRequest) {
  const actor = await getActor();
  if (!actor) return unauthorized();

  const code = normalizeCode(req.nextUrl.searchParams.get("code") ?? "");
  const vault = resolveVault(actor, req.nextUrl.searchParams.get("owner"));
  if (!code || !vault) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  try {
    const entries = await listDir(actor.token, vault.owner, `courses/${code}`);
    const files: VaultFile[] = entries
      .filter((e) => e.type === "file" && e.name !== "README.md")
      .map((e) => ({
        name: e.name,
        path: e.path,
        sha: e.sha,
        size: e.size,
        kind: kindOf(e.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    return NextResponse.json({ files });
  } catch (e) {
    return toErrorResponse(e);
  }
}

/** Rename a file, or move it into a different course. */
export async function PATCH(req: NextRequest) {
  const actor = await getActor();
  if (!actor) return unauthorized();

  const body = (await req.json().catch(() => null)) as {
    code?: string;
    name?: string;
    sha?: string;
    newName?: string;
    newCode?: string;
  } | null;

  const code = normalizeCode(body?.code ?? "");
  const name = body?.name ?? "";
  const sha = body?.sha ?? "";
  const newName = (body?.newName ?? name).trim();
  const newCode = normalizeCode(body?.newCode || code);

  if (!code || !sha || !isSafeFilename(name)) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (!isSafeFilename(newName)) {
    return NextResponse.json(
      { error: "That filename has characters that aren't allowed" },
      { status: 400 },
    );
  }
  if (!newCode) {
    return NextResponse.json({ error: "Bad destination course" }, { status: 400 });
  }

  const from = `courses/${code}/${name}`;
  const to = `courses/${newCode}/${newName}`;
  if (from === to) return NextResponse.json({ ok: true, path: to });

  try {
    const existing = await listDir(actor.token, actor.owner, `courses/${newCode}`);
    if (existing.some((e) => e.name === newName)) {
      return NextResponse.json(
        { error: `${newCode} already has a file called ${newName}` },
        { status: 409 },
      );
    }
    await movePath(
      actor.token,
      actor.owner,
      from,
      to,
      sha,
      `Rename ${name} to ${newName}`,
    );
    await followAnnotations(actor.token, actor.owner, code, name, {
      code: newCode,
      name: newName,
    });
    return NextResponse.json({ ok: true, path: to });
  } catch (e) {
    return toErrorResponse(e);
  }
}

export async function DELETE(req: NextRequest) {
  const actor = await getActor();
  if (!actor) return unauthorized();

  const code = normalizeCode(req.nextUrl.searchParams.get("code") ?? "");
  const name = req.nextUrl.searchParams.get("name") ?? "";
  const sha = req.nextUrl.searchParams.get("sha") ?? "";
  if (!code || !sha || !isSafeFilename(name)) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  try {
    await deleteFile(
      actor.token,
      actor.owner,
      `courses/${code}/${name}`,
      sha,
      `Delete ${name} from ${code}`,
    );
    await followAnnotations(actor.token, actor.owner, code, name, null);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return toErrorResponse(e);
  }
}
