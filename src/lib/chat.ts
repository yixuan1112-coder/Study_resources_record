import "server-only";
import { GitHubError, VAULT_REPO, gh } from "./github";

/**
 * Group chat, without adding a database.
 *
 * Each vault has one chat room: a single issue in that vault's repository,
 * titled below. Every message is a comment on it. GitHub already decides who
 * may read a private repo — and read access is enough to comment — so the
 * study group's members are exactly the people who can see the room, with no
 * extra permission to grant and nothing for the app to enforce.
 *
 * The side effect is a pleasant one: the whole conversation is readable on
 * GitHub, and replying there works just as well as replying here.
 */
export const CHAT_TITLE = "Study group chat";

const CHAT_BODY = [
  "Messages sent from the Course Vault **Study group** page arrive here as comments.",
  "",
  "Everyone this vault is shared with can read and reply — from the app or from GitHub.",
].join("\n");

/** Long enough for a real question, short enough to stay a chat message. */
export const MAX_MESSAGE_CHARS = 4000;

/** Newest messages kept; older ones stay readable on GitHub. */
const KEEP_MESSAGES = 200;

/** Raised when the room cannot exist — not a bug, just a vault to skip. */
export class ChatUnavailableError extends Error {}

export type ChatMessage = {
  id: number;
  author: string;
  avatarUrl: string;
  body: string;
  createdAt: string;
  url: string;
};

type GhIssue = {
  number: number;
  title: string;
  html_url: string;
  pull_request?: unknown;
};

type GhComment = {
  id: number;
  body: string | null;
  created_at: string;
  html_url: string;
  user: { login: string; avatar_url: string } | null;
};

function sameLogin(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * The room for a vault, or null if nobody has started one. Picks the
 * lowest-numbered match so that two people opening chat at the same moment
 * still converge on one room.
 */
async function findRoom(token: string, owner: string): Promise<number | null> {
  const issues = await gh<GhIssue[]>(
    token,
    `/repos/${owner}/${VAULT_REPO}/issues?state=all&per_page=100&sort=created&direction=asc`,
  );
  const numbers = issues
    .filter((i) => !i.pull_request && i.title === CHAT_TITLE)
    .map((i) => i.number);
  return numbers.length ? Math.min(...numbers) : null;
}

async function createRoom(token: string, owner: string): Promise<number> {
  const issue = await gh<GhIssue>(token, `/repos/${owner}/${VAULT_REPO}/issues`, {
    method: "POST",
    body: JSON.stringify({ title: CHAT_TITLE, body: CHAT_BODY }),
  });
  return issue.number;
}

/**
 * Find the room, opening it on first use. Anyone in the group may open it —
 * whoever gets to the chat first — which keeps a room from depending on the
 * owner happening to visit.
 */
export async function ensureRoom(
  token: string,
  owner: string,
  me: string,
): Promise<number> {
  try {
    const existing = await findRoom(token, owner);
    return existing ?? (await createRoom(token, owner));
  } catch (e) {
    // 410 Gone means issues are switched off on the repository.
    if (e instanceof GitHubError && e.status === 410) {
      if (!sameLogin(owner, me)) {
        throw new ChatUnavailableError(
          `${owner} has issues turned off on their vault, so chat cannot start there.`,
        );
      }
      // My own vault — turn them back on and retry once.
      await gh(token, `/repos/${owner}/${VAULT_REPO}`, {
        method: "PATCH",
        body: JSON.stringify({ has_issues: true }),
      });
      return createRoom(token, owner);
    }
    if (
      e instanceof GitHubError &&
      (e.status === 403 || e.status === 404) &&
      !sameLogin(owner, me)
    ) {
      throw new ChatUnavailableError(
        `You no longer have access to ${owner}'s vault.`,
      );
    }
    throw e;
  }
}

export async function listMessages(
  token: string,
  owner: string,
  room: number,
): Promise<ChatMessage[]> {
  const base = `/repos/${owner}/${VAULT_REPO}/issues/${room}/comments`;
  const PER_PAGE = 100;
  const MAX_PAGES = 10;

  const all: GhComment[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await gh<GhComment[]>(
      token,
      `${base}?per_page=${PER_PAGE}&page=${page}`,
    );
    all.push(...batch);
    if (batch.length < PER_PAGE) break;
  }

  return all.slice(-KEEP_MESSAGES).map((c) => ({
    id: c.id,
    author: c.user?.login ?? "someone",
    avatarUrl: c.user?.avatar_url ?? "",
    body: c.body ?? "",
    createdAt: c.created_at,
    url: c.html_url,
  }));
}

export async function postMessage(
  token: string,
  owner: string,
  room: number,
  body: string,
): Promise<ChatMessage> {
  const text = body.trim().slice(0, MAX_MESSAGE_CHARS);
  if (!text) throw new ChatUnavailableError("Write something first.");

  try {
    const c = await gh<GhComment>(
      token,
      `/repos/${owner}/${VAULT_REPO}/issues/${room}/comments`,
      { method: "POST", body: JSON.stringify({ body: text }) },
    );
    return {
      id: c.id,
      author: c.user?.login ?? "you",
      avatarUrl: c.user?.avatar_url ?? "",
      body: c.body ?? text,
      createdAt: c.created_at,
      url: c.html_url,
    };
  } catch (e) {
    if (e instanceof GitHubError && (e.status === 403 || e.status === 404)) {
      throw new ChatUnavailableError(
        `You cannot post in ${owner}'s group — access may have been revoked.`,
      );
    }
    throw e;
  }
}
