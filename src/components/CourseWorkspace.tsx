"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  ClipboardPaste,
  Code2,
  Download,
  FileCode2,
  FileText,
  Image as ImageIcon,
  Loader2,
  NotebookPen,
  Paperclip,
  Pencil,
  RefreshCw,
  Save,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { CodeEditor } from "./CodeEditor";
import { CodePad } from "./CodePad";
import { FileViewer, fileUrl } from "./FileViewer";
import { MAX_FILE_BYTES, uploadFiles, type UploadProgress } from "@/lib/upload";
import {
  MAX_CODE_BYTES,
  colorForCode,
  formatBytes,
  isCodeFile,
  languageLabelOf,
  suggestFilename,
  type Course,
  type FileKind,
  type VaultFile,
} from "@/lib/types";

const FILTERS: { key: FileKind | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pdf", label: "PDFs" },
  { key: "markdown", label: "Notes" },
  { key: "code", label: "Code" },
  { key: "image", label: "Images" },
  { key: "other", label: "Other" },
];

/**
 * How often to re-list the course while the tab is in front.
 *
 * A vault is a GitHub repo other people can also be looking at, so files can
 * appear without this browser having done anything — someone you share with
 * uploads a lecture, or you drop a file in on your phone. Without a poll the
 * only way to find out is a full page reload.
 */
const REFRESH_MS = 15_000;

/**
 * Adopt the server's listing, but keep the blob sha of any file that is open in
 * an editor tab. Those rows are kept current by `handleSaved`; a poll that
 * started before a save landed would otherwise put the pre-save sha back and
 * make the next rename or delete fail with a 409.
 */
function mergeFiles(
  prev: VaultFile[],
  next: VaultFile[],
  open: string[],
): VaultFile[] {
  if (open.length === 0) return next;
  const mine = new Map(prev.map((f) => [f.name, f.sha]));
  return next.map((f) =>
    open.includes(f.name) && mine.has(f.name)
      ? { ...f, sha: mine.get(f.name)! }
      : f,
  );
}

export function CourseWorkspace({
  course,
  initialFiles,
  owner,
  myCourses = [],
}: {
  course: Course;
  initialFiles: VaultFile[];
  /** Set when viewing a vault someone shared — the page becomes read-only. */
  owner?: string;
  /** Destinations offered by "Save to my vault". */
  myCourses?: Course[];
}) {
  const readOnly = !!owner;
  const [files, setFiles] = useState<VaultFile[]>(initialFiles);
  const [selected, setSelected] = useState<VaultFile | null>(null);
  const [filter, setFilter] = useState<FileKind | "all">("all");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [dragging, setDragging] = useState(false);
  /** A background re-list is in flight; drives the spinner on the button. */
  const [syncing, setSyncing] = useState(false);
  /** null = closed. `{}` = writing a new note. `{ file }` = editing that note. */
  const [composing, setComposing] = useState<{ file?: VaultFile } | null>(null);
  const [creatingFile, setCreatingFile] = useState(false);
  /** Filenames open as editor tabs, in tab order. */
  const [openNames, setOpenNames] = useState<string[]>([]);
  const [activeName, setActiveName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const color = colorForCode(course.code);

  // Tabs are derived from the file list rather than stored, so a file that is
  // renamed or deleted elsewhere on the page simply stops being a tab.
  const tabs = useMemo(
    () =>
      openNames
        .map((n) => files.find((f) => f.name === n))
        .filter((f): f is VaultFile => !!f),
    [openNames, files],
  );
  const activeTab =
    tabs.find((f) => f.name === activeName) ?? tabs[tabs.length - 1] ?? null;

  /** Code opens in the editor; everything else opens in the preview pane. */
  const openFile = useCallback((file: VaultFile) => {
    if (file.kind === "code") {
      setSelected(null);
      setOpenNames((prev) =>
        prev.includes(file.name) ? prev : [...prev, file.name],
      );
      setActiveName(file.name);
    } else {
      setSelected(file);
    }
  }, []);

  const closeTab = useCallback(
    (file: VaultFile) => {
      const i = openNames.indexOf(file.name);
      const next = openNames.filter((n) => n !== file.name);
      setOpenNames(next);
      if (activeName === file.name) {
        setActiveName(next[Math.min(i, next.length - 1)] ?? null);
      }
    },
    [activeName, openNames],
  );

  /** Keep the row's sha current after a save, so rename and delete still work. */
  const handleSaved = useCallback((name: string, sha: string) => {
    setFiles((prev) => prev.map((f) => (f.name === name ? { ...f, sha } : f)));
  }, []);

  // Read by `load`, which must not be rebuilt every time a tab opens or an
  // upload ticks — the polling effect below depends on its identity.
  const openNamesRef = useRef<string[]>([]);
  useEffect(() => {
    openNamesRef.current = openNames;
  }, [openNames]);

  /** Skip polling while something is mid-flight or a dialog owns the screen. */
  const busyRef = useRef(false);
  useEffect(() => {
    busyRef.current = !!progress || !!composing || creatingFile;
  }, [progress, composing, creatingFile]);

  const load = useCallback(
    async ({ background = false }: { background?: boolean } = {}) => {
      if (background) setSyncing(true);
      try {
        const q = new URLSearchParams({ code: course.code });
        if (owner) q.set("owner", owner);
        const res = await fetch(`/api/files?${q}`, { cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          // A poll that fails is not worth interrupting the page for: a dropped
          // request or a rate limit would otherwise blank the list and shout at
          // someone who did nothing. Keep what is on screen and try again.
          if (background) return;
          setError(body.error ?? "Could not list this course's files");
          setFiles([]);
          return;
        }
        setFiles((prev) =>
          mergeFiles(prev, body.files ?? [], openNamesRef.current),
        );
      } finally {
        if (background) setSyncing(false);
      }
    },
    [course.code, owner],
  );

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      if (busyRef.current) return;
      void load({ background: true });
    };
    const id = setInterval(tick, REFRESH_MS);
    // Coming back to the tab should feel instant rather than wait out the
    // interval, and a backgrounded tab should not poll GitHub at all.
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
    };
  }, [load]);

  const handleUpload = useCallback(
    async (picked: FileList | File[] | null) => {
      if (readOnly) return;
      const list = [...(picked ?? [])];
      if (list.length === 0) return;
      setError(null);
      setProgress({ done: 0, total: list.length, current: list[0].name });
      try {
        await uploadFiles(
          course.code,
          list,
          files.map((f) => f.name),
          setProgress,
        );
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setProgress(null);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [course.code, files, load, readOnly],
  );

  const shown = useMemo(
    () => files.filter((f) => filter === "all" || f.kind === filter),
    [files, filter],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: files.length };
    for (const f of files) c[f.kind] = (c[f.kind] ?? 0) + 1;
    return c;
  }, [files]);

  return (
    <main
      className="mx-auto max-w-6xl px-4 py-6 sm:px-6"
      onDragOver={(e) => {
        if (readOnly) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        if (readOnly) return;
        e.preventDefault();
        setDragging(false);
        void handleUpload(e.dataTransfer.files);
      }}
    >
      <Link
        href={owner ? `/u/${owner}` : "/dashboard"}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" />
        {owner ? `${owner}'s courses` : "All courses"}
      </Link>

      <div className="mb-6 flex flex-wrap items-end gap-4">
        <div>
          <h1 className="font-mono text-2xl font-semibold" style={{ color }}>
            {course.code}
          </h1>
          <p className="mt-1 text-[15px] text-muted">
            {course.title || "Untitled course"}
            {course.ay && <span className="text-faint"> · {course.ay}</span>}
            {course.sem && <span className="text-faint"> Sem {course.sem}</span>}
          </p>
        </div>

        {readOnly ? (
          <p className="ml-auto rounded-lg bg-raised px-3 py-1.5 text-xs text-muted">
            Shared by <span className="font-medium text-ink">{owner}</span> ·
            read only
          </p>
        ) : (
          <div className="ml-auto flex items-center gap-2">
            <input
              ref={inputRef}
              type="file"
              multiple
              hidden
              onChange={(e) => void handleUpload(e.target.files)}
            />
            <button
              className="btn-ghost"
              onClick={() => setComposing({})}
              title="Write a summary without uploading a file"
            >
              <NotebookPen className="h-4 w-4" />
              Write a note
            </button>
            <button
              className="btn-ghost"
              onClick={() => setCreatingFile(true)}
              title="Start a source file, or paste one in"
            >
              <Code2 className="h-4 w-4" />
              New code file
            </button>
            <button
              className="btn-primary"
              disabled={!!progress}
              onClick={() => inputRef.current?.click()}
            >
              {progress ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {progress
                ? `Uploading ${progress.done + 1}/${progress.total}`
                : "Upload files"}
            </button>
          </div>
        )}
      </div>

      {progress && (
        <div className="card mb-4 p-3">
          <div className="flex items-center justify-between text-xs text-muted">
            <span className="truncate">{progress.current}</span>
            <span>
              {progress.done}/{progress.total}
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-raised">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${(progress.done / progress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {notice && (
        <div className="card mb-4 flex items-start gap-2 border-accent/40 p-3 text-sm">
          <span className="flex-1">{notice}</span>
          <button onClick={() => setNotice(null)} className="shrink-0 text-faint">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {error && (
        <div className="card mb-4 flex items-start gap-2 border-danger/40 p-3 text-sm text-danger">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {creatingFile && !readOnly && (
        <NewCodeFile
          code={course.code}
          onCancel={() => setCreatingFile(false)}
          onCreated={async (name) => {
            setCreatingFile(false);
            await load();
            setSelected(null);
            setOpenNames((prev) =>
              prev.includes(name) ? prev : [...prev, name],
            );
            setActiveName(name);
          }}
        />
      )}

      {composing && !readOnly && (
        <NoteComposer
          code={course.code}
          file={composing.file}
          onCancel={() => setComposing(null)}
          onSaved={async (msg) => {
            setComposing(null);
            setNotice(msg);
            setSelected(null);
            await load();
          }}
        />
      )}

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => {
          const n = f.key === "all" ? counts.all : (counts[f.key] ?? 0);
          if (f.key !== "all" && n === 0) return null;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                filter === f.key
                  ? "bg-accent-soft font-medium text-accent"
                  : "text-muted hover:bg-raised"
              }`}
            >
              {f.label}
              <span className="ml-1.5 text-xs text-faint">{n}</span>
            </button>
          );
        })}
        <button
          onClick={() => void load({ background: true })}
          disabled={syncing}
          className="ml-auto rounded p-1.5 text-faint hover:bg-raised hover:text-ink"
          title={
            readOnly
              ? `Check for files ${owner} has added`
              : "Check for new files"
          }
        >
          <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <div className="card divide-y divide-line overflow-hidden">
          {shown.length === 0 ? (
            readOnly ? (
              <p className="px-6 py-14 text-center text-sm text-muted">
                {owner} hasn&apos;t added anything to this course yet.
              </p>
            ) : (
              <DropHint
                onPick={() => inputRef.current?.click()}
                onWriteNote={() => setComposing({})}
                onNewCodeFile={() => setCreatingFile(true)}
              />
            )
          ) : (
            shown.map((file) => (
              <FileRow
                key={file.path}
                file={file}
                code={course.code}
                owner={owner}
                myCourses={myCourses}
                active={
                  selected?.path === file.path ||
                  (!selected && activeTab?.path === file.path)
                }
                onOpen={() => openFile(file)}
                onEdit={() => setComposing({ file })}
                onNotice={setNotice}
                onChanged={async () => {
                  setSelected(null);
                  await load();
                }}
              />
            ))
          )}
        </div>

        <div className="card min-h-[420px] overflow-hidden">
          {/* The editor stays mounted while a PDF or an image is being
              previewed, so glancing at one never discards unsaved code. */}
          {activeTab && (
            <div className={selected ? "hidden" : "h-full"}>
              <CodeEditor
                code={course.code}
                tabs={tabs}
                active={activeTab}
                owner={owner}
                onActivate={(f) => setActiveName(f.name)}
                onClose={closeTab}
                onSaved={handleSaved}
              />
            </div>
          )}

          {selected ? (
            <FileViewer
              code={course.code}
              file={selected}
              owner={owner}
              onClose={() => setSelected(null)}
            />
          ) : activeTab ? null : (
            <div className="flex h-full min-h-[420px] flex-col items-center justify-center px-6 text-center">
              <FileText className="mb-3 h-8 w-8 text-faint" />
              <p className="text-sm text-muted">
                Pick a file on the left to read it here.
              </p>
              <p className="mt-1 text-xs text-faint">
                Source files open in the editor.
              </p>
            </div>
          )}
        </div>
      </div>

      {dragging && !readOnly && (
        <div className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center bg-accent/5 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-accent bg-surface px-8 py-6 text-center shadow-lg">
            <Upload className="mx-auto mb-2 h-6 w-6 text-accent" />
            <p className="font-medium">Drop into {course.code}</p>
            <p className="mt-1 text-xs text-muted">
              Any file type · up to {formatBytes(MAX_FILE_BYTES)} each
            </p>
          </div>
        </div>
      )}
    </main>
  );
}

function DropHint({
  onPick,
  onWriteNote,
  onNewCodeFile,
}: {
  onPick: () => void;
  onWriteNote: () => void;
  onNewCodeFile: () => void;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <Paperclip className="mb-3 h-6 w-6 text-faint" />
      <p className="text-sm font-medium">Nothing here yet</p>
      <p className="mt-1 text-xs leading-5 text-muted">
        Drag files of any type anywhere on this page, or
      </p>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        <button onClick={onPick} className="btn-ghost">
          Choose files
        </button>
        <button onClick={onWriteNote} className="btn-ghost">
          <NotebookPen className="h-4 w-4" />
          Write a note
        </button>
        <button onClick={onNewCodeFile} className="btn-ghost">
          <Code2 className="h-4 w-4" />
          New code file
        </button>
      </div>
    </div>
  );
}

const ICONS: Record<FileKind, React.ReactNode> = {
  pdf: <FileText className="h-4 w-4" />,
  markdown: <FileText className="h-4 w-4" />,
  code: <FileCode2 className="h-4 w-4" />,
  image: <ImageIcon className="h-4 w-4" />,
  other: <Paperclip className="h-4 w-4" />,
};

function FileRow({
  file,
  code,
  owner,
  myCourses,
  active,
  onOpen,
  onEdit,
  onChanged,
  onNotice,
}: {
  file: VaultFile;
  code: string;
  owner?: string;
  myCourses: Course[];
  active: boolean;
  onOpen: () => void;
  /** Only offered for notes, and only in my own vault. */
  onEdit: () => void;
  onChanged: () => void;
  onNotice: (msg: string) => void;
}) {
  const readOnly = !!owner;
  const [renaming, setRenaming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(file.name);
  const [busy, setBusy] = useState(false);

  async function rename(e: React.FormEvent) {
    e.preventDefault();
    if (name === file.name) return setRenaming(false);
    setBusy(true);
    const res = await fetch("/api/files", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: file.name, sha: file.sha, newName: name }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      alert(body.error ?? "Rename failed");
      return;
    }
    setRenaming(false);
    onChanged();
  }

  async function remove() {
    if (!confirm(`Delete ${file.name}? This removes it from the repo.`)) return;
    setBusy(true);
    const res = await fetch(
      `/api/files?code=${encodeURIComponent(code)}&name=${encodeURIComponent(file.name)}&sha=${file.sha}`,
      { method: "DELETE" },
    );
    setBusy(false);
    if (!res.ok) {
      alert("Could not delete that file.");
      return;
    }
    onChanged();
  }

  async function saveToMyVault(toCode: string) {
    setBusy(true);
    const res = await fetch("/api/copy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromOwner: owner, fromCode: code, name: file.name, toCode }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    setSaving(false);
    if (!res.ok) {
      alert(body.error ?? "Could not save that file");
      return;
    }
    onNotice(`Saved ${body.name} into your ${toCode}.`);
  }

  if (renaming) {
    return (
      <form onSubmit={rename} className="flex items-center gap-1.5 p-2">
        <input
          autoFocus
          className="field py-1.5 text-[13px]"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setRenaming(false)}
        />
        <button type="submit" disabled={busy} className="btn-quiet px-2 py-1.5">
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
        </button>
        <button
          type="button"
          onClick={() => {
            setName(file.name);
            setRenaming(false);
          }}
          className="btn-quiet px-2 py-1.5"
        >
          <X className="h-4 w-4" />
        </button>
      </form>
    );
  }

  if (saving) {
    return (
      <div className="p-2.5">
        <p className="mb-2 text-xs text-muted">
          Save <span className="font-medium text-ink">{file.name}</span> into:
        </p>
        <div className="flex items-center gap-1.5">
          <select
            autoFocus
            className="field py-1.5 text-[13px]"
            defaultValue=""
            disabled={busy}
            onChange={(e) => e.target.value && void saveToMyVault(e.target.value)}
          >
            <option value="" disabled>
              Choose one of your courses…
            </option>
            {myCourses.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code}
                {c.title ? ` — ${c.title}` : ""}
              </option>
            ))}
          </select>
          <button
            onClick={() => setSaving(false)}
            disabled={busy}
            className="btn-quiet px-2 py-1.5"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <X className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`group flex items-center gap-2.5 p-3 transition-colors ${
        active ? "bg-accent-soft" : "hover:bg-raised"
      }`}
    >
      <button
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
      >
        <span className={active ? "text-accent" : "text-faint"}>
          {ICONS[file.kind]}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{file.name}</span>
          <span className="block text-xs text-faint">{formatBytes(file.size)}</span>
        </span>
      </button>

      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
        <a
          href={fileUrl(code, file.name, { download: true, owner })}
          className="rounded p-1.5 text-faint hover:bg-surface hover:text-ink"
          title="Download"
        >
          <Download className="h-3.5 w-3.5" />
        </a>

        {readOnly ? (
          myCourses.length > 0 && (
            <button
              onClick={() => setSaving(true)}
              className="rounded p-1.5 text-faint hover:bg-surface hover:text-accent"
              title="Save a copy to my vault"
            >
              <Save className="h-3.5 w-3.5" />
            </button>
          )
        ) : (
          <>
            {file.kind === "markdown" && (
              <button
                onClick={onEdit}
                className="rounded p-1.5 text-faint hover:bg-surface hover:text-accent"
                title="Edit this note"
              >
                <NotebookPen className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              onClick={() => setRenaming(true)}
              className="rounded p-1.5 text-faint hover:bg-surface hover:text-ink"
              title="Rename"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={remove}
              disabled={busy}
              className="rounded p-1.5 text-faint hover:bg-surface hover:text-danger"
              title="Delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Write a note straight into the course — no file to upload. Creating one
 * POSTs to /api/note; opening an existing note loads its markdown and PUTs the
 * edit back. Deleting is the ordinary file delete, so nothing extra is needed.
 */
function NoteComposer({
  code,
  file,
  onCancel,
  onSaved,
}: {
  code: string;
  /** Set when editing an existing note, absent when writing a new one. */
  file?: VaultFile;
  onCancel: () => void;
  onSaved: (message: string) => void;
}) {
  const editing = !!file;
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(editing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!file) return;
    // `loading` already starts true when editing, so nothing is set here
    // synchronously — only once the fetch settles.
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch(fileUrl(code, file.name), {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("Could not open that note");
        const body = await res.text();
        setText(body);
        setLoading(false);
      } catch (e: unknown) {
        if (controller.signal.aborted) return;
        setError(e instanceof Error ? e.message : "Could not open that note");
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [code, file]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/note", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          editing
            ? { code, name: file.name, sha: file.sha, text }
            : { code, title, text },
        ),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Could not save that note");
        return;
      }
      onSaved(
        editing ? `Updated ${file.name}.` : `Saved ${body.name} to ${code}.`,
      );
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="card mb-4 p-4">
      <div className="mb-3 flex items-center gap-2">
        <NotebookPen className="h-4 w-4 text-accent" />
        <h2 className="text-sm font-medium">
          {editing ? `Editing ${file.name}` : `New note in ${code}`}
        </h2>
        <button
          type="button"
          onClick={onCancel}
          className="ml-auto rounded p-1 text-faint hover:bg-raised hover:text-ink"
          title="Cancel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {!editing && (
        <input
          autoFocus
          className="field mb-2"
          placeholder="Title — becomes the note's filename"
          value={title}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
        />
      )}

      <textarea
        autoFocus={editing}
        className="field min-h-[160px] resize-y font-mono text-[13px] leading-6"
        placeholder={
          editing
            ? "Markdown…"
            : "A few words summarising this topic. Markdown works — # headings, **bold**, - lists."
        }
        value={loading ? "" : text}
        disabled={loading}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          // Ctrl/Cmd+Enter saves, so a long note never needs the mouse.
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save(e);
        }}
      />

      {error && <p className="mt-2 text-sm text-danger">{error}</p>}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="submit"
          className="btn-primary"
          disabled={busy || loading || (!editing && !title.trim() && !text.trim()) || (editing && !text.trim())}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
          {editing ? "Save changes" : "Save note"}
        </button>
        <button type="button" onClick={onCancel} className="btn-ghost">
          Cancel
        </button>
        <span className="ml-auto text-xs text-faint">
          {loading ? "Loading…" : "Saved into your vault as a .md file"}
        </span>
      </div>
    </form>
  );
}


/**
 * Start a source file in this course, either from scratch or from code pasted
 * in. Both land in the same place, so this is one panel rather than two: name
 * it, optionally paste into it, and it opens in the editor.
 *
 * Pasting first is the common order — you copy something out of an IDE and
 * only then think about what to call it — so a paste into an empty name box
 * fills in a name and leaves the stem selected, ready to be typed over.
 */
function NewCodeFile({
  code,
  onCancel,
  onCreated,
}: {
  code: string;
  onCancel: () => void;
  onCreated: (name: string) => void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const trimmed = name.trim();
  // Checked here only to say so immediately; the server checks it again.
  const unknownType = trimmed !== "" && !isCodeFile(trimmed);
  const bytes = useMemo(
    () => new TextEncoder().encode(text).length,
    [text],
  );
  const tooBig = bytes > MAX_CODE_BYTES;

  // Fires only for a paste that filled the whole editor, so there is never
  // pasted code being overwritten. A name already typed is a deliberate
  // choice, though, and a paste should not undo it.
  function handlePaste(pasted: string) {
    if (name !== "") return;
    const guess = suggestFilename(pasted);
    if (!guess) return;

    setName(guess);
    // Select just the stem, so the next keystroke replaces "untitled" and
    // keeps the extension the guess got right.
    const stem = guess.lastIndexOf(".");
    requestAnimationFrame(() => {
      nameRef.current?.focus();
      nameRef.current?.setSelectionRange(0, stem);
    });
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !trimmed || unknownType || tooBig) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Omitting `text` entirely is what asks for the starter template.
        body: JSON.stringify({ code, name: trimmed, ...(text ? { text } : {}) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Could not create that file");
        return;
      }
      await onCreated(body.name as string);
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={create} className="card mb-4 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Code2 className="h-4 w-4 text-accent" />
        <h2 className="text-sm font-medium">New code file in {code}</h2>
        <button
          type="button"
          onClick={onCancel}
          className="ml-auto rounded p-1 text-faint hover:bg-raised hover:text-ink"
          title="Cancel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <input
        ref={nameRef}
        autoFocus
        className="field font-mono text-[13px]"
        placeholder="lab1.py"
        value={name}
        maxLength={120}
        spellCheck={false}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
      />

      {unknownType ? (
        <p className="mt-2 text-sm text-danger">
          The editor doesn&apos;t know that extension. Try .py, .java, .c, .cpp,
          .js, .ts, .html, .sql, .r or .m.
        </p>
      ) : (
        <p className="mt-2 text-xs text-faint">
          The extension picks the language — lab1.py, Matrix.java, solution.cpp.
        </p>
      )}

      <div className="mt-3">
        <CodePad
          value={text}
          filename={trimmed}
          onChange={setText}
          onPasteAll={handlePaste}
          onEscape={onCancel}
          onSubmit={() => formRef.current?.requestSubmit()}
          placeholder="Paste code here — or leave this empty to start from a template."
        />
      </div>

      <div className="mt-2 flex items-center gap-3 text-xs text-faint">
        {text ? (
          <span>
            {text.split("\n").length} lines · {formatBytes(bytes)}
          </span>
        ) : (
          <span>Empty — you&apos;ll get a starter template.</span>
        )}
        <span>Tab indents · Ctrl/⌘+Space suggests</span>
        {!unknownType && trimmed !== "" && (
          <span className="ml-auto">{languageLabelOf(trimmed)}</span>
        )}
      </div>

      {tooBig && (
        <p className="mt-2 text-sm text-danger">
          That snippet is {formatBytes(bytes)} — the limit for pasting is{" "}
          {formatBytes(MAX_CODE_BYTES)}. Upload it as a file instead.
        </p>
      )}

      {error && <p className="mt-2 text-sm text-danger">{error}</p>}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="submit"
          className="btn-primary"
          disabled={busy || !trimmed || unknownType || tooBig}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : text ? (
            <ClipboardPaste className="h-4 w-4" />
          ) : (
            <Check className="h-4 w-4" />
          )}
          Create and open
        </button>
        <button type="button" onClick={onCancel} className="btn-ghost">
          Cancel
        </button>
      </div>
    </form>
  );
}
