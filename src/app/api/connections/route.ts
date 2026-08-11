import { NextRequest, NextResponse } from "next/server";
import { ensureRepo } from "@/lib/github";
import { getActor, toErrorResponse, unauthorized } from "@/lib/session";
import {
  acceptInvite,
  cancelInvite,
  declineInvite,
  inviteCollaborator,
  isValidLogin,
  listCollaborators,
  listIncomingInvites,
  listSentInvites,
  listSharedVaults,
  removeCollaborator,
} from "@/lib/sharing";

/** Everything about who I share with and who shares with me. */
export async function GET() {
  const actor = await getActor();
  if (!actor) return unauthorized();

  try {
    await ensureRepo(actor.token, actor.owner);
    const [iShareWith, sentInvites, sharingWithMe, incoming] = await Promise.all([
      listCollaborators(actor.token, actor.owner),
      listSentInvites(actor.token, actor.owner),
      listSharedVaults(actor.token, actor.owner),
      listIncomingInvites(actor.token),
    ]);
    return NextResponse.json({
      me: actor.owner,
      iShareWith,
      sentInvites,
      sharingWithMe,
      incoming,
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  const actor = await getActor();
  if (!actor) return unauthorized();

  const body = (await req.json().catch(() => null)) as {
    action?: string;
    login?: string;
    id?: number;
  } | null;

  try {
    switch (body?.action) {
      case "invite": {
        const login = (body.login ?? "").trim().replace(/^@/, "");
        if (!isValidLogin(login)) {
          return NextResponse.json(
            { error: "That does not look like a GitHub username" },
            { status: 400 },
          );
        }
        if (login.toLowerCase() === actor.owner.toLowerCase()) {
          return NextResponse.json(
            { error: "You already have access to your own vault" },
            { status: 400 },
          );
        }
        await ensureRepo(actor.token, actor.owner);
        await inviteCollaborator(actor.token, actor.owner, login);
        return NextResponse.json({ ok: true });
      }

      case "accept": {
        if (typeof body.id !== "number") {
          return NextResponse.json({ error: "Bad request" }, { status: 400 });
        }
        await acceptInvite(actor.token, body.id);
        return NextResponse.json({ ok: true });
      }

      case "decline": {
        if (typeof body.id !== "number") {
          return NextResponse.json({ error: "Bad request" }, { status: 400 });
        }
        await declineInvite(actor.token, body.id);
        return NextResponse.json({ ok: true });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e) {
    return toErrorResponse(e);
  }
}

/** Revoke someone's access, or take back an invite they never accepted. */
export async function DELETE(req: NextRequest) {
  const actor = await getActor();
  if (!actor) return unauthorized();

  const login = req.nextUrl.searchParams.get("login");
  const inviteId = req.nextUrl.searchParams.get("inviteId");

  try {
    if (inviteId) {
      const id = Number(inviteId);
      if (!Number.isInteger(id)) {
        return NextResponse.json({ error: "Bad request" }, { status: 400 });
      }
      await cancelInvite(actor.token, actor.owner, id);
      return NextResponse.json({ ok: true });
    }
    if (login && isValidLogin(login)) {
      await removeCollaborator(actor.token, actor.owner, login);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  } catch (e) {
    return toErrorResponse(e);
  }
}
