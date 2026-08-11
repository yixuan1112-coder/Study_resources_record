import { NextRequest, NextResponse } from "next/server";
import {
  ChatUnavailableError,
  MAX_MESSAGE_CHARS,
  ensureRoom,
  listMessages,
  postMessage,
} from "@/lib/chat";
import { ensureRepo } from "@/lib/github";
import { getActor, resolveVault, toErrorResponse, unauthorized } from "@/lib/session";

/**
 * Chat in one study group. `owner` names whose vault the room belongs to —
 * mine, or one that has been shared with me. Unlike file writes, posting to
 * someone else's room is the point, so `owner` is honoured here; GitHub still
 * refuses the request unless they have actually shared the vault.
 */
function roomOwner(
  actor: { token: string; owner: string },
  requested: string | null | undefined,
): string | null {
  return resolveVault(actor, requested)?.owner ?? null;
}

export async function GET(req: NextRequest) {
  const actor = await getActor();
  if (!actor) return unauthorized();

  const owner = roomOwner(actor, req.nextUrl.searchParams.get("owner"));
  if (!owner) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  try {
    if (owner === actor.owner) await ensureRepo(actor.token, actor.owner);
    const room = await ensureRoom(actor.token, owner, actor.owner);
    const messages = await listMessages(actor.token, owner, room);
    return NextResponse.json(
      { me: actor.owner, owner, room, messages },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    if (e instanceof ChatUnavailableError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    return toErrorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  const actor = await getActor();
  if (!actor) return unauthorized();

  const body = (await req.json().catch(() => null)) as {
    owner?: string;
    body?: string;
  } | null;

  const owner = roomOwner(actor, body?.owner);
  const text = (body?.body ?? "").trim();

  if (!owner || !text || text.length > MAX_MESSAGE_CHARS) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  try {
    const room = await ensureRoom(actor.token, owner, actor.owner);
    const message = await postMessage(actor.token, owner, room, text);
    return NextResponse.json({ message });
  } catch (e) {
    if (e instanceof ChatUnavailableError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    return toErrorResponse(e);
  }
}
