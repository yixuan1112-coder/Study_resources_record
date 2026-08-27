import "server-only";

export const VAULT_REPO = process.env.VAULT_REPO || "ntu-course-vault";
export const VAULT_BRANCH = process.env.VAULT_BRANCH || "main";

const API = "https://api.github.com";

export class GitHubError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type GhInit = RequestInit & { accept?: string };

export async function gh<T = unknown>(
  token: string,
  path: string,
  init: GhInit = {},
): Promise<T> {
  const { accept, ...rest } = init;
  const res = await fetch(`${API}${path}`, {
    ...rest,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: accept ?? "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "ntu-course-vault",
      ...(rest.body ? { "Content-Type": "application/json" } : {}),
      ...rest.headers,
    },
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { message?: string };
      if (body?.message) detail = body.message;
    } catch {
      /* non-JSON error body */
    }
    throw new GitHubError(res.status, detail);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Raw bytes for a path, streamed. Works for files well past the 1 MB JSON limit. */
export async function ghRaw(
  token: string,
  owner: string,
  path: string,
): Promise<Response> {
  return fetch(
    `${API}/repos/${owner}/${VAULT_REPO}/contents/${encodePath(path)}?ref=${encodeURIComponent(VAULT_BRANCH)}`,
    {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.raw",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "ntu-course-vault",
      },
    },
  );
}

/** Encode each segment but keep the slashes that separate them. */
export function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export type GhUser = { login: string; name: string | null; avatar_url: string };

export function getUser(token: string) {
  return gh<GhUser>(token, "/user");
}

export type GhContentEntry = {
  name: string;
  path: string;
  sha: string;
  size: number;
  type: "file" | "dir" | "symlink" | "submodule";
};

/** Directory listing. Returns [] when the directory does not exist yet. */
export async function listDir(
  token: string,
  owner: string,
  path: string,
): Promise<GhContentEntry[]> {
  try {
    const out = await gh<GhContentEntry[] | GhContentEntry>(
      token,
      `/repos/${owner}/${VAULT_REPO}/contents/${encodePath(path)}?ref=${encodeURIComponent(VAULT_BRANCH)}`,
    );
    return Array.isArray(out) ? out : [];
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) return [];
    throw e;
  }
}

export type GhFile = { content: string; encoding: string; sha: string };

/** Small text file (<1 MB) plus its blob sha, or null when absent. */
export async function readFile(
  token: string,
  owner: string,
  path: string,
): Promise<{ text: string; sha: string } | null> {
  try {
    const f = await gh<GhFile>(
      token,
      `/repos/${owner}/${VAULT_REPO}/contents/${encodePath(path)}?ref=${encodeURIComponent(VAULT_BRANCH)}`,
    );
    const text = Buffer.from(f.content, "base64").toString("utf8");
    return { text, sha: f.sha };
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) return null;
    throw e;
  }
}

/**
 * Create or overwrite a text file. Returns the blob sha of what was just
 * written, which the editor needs in order to save a second time without
 * reloading the file.
 */
export async function writeFile(
  token: string,
  owner: string,
  path: string,
  content: string,
  message: string,
  sha?: string,
): Promise<string> {
  const out = await gh<{ content?: { sha?: string } }>(
    token,
    `/repos/${owner}/${VAULT_REPO}/contents/${encodePath(path)}`,
    {
      method: "PUT",
      body: JSON.stringify({
        message,
        content: Buffer.from(content, "utf8").toString("base64"),
        branch: VAULT_BRANCH,
        ...(sha ? { sha } : {}),
      }),
    },
  );
  return out?.content?.sha ?? "";
}

/** Write already-base64-encoded bytes (used when copying a shared file). */
export async function writeBinaryFile(
  token: string,
  owner: string,
  path: string,
  base64: string,
  message: string,
): Promise<void> {
  await gh(token, `/repos/${owner}/${VAULT_REPO}/contents/${encodePath(path)}`, {
    method: "PUT",
    body: JSON.stringify({ message, content: base64, branch: VAULT_BRANCH }),
  });
}

export async function deleteFile(
  token: string,
  owner: string,
  path: string,
  sha: string,
  message: string,
): Promise<void> {
  await gh(token, `/repos/${owner}/${VAULT_REPO}/contents/${encodePath(path)}`, {
    method: "DELETE",
    body: JSON.stringify({ message, sha, branch: VAULT_BRANCH }),
  });
}

/**
 * Move a blob to a new path by rewriting the tree. Only shas travel over the
 * wire, so this works for large PDFs that the contents API could not round-trip.
 */
export async function movePath(
  token: string,
  owner: string,
  from: string,
  to: string,
  blobSha: string,
  message: string,
): Promise<void> {
  const repo = `/repos/${owner}/${VAULT_REPO}`;
  const ref = await gh<{ object: { sha: string } }>(
    token,
    `${repo}/git/ref/heads/${encodeURIComponent(VAULT_BRANCH)}`,
  );
  const headSha = ref.object.sha;
  const head = await gh<{ tree: { sha: string } }>(
    token,
    `${repo}/git/commits/${headSha}`,
  );

  const tree = await gh<{ sha: string }>(token, `${repo}/git/trees`, {
    method: "POST",
    body: JSON.stringify({
      base_tree: head.tree.sha,
      tree: [
        { path: to, mode: "100644", type: "blob", sha: blobSha },
        { path: from, mode: "100644", type: "blob", sha: null },
      ],
    }),
  });

  const commit = await gh<{ sha: string }>(token, `${repo}/git/commits`, {
    method: "POST",
    body: JSON.stringify({ message, tree: tree.sha, parents: [headSha] }),
  });

  await gh(token, `${repo}/git/refs/heads/${encodeURIComponent(VAULT_BRANCH)}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commit.sha }),
  });
}

const README = `# NTU Course Vault

Notes, slides and readings, one folder per course.
Managed by [ntu-course-vault](https://github.com/) — edit here or through the web app.
`;

/**
 * Make sure the private vault repo exists and has a commit on it.
 * Returns true when it had to create the repo.
 */
export async function ensureRepo(
  token: string,
  owner: string,
): Promise<boolean> {
  try {
    await gh(token, `/repos/${owner}/${VAULT_REPO}`);
    return false;
  } catch (e) {
    if (!(e instanceof GitHubError) || e.status !== 404) throw e;
  }

  await gh(token, "/user/repos", {
    method: "POST",
    body: JSON.stringify({
      name: VAULT_REPO,
      description: "My NTU course materials",
      private: true,
      auto_init: true,
    }),
  });

  // auto_init lands asynchronously; poll until the default branch has a tree.
  for (let i = 0; i < 10; i++) {
    try {
      await gh(
        token,
        `/repos/${owner}/${VAULT_REPO}/git/ref/heads/${encodeURIComponent(VAULT_BRANCH)}`,
      );
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 700));
    }
  }

  // Branch name differs from VAULT_BRANCH (or init is slow) — seed it ourselves.
  await writeFile(token, owner, "README.md", README, "Start course vault").catch(
    () => {},
  );
  return true;
}
