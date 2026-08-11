import "server-only";
import { VAULT_REPO, gh } from "./github";

/**
 * Sharing is built on GitHub's own collaborator model rather than an app-level
 * permission table: you invite a friend to your vault repo with `pull` (read
 * only) access, and from then on GitHub decides what their token can see. The
 * app never has to be the one enforcing it.
 */

export type Person = { login: string; avatarUrl: string };

export type SentInvite = { id: number; login: string; avatarUrl: string };

export type IncomingInvite = {
  id: number;
  owner: string;
  avatarUrl: string;
  repo: string;
};

/** GitHub usernames: alphanumeric and single hyphens, 39 chars max. */
export function isValidLogin(login: string): boolean {
  return /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/.test(login);
}

type GhCollaborator = { login: string; avatar_url: string };
type GhInvitation = {
  id: number;
  invitee: GhCollaborator | null;
  inviter: GhCollaborator | null;
  repository: { name: string; owner: GhCollaborator };
};
type GhRepo = { name: string; owner: GhCollaborator };

/** People who can read my vault (excluding me). */
export async function listCollaborators(
  token: string,
  owner: string,
): Promise<Person[]> {
  const list = await gh<GhCollaborator[]>(
    token,
    `/repos/${owner}/${VAULT_REPO}/collaborators?affiliation=direct&per_page=100`,
  );
  return list
    .filter((c) => c.login.toLowerCase() !== owner.toLowerCase())
    .map((c) => ({ login: c.login, avatarUrl: c.avatar_url }));
}

/** Invites I have sent that are still waiting to be accepted. */
export async function listSentInvites(
  token: string,
  owner: string,
): Promise<SentInvite[]> {
  const list = await gh<GhInvitation[]>(
    token,
    `/repos/${owner}/${VAULT_REPO}/invitations?per_page=100`,
  );
  return list
    .filter((i) => i.invitee)
    .map((i) => ({
      id: i.id,
      login: i.invitee!.login,
      avatarUrl: i.invitee!.avatar_url,
    }));
}

/** Invites other people have sent me, for any repo named like a vault. */
export async function listIncomingInvites(
  token: string,
): Promise<IncomingInvite[]> {
  const list = await gh<GhInvitation[]>(
    token,
    "/user/repository_invitations?per_page=100",
  );
  return list
    .filter((i) => i.repository?.name === VAULT_REPO)
    .map((i) => ({
      id: i.id,
      owner: i.repository.owner.login,
      avatarUrl: i.repository.owner.avatar_url,
      repo: i.repository.name,
    }));
}

/** Vaults belonging to other people that I have already been given access to. */
export async function listSharedVaults(
  token: string,
  me: string,
): Promise<Person[]> {
  const repos = await gh<GhRepo[]>(
    token,
    "/user/repos?affiliation=collaborator&per_page=100",
  );
  return repos
    .filter(
      (r) => r.name === VAULT_REPO && r.owner.login.toLowerCase() !== me.toLowerCase(),
    )
    .map((r) => ({ login: r.owner.login, avatarUrl: r.owner.avatar_url }));
}

/** Invite someone to read my vault. Read-only: `pull`, never `push`. */
export async function inviteCollaborator(
  token: string,
  owner: string,
  login: string,
): Promise<void> {
  await gh(token, `/repos/${owner}/${VAULT_REPO}/collaborators/${login}`, {
    method: "PUT",
    body: JSON.stringify({ permission: "pull" }),
  });
}

export async function removeCollaborator(
  token: string,
  owner: string,
  login: string,
): Promise<void> {
  await gh(token, `/repos/${owner}/${VAULT_REPO}/collaborators/${login}`, {
    method: "DELETE",
  });
}

export async function cancelInvite(
  token: string,
  owner: string,
  id: number,
): Promise<void> {
  await gh(token, `/repos/${owner}/${VAULT_REPO}/invitations/${id}`, {
    method: "DELETE",
  });
}

export async function acceptInvite(token: string, id: number): Promise<void> {
  await gh(token, `/user/repository_invitations/${id}`, { method: "PATCH" });
}

export async function declineInvite(token: string, id: number): Promise<void> {
  await gh(token, `/user/repository_invitations/${id}`, { method: "DELETE" });
}
