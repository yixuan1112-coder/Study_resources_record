"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Editor, { loader, type OnMount } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import { AlertCircle, Download, Loader2, Save, X } from "lucide-react";
import { fileUrl } from "./FileViewer";
import {
  MAX_CODE_BYTES,
  extOf,
  formatBytes,
  languageLabelOf,
  languageOf,
  type VaultFile,
} from "@/lib/types";

/**
 * Monaco is served from our own origin rather than a CDN — see
 * scripts/sync-monaco.mjs. This has to run before the first editor mounts,
 * which is why it sits at module scope.
 */
loader.config({ paths: { vs: "/monaco/vs" } });

/** Languages whose communities settled on two spaces rather than four. */
const TWO_SPACE = new Set([
  "js", "mjs", "cjs", "jsx", "ts", "tsx", "json", "jsonc", "html", "htm",
  "css", "scss", "less", "yaml", "yml", "vue", "svelte", "rb", "scala",
]);

type Buffer = {
  /** What is in the editor right now. */
  text: string;
  /** What is committed in the repo — the difference is the unsaved change. */
  savedText: string;
  /** Blob sha of `savedText`; GitHub needs it to accept the next write. */
  sha: string;
  loading: boolean;
  saving: boolean;
  error?: string;
  /** Too large to hand-edit — offer the download instead. */
  oversize?: boolean;
};

export function CodeEditor({
  code,
  tabs,
  active,
  owner,
  onActivate,
  onClose,
  onSaved,
}: {
  code: string;
  /** Every file open in the editor, in tab order. */
  tabs: VaultFile[];
  active: VaultFile;
  /** Set when reading someone else's vault — the editor becomes read-only. */
  owner?: string;
  onActivate: (file: VaultFile) => void;
  onClose: (file: VaultFile) => void;
  /** Lets the file list pick up the new sha without re-listing the course. */
  onSaved: (name: string, sha: string) => void;
}) {
  const readOnly = !!owner;
  const [buffers, setBuffers] = useState<Record<string, Buffer>>({});
  const [position, setPosition] = useState({ line: 1, column: 1 });
  const dark = usePrefersDark();

  const buffer = buffers[active.name];
  const dirty = !!buffer && !buffer.loading && buffer.text !== buffer.savedText;

  const patch = useCallback((name: string, next: Partial<Buffer>) => {
    setBuffers((prev) =>
      prev[name] ? { ...prev, [name]: { ...prev[name], ...next } } : prev,
    );
  }, []);

  // Names already fetched. React can run this effect again before the state
  // update lands (and does so twice in development), so the guard has to be
  // something that changes synchronously.
  const requested = useRef(new Set<string>());

  // Read the text of tabs that have just been opened, and forget the ones that
  // are no longer open — a file closed and reopened should be re-read, not
  // resurrected from a buffer whose sha has since gone stale.
  useEffect(() => {
    const open = new Set(tabs.map((f) => f.name));
    for (const name of requested.current) {
      if (!open.has(name)) requested.current.delete(name);
    }

    const missing = tabs.filter(
      (f) => !buffers[f.name] && !requested.current.has(f.name),
    );
    const closed = Object.keys(buffers).filter((n) => !open.has(n));
    if (missing.length === 0 && closed.length === 0) return;
    for (const f of missing) requested.current.add(f.name);

    setBuffers((prev) => {
      const next: Record<string, Buffer> = {};
      for (const [name, buf] of Object.entries(prev)) {
        if (open.has(name)) next[name] = buf;
      }
      for (const f of missing) {
        const oversize = f.size > MAX_CODE_BYTES;
        next[f.name] = {
          text: "",
          savedText: "",
          sha: f.sha,
          loading: !oversize,
          saving: false,
          oversize,
        };
      }
      return next;
    });

    for (const f of missing) {
      if (f.size > MAX_CODE_BYTES) continue;
      // no-store because /api/file is cached for a minute, and a stale copy
      // here would mean saving over the file with an out-of-date sha.
      fetch(fileUrl(code, f.name, { owner }), { cache: "no-store" })
        .then((r) => {
          if (!r.ok) throw new Error("Could not open that file");
          return r.text();
        })
        .then((text) =>
          patch(f.name, { text, savedText: text, loading: false }),
        )
        .catch((e: Error) =>
          patch(f.name, { loading: false, error: e.message }),
        );
    }
  }, [tabs, buffers, code, owner, patch]);

  const save = useCallback(async () => {
    const name = active.name;
    const buf = buffers[name];
    if (readOnly || !buf || buf.loading || buf.saving || buf.oversize) return;
    if (buf.text === buf.savedText) return;

    const sent = buf.text;
    patch(name, { saving: true, error: undefined });
    try {
      const res = await fetch("/api/code", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, name, sha: buf.sha, text: sent }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        patch(name, { saving: false, error: body.error ?? "Could not save" });
        return;
      }
      // Compare against what was actually sent, not the live buffer — the file
      // stays dirty if it was typed in while the request was in flight.
      patch(name, { saving: false, savedText: sent, sha: body.sha });
      onSaved(name, body.sha);
    } catch {
      patch(name, { saving: false, error: "Could not reach the server" });
    }
  }, [active.name, buffers, code, onSaved, patch, readOnly]);

  // Monaco binds Ctrl/Cmd+S once, at mount, so it has to reach the current
  // save through a ref rather than a captured copy.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const handleMount: OnMount = useCallback((editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void saveRef.current();
    });

    const readPosition = () => {
      const at = editor.getPosition();
      if (at) setPosition({ line: at.lineNumber, column: at.column });
    };
    editor.onDidChangeCursorPosition(readPosition);
    // Switching tabs swaps the model under the same editor, which does not
    // move the cursor — without this the status bar keeps the old position.
    editor.onDidChangeModel(readPosition);
  }, []);

  // The browser's own "leave site?" prompt is the only thing that can stop a
  // reload from throwing away unsaved work.
  const anyDirty = Object.values(buffers).some(
    (b) => !b.loading && b.text !== b.savedText,
  );
  useEffect(() => {
    if (!anyDirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [anyDirty]);

  function closeTab(file: VaultFile) {
    const buf = buffers[file.name];
    const unsaved = buf && !buf.loading && buf.text !== buf.savedText;
    if (unsaved && !confirm(`${file.name} has unsaved changes. Close it anyway?`)) {
      return;
    }
    onClose(file);
  }

  return (
    <div className="flex h-full min-h-[560px] flex-col">
      <div className="flex items-stretch overflow-x-auto border-b border-line bg-raised/60">
        {tabs.map((file) => {
          const buf = buffers[file.name];
          const isDirty = buf && !buf.loading && buf.text !== buf.savedText;
          const isActive = file.name === active.name;
          return (
            <div
              key={file.path}
              className={`group flex shrink-0 items-center gap-1.5 border-r border-line px-3 py-2 text-[13px] ${
                isActive
                  ? "bg-surface text-ink"
                  : "text-muted hover:bg-surface/60"
              }`}
            >
              <button
                onClick={() => onActivate(file)}
                className="max-w-[180px] truncate"
                title={file.name}
              >
                {file.name}
              </button>
              <button
                onClick={() => closeTab(file)}
                className="rounded p-0.5 text-faint hover:bg-raised hover:text-ink"
                title={isDirty ? "Unsaved changes" : "Close"}
              >
                {isDirty ? (
                  <span className="block h-2 w-2 rounded-full bg-accent group-hover:hidden" />
                ) : null}
                <X className={`h-3.5 w-3.5 ${isDirty ? "hidden group-hover:block" : ""}`} />
              </button>
            </div>
          );
        })}
      </div>

      {buffer?.error && (
        <div className="flex items-start gap-2 border-b border-danger/40 bg-danger/5 px-3 py-2 text-[13px] text-danger">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">{buffer.error}</span>
          <button onClick={() => patch(active.name, { error: undefined })}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        {buffer?.oversize ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <p className="text-sm text-muted">
              {active.name} is {formatBytes(active.size)} — too big to edit in the
              browser.
            </p>
            <a
              href={fileUrl(code, active.name, { download: true, owner })}
              className="btn-ghost mt-4"
            >
              <Download className="h-4 w-4" />
              Download it instead
            </a>
          </div>
        ) : buffer?.loading ? (
          <div className="flex h-full items-center gap-2 p-6 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Opening {active.name}…
          </div>
        ) : (
          <Editor
            // One model per path, so each tab keeps its own undo history and
            // scroll position exactly like a real editor.
            path={active.name}
            language={languageOf(active.name)}
            value={buffer?.text ?? ""}
            theme={dark ? "vault-dark" : "vault-light"}
            beforeMount={defineThemes}
            onMount={handleMount}
            onChange={(value) => patch(active.name, { text: value ?? "" })}
            loading={
              <div className="flex items-center gap-2 text-sm text-muted">
                <Loader2 className="h-4 w-4 animate-spin" />
                Starting the editor…
              </div>
            }
            options={{
              readOnly,
              fontSize: 13,
              lineHeight: 20,
              fontFamily:
                "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: TWO_SPACE.has(extOf(active.name)) ? 2 : 4,
              insertSpaces: true,
              renderWhitespace: "selection",
              smoothScrolling: true,
              padding: { top: 12, bottom: 12 },
              scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
              overviewRulerLanes: 0,
              stickyScroll: { enabled: false },
            }}
          />
        )}
      </div>

      <div className="flex items-center gap-3 border-t border-line px-3 py-1.5 text-xs text-faint">
        <span>{languageLabelOf(active.name)}</span>
        <span>
          Ln {position.line}, Col {position.column}
        </span>
        <span className="ml-auto">
          {readOnly
            ? `Read only — ${owner}'s vault`
            : buffer?.saving
              ? "Saving…"
              : dirty
                ? "Unsaved"
                : "Saved"}
        </span>
        {!readOnly && (
          <button
            onClick={() => void save()}
            disabled={!dirty || buffer?.saving || buffer?.loading}
            className="btn-quiet -my-1 px-2 py-1 text-xs"
            title="Commit this file to your vault (Ctrl/Cmd+S)"
          >
            {buffer?.saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Save
          </button>
        )}
      </div>
    </div>
  );
}

/** Monaco needs literal colours, so these mirror globals.css by hand. */
function defineThemes(monaco: typeof Monaco) {
  monaco.editor.defineTheme("vault-light", {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#ffffff",
      "editorGutter.background": "#ffffff",
      "editorLineNumber.foreground": "#8b8b96",
      "editorLineNumber.activeForeground": "#16161a",
      "editor.lineHighlightBackground": "#f7f7f8",
      "editorIndentGuide.background1": "#e3e3e7",
    },
  });
  monaco.editor.defineTheme("vault-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#151519",
      "editorGutter.background": "#151519",
      "editorLineNumber.foreground": "#71717f",
      "editorLineNumber.activeForeground": "#ececf1",
      "editor.lineHighlightBackground": "#1d1d23",
      "editorIndentGuide.background1": "#2b2b33",
      "editorWidget.background": "#1d1d23",
      "editorSuggestWidget.background": "#1d1d23",
    },
  });
}

/** The page follows the OS colour scheme, and so should the editor. */
const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribeToScheme(onChange: () => void) {
  const mq = window.matchMedia(DARK_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function usePrefersDark(): boolean {
  return useSyncExternalStore(
    subscribeToScheme,
    () => window.matchMedia(DARK_QUERY).matches,
    // On the server there is no media query; light is the CSS default too.
    () => false,
  );
}
