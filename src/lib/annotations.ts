/**
 * Highlights and notes drawn on top of a PDF.
 *
 * They live beside the PDF in the vault, at `courses/<CODE>/.notes/<file>.json`,
 * so a course's annotations travel with the course when it is shared and are
 * versioned by the same git history as everything else. `.notes` is a folder
 * rather than a sibling file so the course listing — which only ever shows
 * blobs — hides it without needing a rule of its own.
 */

/**
 * A rectangle on a page, in page-relative units: 0 is the left/top edge, 1 the
 * right/bottom. Storing them normalised is what lets a highlight survive being
 * re-rendered at a different zoom, on a different screen, or after the viewer's
 * layout changes.
 */
export type Rect = { x: number; y: number; w: number; h: number };

export const HIGHLIGHT_COLORS = ["yellow", "green", "blue", "pink"] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

export type Annotation = {
  id: string;
  /** 1-based, matching what the page indicator shows. */
  page: number;
  /** One rect per line of selected text; a dragged box is a single rect. */
  rects: Rect[];
  color: HighlightColor;
  /** The words under the highlight, kept so the notes list is readable. */
  text?: string;
  /** What the reader wrote about it. May be empty — a bare highlight. */
  note: string;
  createdAt: string;
};

export type AnnotationFile = {
  version: 1;
  /** The PDF these belong to, for a human reading the JSON in GitHub. */
  file: string;
  items: Annotation[];
};

export function annotationsPath(code: string, name: string): string {
  return `courses/${code}/.notes/${name}.json`;
}

/** Ceiling on one PDF's annotations. Far more than anyone will hand-draw. */
export const MAX_ANNOTATIONS = 2000;

const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function cleanRect(raw: unknown): Rect | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isNum(r.x) || !isNum(r.y) || !isNum(r.w) || !isNum(r.h)) return null;
  if (r.w <= 0 || r.h <= 0) return null;
  return {
    x: clamp01(r.x),
    y: clamp01(r.y),
    w: clamp01(r.w),
    h: clamp01(r.h),
  };
}

/**
 * Parse whatever came back from the vault into annotations we are willing to
 * render. The file is hand-editable in GitHub, so nothing in it is trusted:
 * anything malformed is dropped rather than allowed to break the viewer.
 */
export function parseAnnotations(raw: unknown): Annotation[] {
  const items = (raw as AnnotationFile | null)?.items;
  if (!Array.isArray(items)) return [];
  const out: Annotation[] = [];
  for (const item of items.slice(0, MAX_ANNOTATIONS)) {
    if (!item || typeof item !== "object") continue;
    const a = item as Record<string, unknown>;
    if (typeof a.id !== "string" || !a.id) continue;
    if (!isNum(a.page) || a.page < 1) continue;
    const rects = Array.isArray(a.rects)
      ? a.rects.map(cleanRect).filter((r): r is Rect => r !== null)
      : [];
    if (rects.length === 0) continue;
    out.push({
      id: a.id,
      page: Math.floor(a.page),
      rects,
      color: HIGHLIGHT_COLORS.includes(a.color as HighlightColor)
        ? (a.color as HighlightColor)
        : "yellow",
      text: typeof a.text === "string" ? a.text.slice(0, 2000) : undefined,
      note: typeof a.note === "string" ? a.note.slice(0, 10_000) : "",
      createdAt:
        typeof a.createdAt === "string" ? a.createdAt : new Date(0).toISOString(),
    });
  }
  return out;
}

/** Page order first, then top to bottom — the order a reader met them in. */
export function inReadingOrder(items: Annotation[]): Annotation[] {
  return [...items].sort(
    (a, b) => a.page - b.page || topOf(a) - topOf(b) || a.id.localeCompare(b.id),
  );
}

function topOf(a: Annotation): number {
  return Math.min(...a.rects.map((r) => r.y));
}
