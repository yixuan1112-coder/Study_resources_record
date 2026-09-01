"use client";

import { useEffect, useRef } from "react";

/**
 * Keeps unsaved editor text on the device so that leaving mid-edit does not
 * throw it away.
 *
 * The obvious alternative — committing to the vault when the page hides — is
 * wrong here. Every save is a GitHub commit, and on a phone the hide event
 * fires every time the user switches apps, so an autosave would bury the real
 * history under dozens of commits a day. A new note is worse still: its title
 * becomes its filename, so before the title is typed there is nothing to
 * commit to. Drafts stay local; committing stays deliberate.
 *
 * Drafts are private note text sitting in localStorage, so they are namespaced
 * by the account that wrote them and any other account's drafts are dropped
 * when someone else signs in on the same device.
 */

const PREFIX = "cv-draft:v1:";
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const WRITE_DELAY_MS = 600;

export type Draft = {
  text: string;
  /** Blob sha the edit started from; lets a restore say whether it is stale. */
  sha: string;
  at: number;
  /** A second field the caller owns — the note composer keeps its title here,
   *  which does not exist yet as a filename and so cannot key the draft. */
  meta?: string;
};

/** localStorage throws outright in some privacy modes — never take the app down with it. */
function store(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function draftKey(login: string, scope: string): string {
  return `${PREFIX}${login}/${scope}`;
}

export function readDraft(key: string): Draft | null {
  const s = store();
  if (!s) return null;
  try {
    const raw = s.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    if (typeof d?.text !== "string" || typeof d?.at !== "number") return null;
    if (Date.now() - d.at > MAX_AGE_MS) {
      s.removeItem(key);
      return null;
    }
    return d;
  } catch {
    return null;
  }
}

export function writeDraft(
  key: string,
  text: string,
  sha: string,
  meta?: string,
): void {
  const s = store();
  if (!s) return;
  const body = () =>
    JSON.stringify({ text, sha, at: Date.now(), meta } satisfies Draft);
  try {
    s.setItem(key, body());
  } catch {
    // Quota exceeded. Clearing the stale drafts is worth one retry; if it
    // still will not fit, the in-memory buffer is untouched and the user can
    // still save normally.
    try {
      sweep(s, () => true);
      s.setItem(key, body());
    } catch {
      /* give up quietly */
    }
  }
}

export function clearDraft(key: string): void {
  try {
    store()?.removeItem(key);
  } catch {
    /* nothing to clean up */
  }
}

function sweep(s: Storage, expired: (key: string, draft: Draft | null) => boolean) {
  const doomed: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const key = s.key(i);
    if (!key?.startsWith(PREFIX)) continue;
    let draft: Draft | null = null;
    try {
      draft = JSON.parse(s.getItem(key) ?? "null") as Draft | null;
    } catch {
      draft = null;
    }
    if (expired(key, draft)) doomed.push(key);
  }
  for (const key of doomed) s.removeItem(key);
}

/**
 * Drops drafts that have gone stale, and any belonging to a different account
 * — a shared laptop should not hand one student's half-written note to the
 * next person who signs in.
 */
export function pruneDrafts(login: string): void {
  const s = store();
  if (!s) return;
  const mine = `${PREFIX}${login}/`;
  try {
    sweep(
      s,
      (key, draft) =>
        !key.startsWith(mine) || !draft || Date.now() - draft.at > MAX_AGE_MS,
    );
  } catch {
    /* best effort */
  }
}

/**
 * Mirrors `text` into the draft store while it differs from what is committed,
 * and removes it once the two match again.
 *
 * The debounce keeps typing off the main thread's critical path, but a debounce
 * alone would lose the last few hundred milliseconds — exactly the keystrokes
 * before someone swipes the app away. `pagehide` and the hidden transition of
 * `visibilitychange` therefore force an immediate write. Those two fire on iOS
 * where `beforeunload` does not, which is the case this whole module exists for.
 */
export function useDraftAutosave({
  key,
  text,
  sha,
  meta,
  dirty,
}: {
  /** Null disables persistence entirely — read-only views, or before load. */
  key: string | null;
  text: string;
  sha: string;
  meta?: string;
  dirty: boolean;
}): void {
  // Listeners are registered once; they read through this so that every fire
  // sees the current text rather than the text at registration time.
  const latest = useRef({ key, text, sha, meta, dirty });
  useEffect(() => {
    latest.current = { key, text, sha, meta, dirty };
  });

  useEffect(() => {
    if (!key) return;
    if (!dirty) {
      clearDraft(key);
      return;
    }
    const id = setTimeout(() => writeDraft(key, text, sha, meta), WRITE_DELAY_MS);
    return () => clearTimeout(id);
  }, [key, text, sha, meta, dirty]);

  useEffect(() => {
    const flush = () => {
      const now = latest.current;
      if (!now.key || !now.dirty) return;
      writeDraft(now.key, now.text, now.sha, now.meta);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
}

/**
 * The desktop half of the same problem: a browser tab closed with unsaved work
 * gets the native "Leave site?" prompt. Mobile Safari ignores this entirely,
 * which is why it is a complement to the draft store and not a replacement.
 */
export function useUnloadWarning(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Legacy browsers only show the prompt when returnValue is set.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [active]);
}
