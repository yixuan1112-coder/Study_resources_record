import { NextResponse } from "next/server";
import { VAULT_BRANCH, VAULT_REPO, ensureRepo } from "@/lib/github";
import { getActor, toErrorResponse, unauthorized } from "@/lib/session";

/**
 * Hands the browser what it needs to push files straight to the GitHub API.
 *
 * Uploads deliberately bypass this server: a Vercel function caps request
 * bodies at 4.5 MB, which a single set of lecture slides blows past. The token
 * is the caller's own OAuth token, is only ever returned to their authenticated
 * session, and the client keeps it in memory (never localStorage).
 */
export async function POST() {
  const actor = await getActor();
  if (!actor) return unauthorized();

  try {
    await ensureRepo(actor.token, actor.owner);
    return NextResponse.json(
      {
        token: actor.token,
        owner: actor.owner,
        repo: VAULT_REPO,
        branch: VAULT_BRANCH,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return toErrorResponse(e);
  }
}
