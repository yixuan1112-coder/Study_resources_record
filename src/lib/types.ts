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

/**
 * Any file type can be uploaded, so this only has to name the ones a browser
 * can do something useful with. Everything else falls through to a download.
 */
const MIME: Record<string, string> = {
  pdf: "application/pdf",
  md: "text/markdown; charset=utf-8",
  markdown: "text/markdown; charset=utf-8",
  mdx: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  json: "application/json; charset=utf-8",
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",

  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  heic: "image/heic",
  tif: "image/tiff",
  tiff: "image/tiff",

  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",

  zip: "application/zip",
  gz: "application/gzip",
  "7z": "application/x-7z-compressed",
  rar: "application/vnd.rar",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  epub: "application/epub+zip",
};

export function mimeOf(name: string): string {
  return MIME[extOf(name)] ?? "application/octet-stream";
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
