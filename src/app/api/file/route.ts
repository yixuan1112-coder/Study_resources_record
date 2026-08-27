import { NextRequest, NextResponse } from "next/server";
import { ghRaw } from "@/lib/github";
import { getActor, resolveVault, unauthorized } from "@/lib/session";
import { isSafeFilename, mimeOf, normalizeCode } from "@/lib/types";

/**
 * Streams a file out of the private vault repo. The repo is private, so the
 * bytes have to come through here rather than from a raw.githubusercontent URL.
 */
export async function GET(req: NextRequest) {
  const actor = await getActor();
  if (!actor) return unauthorized();

  const code = normalizeCode(req.nextUrl.searchParams.get("code") ?? "");
  const name = req.nextUrl.searchParams.get("name") ?? "";
  const download = req.nextUrl.searchParams.get("download") === "1";

  const vault = resolveVault(actor, req.nextUrl.searchParams.get("owner"));
  if (!code || !isSafeFilename(name) || !vault) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const upstream = await ghRaw(actor.token, vault.owner, `courses/${code}/${name}`);
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { error: upstream.status === 404 ? "File not found" : "Could not read file" },
      { status: upstream.status === 404 ? 404 : 502 },
    );
  }

  const type = mimeOf(name);
  const headers = new Headers({
    "Content-Type": type,
    "Cache-Control": "private, max-age=60",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`,
  });

  const length = upstream.headers.get("content-length");
  if (length) headers.set("Content-Length", length);

  // HTML and SVG are active content: served from this origin they would run
  // script with the signed-in user's session, and a vault someone shared is
  // full of files they wrote. `sandbox` drops the document into an opaque
  // origin and the rest switches scripting off, which still leaves the file
  // perfectly readable.
  if (/^(text\/html|image\/svg\+xml)/.test(type)) {
    headers.set(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
    );
  }

  return new NextResponse(upstream.body, { headers });
}
