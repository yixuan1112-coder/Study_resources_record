import "server-only";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { GitHubError } from "./github";
import { isValidLogin } from "./sharing";

export type Actor = { token: string; owner: string };

/** Resolves the signed-in GitHub identity, or null when unauthenticated. */
export async function getActor(): Promise<Actor | null> {
  const session = await auth();
  if (!session?.accessToken || !session.login) return null;
  return { token: session.accessToken, owner: session.login };
}

export function unauthorized() {
  return NextResponse.json({ error: "Not signed in" }, { status: 401 });
}

/**
 * Which vault a read is aimed at. `owner` may be a friend who shared theirs;
 * GitHub rejects the request if they have not, so no check is needed here.
 * Writes must ignore this and use `actor.owner` — never a caller-supplied one.
 */
export function resolveVault(
  actor: Actor,
  requested: string | null | undefined,
): { owner: string; readOnly: boolean } | null {
  if (!requested || requested.toLowerCase() === actor.owner.toLowerCase()) {
    return { owner: actor.owner, readOnly: false };
  }
  if (!isValidLogin(requested)) return null;
  return { owner: requested, readOnly: true };
}

/** Maps thrown errors onto sensible HTTP responses for the API routes. */
export function toErrorResponse(e: unknown) {
  if (e instanceof GitHubError) {
    const status = e.status === 401 || e.status === 403 ? e.status : 502;
    return NextResponse.json(
      { error: `GitHub: ${e.message}` },
      { status: e.status === 404 ? 404 : status },
    );
  }
  const message = e instanceof Error ? e.message : "Unexpected error";
  return NextResponse.json({ error: message }, { status: 500 });
}
