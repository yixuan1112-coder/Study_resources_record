import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppHeader } from "@/components/AppHeader";
import { Connections, type ConnectionState } from "@/components/Connections";
import { ensureRepo } from "@/lib/github";
import {
  listCollaborators,
  listIncomingInvites,
  listSentInvites,
  listSharedVaults,
} from "@/lib/sharing";

export default async function ConnectionsPage() {
  const session = await auth();
  if (!session?.login || !session.accessToken) redirect("/");
  const { accessToken: token, login: me } = session;

  let state: ConnectionState = {
    me,
    iShareWith: [],
    sentInvites: [],
    sharingWithMe: [],
    incoming: [],
  };
  let error: string | null = null;

  try {
    await ensureRepo(token, me);
    const [iShareWith, sentInvites, sharingWithMe, incoming] = await Promise.all([
      listCollaborators(token, me),
      listSentInvites(token, me),
      listSharedVaults(token, me),
      listIncomingInvites(token),
    ]);
    state = { me, iShareWith, sentInvites, sharingWithMe, incoming };
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not load your connections";
  }

  return (
    <div className="min-h-screen">
      <AppHeader login={me} />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <Connections initial={state} initialError={error} />
      </main>
    </div>
  );
}
