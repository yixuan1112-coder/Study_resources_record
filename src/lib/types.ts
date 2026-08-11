export type Course = {
  /** NTU course code, e.g. "CZ1003". Doubles as the folder name in the vault repo. */
  code: string;
  title: string;
  /** Academic year, e.g. "AY24/25" */
  ay?: string;
  /** "1" | "2" | "Special" */
  sem?: string;
  au?: string;
  notes?: string;
  createdAt: string;
};

export type CoursesFile = {
  version: 1;
  courses: Course[];
};

export type VaultFile = {
  name: string;
  path: string;
  sha: string;
  size: number;
  kind: FileKind;
};

export type FileKind = "pdf" | "markdown" | "image" | "other";

const IMAGE_EXT = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "avif",
]);

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i + 1).toLowerCase();
}

export function kindOf(name: string): FileKind {
  const ext = extOf(name);
  if (ext === "pdf") return "pdf";
  if (ext === "md" || ext === "markdown" || ext === "mdx") return "markdown";
  if (IMAGE_EXT.has(ext)) return "image";
  return "other";
}

export function mimeOf(name: string): string {
  const ext = extOf(name);
  switch (ext) {
    case "pdf":
      return "application/pdf";
    case "md":
    case "markdown":
    case "mdx":
      return "text/markdown; charset=utf-8";
    case "txt":
      return "text/plain; charset=utf-8";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "avif":
      return "image/avif";
    case "svg":
      return "image/svg+xml";
    case "bmp":
      return "image/bmp";
    default:
      return "application/octet-stream";
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Course codes are used as directory names, so keep them boring and safe. */
export function normalizeCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "");
}

/** Reject anything that could escape the course directory. */
export function isSafeFilename(name: string): boolean {
  if (!name || name.length > 200) return false;
  if (name.includes("/") || name.includes("\\")) return false;
  if (name === "." || name === "..") return false;
  if (name.startsWith(".")) return false;
  // No control characters.
  return ![...name].some((ch) => ch.charCodeAt(0) < 0x20);
}

const PALETTE = [
  "#e11d48",
  "#ea580c",
  "#ca8a04",
  "#16a34a",
  "#0891b2",
  "#2563eb",
  "#7c3aed",
  "#c026d3",
];

export function colorForCode(code: string): string {
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
