"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Download,
  FileText,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  Pencil,
  Save,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { FileViewer, fileUrl } from "./FileViewer";
import { MAX_FILE_BYTES, uploadFiles, type UploadProgress } from "@/lib/upload";
import {
  colorForCode,
  formatBytes,
  type Course,
  type FileKind,
  type VaultFile,
} from "@/lib/types";

const FILTERS: { key: FileKind | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pdf", label: "PDFs" },
  { key: "markdown", label: "Notes" },
  { key: "image", label: "Images" },
  { key: "other", label: "Other" },
];

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
  const inputRef = useRef<HTMLInputElement>(null);
  const color = colorForCode(course.code);

  const load = useCallback(async () => {
    const q = new URLSearchParams({ code: course.code });
    if (owner) q.set("owner", owner);
    const res = await fetch(`/api/files?${q}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? "Could not list this course's files");
      setFiles([]);
      return;
    }
    setFiles(body.files ?? []);
  }, [course.code, owner]);

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
          <div className="ml-auto">
            <input
              ref={inputRef}
              type="file"
              multiple
              hidden
              onChange={(e) => void handleUpload(e.target.files)}
            />
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

      <div className="mb-4 flex flex-wrap gap-1.5">
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
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <div className="card divide-y divide-line overflow-hidden">
          {shown.length === 0 ? (
            readOnly ? (
              <p className="px-6 py-14 text-center text-sm text-muted">
                {owner} hasn&apos;t added anything to this course yet.
              </p>
            ) : (
              <DropHint onPick={() => inputRef.current?.click()} />
            )
          ) : (
            shown.map((file) => (
              <FileRow
                key={file.path}
                file={file}
                code={course.code}
                owner={owner}
                myCourses={myCourses}
                active={selected?.path === file.path}
                onOpen={() => setSelected(file)}
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
          {selected ? (
            <FileViewer
              code={course.code}
              file={selected}
              owner={owner}
              onClose={() => setSelected(null)}
            />
          ) : (
            <div className="flex h-full min-h-[420px] flex-col items-center justify-center px-6 text-center">
              <FileText className="mb-3 h-8 w-8 text-faint" />
              <p className="text-sm text-muted">
                Pick a file on the left to read it here.
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
              PDFs, markdown and images · up to {formatBytes(MAX_FILE_BYTES)} each
            </p>
          </div>
        </div>
      )}
    </main>
  );
}

function DropHint({ onPick }: { onPick: () => void }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <Paperclip className="mb-3 h-6 w-6 text-faint" />
      <p className="text-sm font-medium">Nothing here yet</p>
      <p className="mt-1 text-xs leading-5 text-muted">
        Drag files anywhere on this page, or
      </p>
      <button onClick={onPick} className="btn-ghost mt-3">
        Choose files
      </button>
    </div>
  );
}

const ICONS: Record<FileKind, React.ReactNode> = {
  pdf: <FileText className="h-4 w-4" />,
  markdown: <FileText className="h-4 w-4" />,
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
  onChanged,
  onNotice,
}: {
  file: VaultFile;
  code: string;
  owner?: string;
  myCourses: Course[];
  active: boolean;
  onOpen: () => void;
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
