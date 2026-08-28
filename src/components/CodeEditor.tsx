"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { AlertCircle, Download, Loader2, Play, Save, X } from "lucide-react";
import { fileUrl } from "./FileViewer";
import { RunPanel } from "./RunPanel";
import { runLanguageOf, type RunOutcome } from "@/lib/run";
import {
  editorOptions,
  prepareMonaco,
  themeOf,
  usePrefersDark,
} from "@/lib/monaco";
import {
  MAX_CODE_BYTES,
  formatBytes,
  languageLabelOf,
  languageOf,
  type VaultFile,
} from "@/lib/types";

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

  // Running is independent of saving: it is the buffer as typed that goes to
  // the runner, so a change can be tried out before it is committed.
  const [runtimes, setRuntimes] = useState<Set<string> | null>(null);
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [stdin, setStdin] = useState("");
  const [showRun, setShowRun] = useState(false);

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

  // Which languages the runner has installed. Null until it answers; an empty
  // set means running is switched off for this site.
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/run", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("no runner"))))
      .then((body: { languages?: string[] }) =>
        setRuntimes(new Set(body.languages ?? [])),
      )
      .catch(() => {
        if (!controller.signal.aborted) setRuntimes(new Set());
      });
    return () => controller.abort();
  }, []);

  const language = runLanguageOf(active.name);
  const canRun =
    !!language && !!runtimes?.has(language) && !buffer?.loading && !buffer?.oversize;

  const run = useCallback(async () => {
    const name = active.name;
    const buf = buffers[name];
    if (!buf || buf.loading || buf.oversize || running) return;

    setRunning(true);
    setShowRun(true);
    setOutcome(null);
    setRunError(null);
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, source: buf.text, stdin }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setRunError((body as { error?: string }).error ?? "Could not run that");
      else setOutcome(body as RunOutcome);
    } catch {
      setRunError("Could not reach the server");
    } finally {
      setRunning(false);
    }
  }, [active.name, buffers, running, stdin]);

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

  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  }, [run]);

  const handleMount: OnMount = useCallback((editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void saveRef.current();
    });
    // Ctrl/Cmd+Enter and F5, the two shortcuts a student arrives already
    // expecting from an IDE.
    const runNow = () => void runRef.current();
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, runNow);
    editor.addCommand(monaco.KeyCode.F5, runNow);

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
            theme={themeOf(dark)}
            beforeMount={prepareMonaco}
            onMount={handleMount}
            onChange={(value) => patch(active.name, { text: value ?? "" })}
            loading={
              <div className="flex items-center gap-2 text-sm text-muted">
                <Loader2 className="h-4 w-4 animate-spin" />
                Starting the editor…
              </div>
            }
            options={editorOptions(active.name, { readOnly })}
          />
        )}
      </div>

      {showRun && (
        <RunPanel
          running={running}
          outcome={outcome}
          error={runError}
          stdin={stdin}
          onStdin={setStdin}
          onClose={() => setShowRun(false)}
        />
      )}

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
        {runtimes !== null && runtimes.size > 0 && (
          <button
            onClick={() => void run()}
            disabled={!canRun || running}
            className="btn-quiet -my-1 px-2 py-1 text-xs"
            title={
              !language
                ? "The runner has no language for this file type"
                : !runtimes.has(language)
                  ? `The runner does not have ${language} installed`
                  : "Run this file (Ctrl/Cmd+Enter)"
            }
          >
            {running ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            Run
          </button>
        )}

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
