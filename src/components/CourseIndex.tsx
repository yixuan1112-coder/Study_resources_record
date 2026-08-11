"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Plus, Search, Trash2, X } from "lucide-react";
import { colorForCode, normalizeCode, type Course } from "@/lib/types";

export function CourseIndex({
  initialCourses,
  initialError,
}: {
  initialCourses: Course[];
  initialError: string | null;
}) {
  const [courses, setCourses] = useState<Course[]>(initialCourses);
  const [error, setError] = useState<string | null>(initialError);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? courses.filter(
          (c) =>
            c.code.toLowerCase().includes(q) ||
            c.title.toLowerCase().includes(q),
        )
      : courses;

    const buckets = new Map<string, Course[]>();
    for (const c of matched) {
      const key = c.ay ? `${c.ay}${c.sem ? ` · Sem ${c.sem}` : ""}` : "Unsorted";
      const list = buckets.get(key) ?? [];
      list.push(c);
      buckets.set(key, list);
    }
    return [...buckets.entries()].sort((a, b) => {
      if (a[0] === "Unsorted") return 1;
      if (b[0] === "Unsorted") return -1;
      return b[0].localeCompare(a[0]);
    });
  }, [courses, query]);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your courses</h1>
          <p className="mt-1 text-sm text-muted">
            {courses.length} course{courses.length === 1 ? "" : "s"} indexed
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
            <input
              className="field w-44 pl-9 sm:w-56"
              placeholder="Find a course"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <button className="btn-primary" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" />
            Add course
          </button>
        </div>
      </div>

      {error && (
        <div className="card mb-6 flex items-start gap-2 border-danger/40 p-4 text-sm text-danger">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="shrink-0" title="Dismiss">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {adding && (
        <AddCourseForm
          onCancel={() => setAdding(false)}
          onAdded={(c) => {
            setCourses((prev) =>
              [...prev, c].sort((a, b) => a.code.localeCompare(b.code)),
            );
            setAdding(false);
          }}
        />
      )}

      {courses.length === 0 && !adding ? (
        <EmptyState onAdd={() => setAdding(true)} />
      ) : (
        grouped.map(([label, list]) => (
          <section key={label} className="mb-8">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-faint">
              {label}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((course) => (
                <CourseCard
                  key={course.code}
                  course={course}
                  onRemoved={() =>
                    setCourses((prev) => prev.filter((c) => c.code !== course.code))
                  }
                />
              ))}
            </div>
          </section>
        ))
      )}

      {courses.length > 0 && grouped.length === 0 && (
        <p className="py-12 text-center text-sm text-muted">
          Nothing matches “{query}”.
        </p>
      )}
    </div>
  );
}

function CourseCard({
  course,
  onRemoved,
}: {
  course: Course;
  onRemoved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const color = colorForCode(course.code);

  async function remove(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (
      !confirm(
        `Remove ${course.code} from your index?\n\nThe files stay in the GitHub repo — only the index entry is removed.`,
      )
    )
      return;
    setBusy(true);
    const res = await fetch(`/api/courses?code=${encodeURIComponent(course.code)}`, {
      method: "DELETE",
    });
    setBusy(false);
    if (res.ok) onRemoved();
    else alert("Could not remove that course.");
  }

  return (
    <Link
      href={`/course/${course.code}`}
      className="card group relative flex flex-col overflow-hidden p-4 transition-shadow hover:shadow-md"
    >
      <span
        className="absolute inset-x-0 top-0 h-1"
        style={{ backgroundColor: color }}
      />
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-sm font-semibold" style={{ color }}>
          {course.code}
        </span>
        <button
          onClick={remove}
          disabled={busy}
          className="-m-1 rounded p-1 text-faint opacity-0 transition hover:bg-raised hover:text-danger focus:opacity-100 group-hover:opacity-100"
          title="Remove from index"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="mt-1.5 line-clamp-2 text-[15px] font-medium leading-snug">
        {course.title || <span className="text-faint">Untitled course</span>}
      </p>
      {course.au && (
        <p className="mt-auto pt-3 text-xs text-faint">{course.au} AU</p>
      )}
    </Link>
  );
}

function AddCourseForm({
  onAdded,
  onCancel,
}: {
  onAdded: (c: Course) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [ay, setAy] = useState("");
  const [sem, setSem] = useState("");
  const [au, setAu] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/courses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, title, ay, sem, au }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(body.error ?? "Could not add that course");
      return;
    }
    onAdded(body.course);
  }

  return (
    <form onSubmit={submit} className="card mb-8 p-4">
      <div className="grid gap-3 sm:grid-cols-6">
        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-xs font-medium text-muted">
            Course code
          </label>
          <input
            autoFocus
            required
            className="field font-mono"
            placeholder="CZ1003"
            value={code}
            onChange={(e) => setCode(normalizeCode(e.target.value))}
          />
        </div>
        <div className="sm:col-span-4">
          <label className="mb-1.5 block text-xs font-medium text-muted">
            Title
          </label>
          <input
            className="field"
            placeholder="Introduction to Computational Thinking"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-xs font-medium text-muted">
            Academic year
          </label>
          <input
            className="field"
            placeholder="AY25/26"
            value={ay}
            onChange={(e) => setAy(e.target.value)}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-xs font-medium text-muted">
            Semester
          </label>
          <select
            className="field"
            value={sem}
            onChange={(e) => setSem(e.target.value)}
          >
            <option value="">—</option>
            <option value="1">Semester 1</option>
            <option value="2">Semester 2</option>
            <option value="Special">Special term</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-xs font-medium text-muted">
            AUs
          </label>
          <input
            className="field"
            placeholder="3"
            value={au}
            onChange={(e) => setAu(e.target.value)}
          />
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={busy || !code} className="btn-primary">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Add course
        </button>
        <button type="button" onClick={onCancel} className="btn-ghost">
          Cancel
        </button>
      </div>
    </form>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="card flex flex-col items-center px-6 py-16 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-accent-soft text-accent">
        <Plus className="h-5 w-5" />
      </div>
      <h2 className="text-lg font-semibold">No courses yet</h2>
      <p className="mt-1.5 max-w-sm text-sm leading-6 text-muted">
        Add your first course code and you can start dropping lecture slides,
        notes and photos into it straight away.
      </p>
      <button className="btn-primary mt-5" onClick={onAdd}>
        <Plus className="h-4 w-4" />
        Add your first course
      </button>
    </div>
  );
}
