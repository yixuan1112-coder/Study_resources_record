"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  AlertCircle,
  Highlighter,
  Loader2,
  MessageSquareText,
  SquareDashed,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  HIGHLIGHT_COLORS,
  inReadingOrder,
  type Annotation,
  type HighlightColor,
  type Rect,
} from "@/lib/annotations";

/** The library is ~450 KB, so it is only fetched once a PDF is actually opened. */
type PdfLib = typeof import("pdfjs-dist");

let libPromise: Promise<PdfLib> | null = null;

function loadPdfLib(): Promise<PdfLib> {
  libPromise ??= import("pdfjs-dist").then((lib) => {
    // Everything fetched at runtime is served from our own origin — see
    // scripts/sync-pdfjs.mjs.
    lib.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
    return lib;
  });
  return libPromise;
}

const ASSET_URLS = {
  cMapUrl: "/pdfjs/cmaps/",
  cMapPacked: true,
  standardFontDataUrl: "/pdfjs/standard_fonts/",
  wasmUrl: "/pdfjs/wasm/",
  iccUrl: "/pdfjs/iccs/",
} as const;

/** Highlight fills. Alpha rather than solid, so the words stay readable. */
const SWATCH: Record<HighlightColor, { fill: string; chip: string }> = {
  yellow: { fill: "rgb(250 204 21 / 0.38)", chip: "#facc15" },
  green: { fill: "rgb(74 222 128 / 0.36)", chip: "#4ade80" },
  blue: { fill: "rgb(96 165 250 / 0.36)", chip: "#60a5fa" },
  pink: { fill: "rgb(244 114 182 / 0.36)", chip: "#f472b6" },
};

const MIN_SCALE = 0.4;
const MAX_SCALE = 3;

type SaveState = "idle" | "dirty" | "saving" | "error";

/** A selection that has been measured but not yet turned into a highlight. */
type PendingSelection = {
  /** Rects grouped by page — a selection can run across a page break. */
  byPage: { page: number; rects: Rect[] }[];
  text: string;
  /** Where to float the little colour picker, in scroll-content coordinates. */
  left: number;
  top: number;
};

export function PdfViewer({
  code,
  file,
  src,
  owner,
}: {
  code: string;
  file: { name: string };
  /** The proxied URL of the PDF itself. */
  src: string;
  /** Set when reading someone else's vault — their notes become read-only. */
  owner?: string;
}) {
  const readOnly = !!owner;

  const [lib, setLib] = useState<PdfLib | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  /** Page dimensions at scale 1, so pages can be laid out before they render. */
  const [sizes, setSizes] = useState<{ width: number; height: number }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [scale, setScale] = useState(1);
  const [fitted, setFitted] = useState(false);
  const [pageNow, setPageNow] = useState(1);

  const [items, setItems] = useState<Annotation[]>([]);
  const [sha, setSha] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [loadingNotes, setLoadingNotes] = useState(true);

  const [color, setColor] = useState<HighlightColor>("yellow");
  const [boxMode, setBoxMode] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [pending, setPending] = useState<PendingSelection | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const pageEls = useRef(new Map<number, HTMLElement>());

  // ---- load the document -------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    loadPdfLib().then(
      (l) => !cancelled && setLib(l),
      () => !cancelled && setError("Could not start the PDF reader"),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!lib) return;
    let cancelled = false;
    const task = lib.getDocument({ url: src, ...ASSET_URLS });

    task.promise.then(
      async (loaded) => {
        // The loading task's own destroy() in the cleanup below tears the
        // document down; there is nothing extra to release here.
        if (cancelled) return;
        const measured = await Promise.all(
          Array.from({ length: loaded.numPages }, (_, i) =>
            loaded.getPage(i + 1).then((p) => {
              const { width, height } = p.getViewport({ scale: 1 });
              return { width, height };
            }),
          ),
        );
        if (cancelled) return;
        setDoc(loaded);
        setSizes(measured);
      },
      (e: Error) => {
        if (!cancelled) setError(e?.message ?? "Could not open this PDF");
      },
    );

    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [lib, src]);

  // Start at whatever zoom makes the widest page fill the column.
  useEffect(() => {
    if (fitted || sizes.length === 0 || !scrollRef.current) return;
    const widest = Math.max(...sizes.map((s) => s.width));
    const room = scrollRef.current.clientWidth - 32;
    if (room <= 0) return;
    setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, room / widest)));
    setFitted(true);
  }, [sizes, fitted]);

  // ---- load and save the annotations -------------------------------------

  useEffect(() => {
    const params = new URLSearchParams({ code, name: file.name });
    if (owner) params.set("owner", owner);
    // `loadingNotes` already starts true, and the viewer is keyed on the file,
    // so a different PDF arrives as a fresh mount rather than a re-fetch here.
    const controller = new AbortController();
    fetch(`/api/annotations?${params}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("notes"))))
      .then((body: { items: Annotation[]; sha: string | null }) => {
        setItems(body.items ?? []);
        setSha(body.sha ?? null);
        setLoadingNotes(false);
      })
      .catch(() => {
        // A vault with no notes yet is indistinguishable from one we could not
        // read, and neither should stop the PDF from being readable.
        if (!controller.signal.aborted) setLoadingNotes(false);
      });
    return () => controller.abort();
  }, [code, file.name, owner]);

  // The save has to see the newest items and sha without being re-created on
  // every keystroke, which would restart the debounce below.
  const latest = useRef({ items, sha });
  useEffect(() => {
    latest.current = { items, sha };
  }, [items, sha]);

  const save = useCallback(async () => {
    setSaveState("saving");
    try {
      const res = await fetch("/api/annotations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          name: file.name,
          sha: latest.current.sha,
          items: latest.current.items,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveState("error");
        return;
      }
      setSha(body.sha as string);
      setSaveState("idle");
    } catch {
      setSaveState("error");
    }
  }, [code, file.name]);

  // Marking up a PDF is a burst of small edits, so they are batched rather
  // than committed one highlight at a time.
  useEffect(() => {
    if (saveState !== "dirty") return;
    const timer = setTimeout(() => void save(), 1200);
    return () => clearTimeout(timer);
  }, [saveState, save]);

  useEffect(() => {
    if (saveState === "idle") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveState]);

  const mutate = useCallback(
    (next: (prev: Annotation[]) => Annotation[]) => {
      if (readOnly) return;
      setItems(next);
      setSaveState("dirty");
    },
    [readOnly],
  );

  // ---- turning a selection into highlights --------------------------------

  const measureSelection = useCallback(() => {
    const scroller = scrollRef.current;
    const selection = window.getSelection();
    if (!scroller || !selection || selection.isCollapsed || selection.rangeCount === 0) {
      setPending(null);
      return;
    }
    const range = selection.getRangeAt(0);
    if (!scroller.contains(range.commonAncestorContainer)) {
      setPending(null);
      return;
    }

    const clientRects = Array.from(range.getClientRects());
    const byPage: { page: number; rects: Rect[] }[] = [];
    let anchor: DOMRect | null = null;

    for (const [page, el] of pageEls.current) {
      const box = el.getBoundingClientRect();
      const rects: Rect[] = [];
      for (const r of clientRects) {
        if (r.width <= 0 || r.height <= 0) continue;
        // Keep only what actually overlaps this page — a selection running
        // across a page break reports rects for both.
        const left = Math.max(r.left, box.left);
        const right = Math.min(r.right, box.right);
        const top = Math.max(r.top, box.top);
        const bottom = Math.min(r.bottom, box.bottom);
        if (right - left <= 0.5 || bottom - top <= 0.5) continue;
        rects.push({
          x: (left - box.left) / box.width,
          y: (top - box.top) / box.height,
          w: (right - left) / box.width,
          h: (bottom - top) / box.height,
        });
        if (!anchor || r.bottom > anchor.bottom) anchor = r;
      }
      if (rects.length > 0) byPage.push({ page, rects });
    }

    if (byPage.length === 0 || !anchor) {
      setPending(null);
      return;
    }

    const box = scroller.getBoundingClientRect();
    setPending({
      byPage: byPage.sort((a, b) => a.page - b.page),
      text: selection.toString().replace(/\s+/g, " ").trim(),
      left: anchor.left - box.left + scroller.scrollLeft,
      top: anchor.bottom - box.top + scroller.scrollTop + 6,
    });
  }, []);

  const commitPending = useCallback(
    (withNote: boolean, chosen: HighlightColor = color) => {
      if (!pending) return;
      const created: Annotation[] = pending.byPage.map((group, i) => ({
        id: crypto.randomUUID(),
        page: group.page,
        rects: group.rects,
        color: chosen,
        // The quoted words go on the first page's piece; repeating the whole
        // quote on each fragment would just make the notes list noisy.
        text: i === 0 ? pending.text : undefined,
        note: "",
        createdAt: new Date().toISOString(),
      }));
      mutate((prev) => [...prev, ...created]);
      setPending(null);
      window.getSelection()?.removeAllRanges();
      if (withNote) {
        setPanelOpen(true);
        setActiveId(created[0].id);
      }
    },
    [pending, color, mutate],
  );

  const addBox = useCallback(
    (page: number, rect: Rect) => {
      const created: Annotation = {
        id: crypto.randomUUID(),
        page,
        rects: [rect],
        color,
        note: "",
        createdAt: new Date().toISOString(),
      };
      mutate((prev) => [...prev, created]);
      setPanelOpen(true);
      setActiveId(created.id);
    },
    [color, mutate],
  );

  const removeAnnotation = useCallback(
    (id: string) => {
      mutate((prev) => prev.filter((a) => a.id !== id));
      setActiveId((current) => (current === id ? null : current));
    },
    [mutate],
  );

  const setNote = useCallback(
    (id: string, note: string) => {
      mutate((prev) => prev.map((a) => (a.id === id ? { ...a, note } : a)));
    },
    [mutate],
  );

  const setColorOf = useCallback(
    (id: string, next: HighlightColor) => {
      mutate((prev) => prev.map((a) => (a.id === id ? { ...a, color: next } : a)));
    },
    [mutate],
  );

  const jumpTo = useCallback((a: Annotation) => {
    setActiveId(a.id);
    pageEls.current.get(a.page)?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, []);

  // Which page is being read, for the indicator in the toolbar.
  const onScroll = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const middle = scroller.getBoundingClientRect().top + scroller.clientHeight / 3;
    let best = 1;
    for (const [page, el] of pageEls.current) {
      if (el.getBoundingClientRect().top <= middle) best = Math.max(best, page);
    }
    setPageNow(best);
  }, []);

  const byPage = useMemo(() => {
    const map = new Map<number, Annotation[]>();
    for (const a of items) {
      const list = map.get(a.page);
      if (list) list.push(a);
      else map.set(a.page, [a]);
    }
    return map;
  }, [items]);

  const ordered = useMemo(() => inReadingOrder(items), [items]);

  if (error) {
    return (
      <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-2 px-6 text-center">
        <AlertCircle className="h-5 w-5 text-danger" />
        <p className="text-sm text-danger">{error}</p>
        <a href={src} target="_blank" rel="noreferrer" className="btn-ghost mt-2">
          Open the file directly
        </a>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-[70vh] flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-raised/50 px-2 py-1.5 text-xs">
        <button
          onClick={() => setScale((s) => Math.max(MIN_SCALE, s - 0.2))}
          className="rounded p-1.5 text-faint hover:bg-raised hover:text-ink"
          title="Zoom out"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <span className="w-11 text-center tabular-nums text-muted">
          {Math.round(scale * 100)}%
        </span>
        <button
          onClick={() => setScale((s) => Math.min(MAX_SCALE, s + 0.2))}
          className="rounded p-1.5 text-faint hover:bg-raised hover:text-ink"
          title="Zoom in"
        >
          <ZoomIn className="h-4 w-4" />
        </button>

        <span className="ml-1 tabular-nums text-faint">
          {sizes.length ? `${pageNow} / ${sizes.length}` : "…"}
        </span>

        {!readOnly && (
          <>
            <span className="mx-1 h-4 w-px bg-line" />
            <span className="hidden items-center gap-1 sm:flex">
              {HIGHLIGHT_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`h-5 w-5 rounded-full border-2 transition-transform ${
                    color === c ? "scale-110 border-ink" : "border-transparent"
                  }`}
                  style={{ background: SWATCH[c].chip }}
                  title={`Highlight in ${c}`}
                />
              ))}
            </span>
            <button
              onClick={() => setBoxMode((b) => !b)}
              className={`ml-1 inline-flex items-center gap-1.5 rounded px-2 py-1 ${
                boxMode
                  ? "bg-accent-soft text-accent"
                  : "text-muted hover:bg-raised hover:text-ink"
              }`}
              title="Draw a box over a diagram or a scanned page"
            >
              <SquareDashed className="h-3.5 w-3.5" />
              Box
            </button>
          </>
        )}

        <button
          onClick={() => setPanelOpen((p) => !p)}
          className={`ml-auto inline-flex items-center gap-1.5 rounded px-2 py-1 ${
            panelOpen
              ? "bg-accent-soft text-accent"
              : "text-muted hover:bg-raised hover:text-ink"
          }`}
        >
          <MessageSquareText className="h-3.5 w-3.5" />
          Notes
          <span className="tabular-nums text-faint">{items.length}</span>
        </button>

        <span className="w-16 text-right text-faint">
          {readOnly
            ? "Read only"
            : loadingNotes
              ? "Loading…"
              : saveState === "saving"
                ? "Saving…"
                : saveState === "error"
                  ? "Not saved"
                  : saveState === "dirty"
                    ? "Unsaved"
                    : "Saved"}
        </span>
      </div>

      {saveState === "error" && (
        <div className="flex items-center gap-2 border-b border-danger/40 bg-danger/5 px-3 py-1.5 text-xs text-danger">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">
            Your highlights could not be saved to the vault.
          </span>
          <button onClick={() => void save()} className="underline">
            Try again
          </button>
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          onMouseUp={readOnly ? undefined : measureSelection}
          className="relative min-h-0 flex-1 overflow-auto bg-canvas"
        >
          <div className="mx-auto flex w-fit flex-col items-center gap-4 p-4">
            {doc && lib
              ? sizes.map((size, i) => (
                  <PdfPage
                    key={i}
                    lib={lib}
                    doc={doc}
                    pageNumber={i + 1}
                    size={size}
                    scale={scale}
                    annotations={byPage.get(i + 1) ?? []}
                    activeId={activeId}
                    boxMode={boxMode && !readOnly}
                    onPick={setActiveId}
                    onBox={addBox}
                    register={(el) => {
                      if (el) pageEls.current.set(i + 1, el);
                      else pageEls.current.delete(i + 1);
                    }}
                  />
                ))
              : (
                  <div className="flex items-center gap-2 p-10 text-sm text-muted">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Opening {file.name}…
                  </div>
                )}
          </div>

          {pending && !readOnly && (
            <div
              className="absolute z-30 flex items-center gap-1 rounded-lg border border-line bg-surface p-1 shadow-lg"
              style={{ left: pending.left, top: pending.top }}
            >
              {HIGHLIGHT_COLORS.map((c) => (
                <button
                  key={c}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    // Also becomes the colour the toolbar is set to, so the
                    // next highlight repeats this one without a second click.
                    setColor(c);
                    commitPending(false, c);
                  }}
                  className="h-5 w-5 rounded-full border border-line"
                  style={{ background: SWATCH[c].chip }}
                  title={`Highlight in ${c}`}
                />
              ))}
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commitPending(true)}
                className="ml-0.5 inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted hover:bg-raised hover:text-ink"
              >
                <MessageSquareText className="h-3.5 w-3.5" />
                Note
              </button>
            </div>
          )}
        </div>

        {panelOpen && (
          <NotesPanel
            items={ordered}
            activeId={activeId}
            readOnly={readOnly}
            owner={owner}
            onJump={jumpTo}
            onNote={setNote}
            onColor={setColorOf}
            onDelete={removeAnnotation}
            onClose={() => setPanelOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

/**
 * One page: the rendered bitmap, an invisible text layer that makes the words
 * selectable, and the highlights drawn between them.
 *
 * Pages render when they come near the viewport and stay rendered afterwards —
 * a lecture deck can be 80 pages, and rendering them all up front would lock
 * the tab for several seconds.
 */
function PdfPage({
  lib,
  doc,
  pageNumber,
  size,
  scale,
  annotations,
  activeId,
  boxMode,
  onPick,
  onBox,
  register,
}: {
  lib: PdfLib;
  doc: PDFDocumentProxy;
  pageNumber: number;
  size: { width: number; height: number };
  scale: number;
  annotations: Annotation[];
  activeId: string | null;
  boxMode: boolean;
  onPick: (id: string | null) => void;
  onBox: (page: number, rect: Rect) => void;
  register: (el: HTMLElement | null) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [drag, setDrag] = useState<Rect | null>(null);
  // The box being dragged, kept outside React state as well: reading it back
  // out of a state updater would mean creating the annotation from inside one,
  // and React is free to run an updater more than once.
  const dragRef = useRef<Rect | null>(null);

  const width = size.width * scale;
  const height = size.height * scale;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || near) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      // Start a page early so scrolling rarely lands on a blank one.
      { root: null, rootMargin: "800px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [near]);

  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    let task: { cancel: () => void } | null = null;
    let layer: { cancel: () => void } | null = null;

    void (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled) return;

      const canvas = canvasRef.current;
      const textDiv = textRef.current;
      if (!canvas || !textDiv) return;

      // Render at device resolution and scale back down with CSS, so the text
      // is sharp on a retina screen instead of being upscaled.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const bitmap = page.getViewport({ scale: scale * dpr });
      canvas.width = Math.floor(bitmap.width);
      canvas.height = Math.floor(bitmap.height);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const render = page.render({ canvas, viewport: bitmap });
      task = render;
      try {
        await render.promise;
      } catch {
        return; // cancelled by a zoom change or by unmounting
      }
      if (cancelled) return;

      const viewport = page.getViewport({ scale });
      textDiv.replaceChildren();
      textDiv.style.width = `${viewport.width}px`;
      textDiv.style.height = `${viewport.height}px`;
      const text = new lib.TextLayer({
        textContentSource: await page.getTextContent(),
        container: textDiv,
        viewport,
      });
      layer = text;
      if (cancelled) return;
      await text.render();
    })();

    return () => {
      cancelled = true;
      task?.cancel();
      layer?.cancel();
    };
  }, [doc, lib, pageNumber, scale, near, width, height]);

  // Clicking a highlight selects it. This is hit-tested rather than done with
  // a click handler on the highlight itself, because the highlights sit under
  // the text layer — putting them on top would make the words unselectable.
  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!window.getSelection()?.isCollapsed) return;
    const box = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - box.left) / box.width;
    const y = (e.clientY - box.top) / box.height;
    const hit = annotations.find((a) =>
      a.rects.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h),
    );
    if (hit) onPick(hit.id);
  }

  function startBox(e: ReactPointerEvent<HTMLDivElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const originX = (e.clientX - box.left) / box.width;
    const originY = (e.clientY - box.top) / box.height;
    e.currentTarget.setPointerCapture(e.pointerId);

    const move = (ev: PointerEvent) => {
      const x = (ev.clientX - box.left) / box.width;
      const y = (ev.clientY - box.top) / box.height;
      const next = {
        x: Math.max(0, Math.min(originX, x)),
        y: Math.max(0, Math.min(originY, y)),
        w: Math.min(1, Math.abs(x - originX)),
        h: Math.min(1, Math.abs(y - originY)),
      };
      dragRef.current = next;
      setDrag(next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const drawn = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      // Ignore a stray click that never became a drag.
      if (drawn && drawn.w > 0.01 && drawn.h > 0.01) onBox(pageNumber, drawn);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div
      ref={(el) => {
        wrapRef.current = el;
        register(el);
      }}
      onClick={handleClick}
      data-page={pageNumber}
      className="relative shrink-0 bg-white shadow-sm ring-1 ring-line"
      style={
        {
          width,
          height,
          // pdf.js sizes the text spans from this.
          "--total-scale-factor": scale,
        } as CSSProperties
      }
    >
      <canvas ref={canvasRef} className="absolute inset-0" />

      <div className="pointer-events-none absolute inset-0 z-[1]">
        {annotations.map((a) =>
          a.rects.map((r, i) => (
            <span
              key={`${a.id}-${i}`}
              className={`absolute rounded-[2px] ${
                a.id === activeId ? "outline outline-2 outline-accent" : ""
              }`}
              style={{
                left: `${r.x * 100}%`,
                top: `${r.y * 100}%`,
                width: `${r.w * 100}%`,
                height: `${r.h * 100}%`,
                background: SWATCH[a.color].fill,
              }}
            />
          )),
        )}
        {drag && (
          <span
            className="absolute rounded-[2px] border border-accent"
            style={{
              left: `${drag.x * 100}%`,
              top: `${drag.y * 100}%`,
              width: `${drag.w * 100}%`,
              height: `${drag.h * 100}%`,
              background: "rgb(var(--accent-rgb) / 0.15)",
            }}
          />
        )}
      </div>

      <div ref={textRef} className="textLayer" />

      {boxMode && (
        <div
          onPointerDown={startBox}
          className="absolute inset-0 z-[3] cursor-crosshair"
        />
      )}

      {!near && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-faint">
          Page {pageNumber}
        </div>
      )}
    </div>
  );
}

/** The list of everything marked up, in the order it appears in the document. */
function NotesPanel({
  items,
  activeId,
  readOnly,
  owner,
  onJump,
  onNote,
  onColor,
  onDelete,
  onClose,
}: {
  items: Annotation[];
  activeId: string | null;
  readOnly: boolean;
  owner?: string;
  onJump: (a: Annotation) => void;
  onNote: (id: string, note: string) => void;
  onColor: (id: string, color: HighlightColor) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const activeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  return (
    <aside className="absolute inset-y-0 right-0 z-20 flex w-72 flex-col border-l border-line bg-surface md:static md:z-auto">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-xs text-muted">
        <MessageSquareText className="h-3.5 w-3.5" />
        <span className="flex-1">
          {readOnly ? `${owner}'s notes` : "My notes"}
        </span>
        <button
          onClick={onClose}
          className="rounded p-1 text-faint hover:bg-raised hover:text-ink"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {items.length === 0 ? (
          <p className="px-4 py-10 text-center text-xs leading-5 text-faint">
            {readOnly ? (
              `${owner} hasn't marked up this PDF.`
            ) : (
              <>
                Select some text to highlight it, or use{" "}
                <Highlighter className="inline h-3 w-3" /> Box for a diagram.
              </>
            )}
          </p>
        ) : (
          items.map((a) => (
            <div
              key={a.id}
              ref={a.id === activeId ? activeRef : undefined}
              onClick={() => onJump(a)}
              className={`cursor-pointer border-b border-line px-3 py-2.5 ${
                a.id === activeId ? "bg-accent-soft/60" : "hover:bg-raised/60"
              }`}
            >
              <div className="mb-1 flex items-center gap-1.5 text-[11px] text-faint">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: SWATCH[a.color].chip }}
                />
                <span>Page {a.page}</span>
                {!readOnly && (
                  <>
                    <span className="ml-auto flex items-center gap-1">
                      {HIGHLIGHT_COLORS.map((c) => (
                        <button
                          key={c}
                          onClick={(e) => {
                            e.stopPropagation();
                            onColor(a.id, c);
                          }}
                          className={`h-2.5 w-2.5 rounded-full ${
                            a.color === c ? "ring-1 ring-ink ring-offset-1" : ""
                          }`}
                          style={{ background: SWATCH[c].chip }}
                          title={c}
                        />
                      ))}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(a.id);
                      }}
                      className="rounded p-0.5 hover:bg-raised hover:text-danger"
                      title="Delete this highlight"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </>
                )}
              </div>

              {a.text && (
                <p className="mb-1.5 line-clamp-3 border-l-2 border-line pl-2 text-xs italic leading-5 text-muted">
                  {a.text}
                </p>
              )}

              {readOnly ? (
                a.note ? (
                  <p className="whitespace-pre-wrap text-[13px] leading-5">
                    {a.note}
                  </p>
                ) : null
              ) : (
                <textarea
                  value={a.note}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => onNote(a.id, e.target.value)}
                  placeholder="Write a note…"
                  rows={2}
                  className="field min-h-[32px] resize-y px-2 py-1 text-[13px] leading-5"
                />
              )}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
