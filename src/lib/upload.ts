"use client";

/**
 * GitHub's blob API refuses anything at or above 100 MB, so this sits just
 * under it. Every file type is allowed — the cap is the only restriction.
 */
export const MAX_FILE_BYTES = 95 * 1024 * 1024;

const MAX_FILE_MB = Math.round(MAX_FILE_BYTES / 1024 / 1024);

type UploadSession = {
  token: string;
  owner: string;
  repo: string;
  branch: string;
};

export type UploadProgress = {
  done: number;
  total: number;
  current: string;
};

async function ghJson<T>(
  session: UploadSession,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${session.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      if (body?.message) message = body.message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

/** ArrayBuffer -> base64, chunked so large files don't blow the call stack. */
function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export async function getUploadSession(): Promise<UploadSession> {
  const res = await fetch("/api/upload-session", { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Could not start upload");
  }
  return res.json();
}

/**
 * Uploads files into `courses/<code>/` as a single commit.
 * `existing` is used to auto-suffix names that would otherwise collide.
 */
export async function uploadFiles(
  code: string,
  files: File[],
  existing: string[],
  onProgress: (p: UploadProgress) => void,
): Promise<string[]> {
  const session = await getUploadSession();
  const base = `/repos/${session.owner}/${session.repo}`;
  const taken = new Set(existing);
  const names: string[] = [];

  const blobs: { path: string; sha: string }[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress({ done: i, total: files.length, current: file.name });

    if (file.size > MAX_FILE_BYTES) {
      throw new Error(
        `${file.name} is ${(file.size / 1024 / 1024).toFixed(0)} MB — the limit is ${MAX_FILE_MB} MB`,
      );
    }

    const name = uniqueName(file.name, taken);
    taken.add(name);
    names.push(name);

    const content = toBase64(await file.arrayBuffer());
    const blob = await ghJson<{ sha: string }>(session, `${base}/git/blobs`, {
      method: "POST",
      body: JSON.stringify({ content, encoding: "base64" }),
    });
    blobs.push({ path: `courses/${code}/${name}`, sha: blob.sha });
  }

  onProgress({ done: files.length, total: files.length, current: "Committing" });

  const ref = await ghJson<{ object: { sha: string } }>(
    session,
    `${base}/git/ref/heads/${encodeURIComponent(session.branch)}`,
  );
  const head = await ghJson<{ tree: { sha: string } }>(
    session,
    `${base}/git/commits/${ref.object.sha}`,
  );

  const tree = await ghJson<{ sha: string }>(session, `${base}/git/trees`, {
    method: "POST",
    body: JSON.stringify({
      base_tree: head.tree.sha,
      tree: blobs.map((b) => ({
        path: b.path,
        mode: "100644",
        type: "blob",
        sha: b.sha,
      })),
    }),
  });

  const summary =
    files.length === 1 ? names[0] : `${files.length} files`;
  const commit = await ghJson<{ sha: string }>(session, `${base}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: `Add ${summary} to ${code}`,
      tree: tree.sha,
      parents: [ref.object.sha],
    }),
  });

  await ghJson(session, `${base}/git/refs/heads/${encodeURIComponent(session.branch)}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commit.sha }),
  });

  return names;
}

/** "notes.pdf" -> "notes-2.pdf" when the name is already taken. */
function uniqueName(raw: string, taken: Set<string>): string {
  const name = raw.replace(/[/\\]/g, "-").replace(/^\.+/, "").trim() || "untitled";
  if (!taken.has(name)) return name;

  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
}
