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

export type FileKind = "pdf" | "markdown" | "image" | "code" | "other";

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

/**
 * Extensions the built-in editor can open, with the label shown in its status
 * bar and the Monaco language id used for highlighting. `plaintext` means the
 * file is perfectly editable, we just have no grammar for it.
 *
 * Anything absent from this table is still uploadable and downloadable — it is
 * only excluded from being opened and written as text.
 */
export const CODE_LANGS: Record<string, { label: string; monaco: string }> = {
  py: { label: "Python", monaco: "python" },
  pyw: { label: "Python", monaco: "python" },
  js: { label: "JavaScript", monaco: "javascript" },
  mjs: { label: "JavaScript", monaco: "javascript" },
  cjs: { label: "JavaScript", monaco: "javascript" },
  jsx: { label: "JavaScript (JSX)", monaco: "javascript" },
  ts: { label: "TypeScript", monaco: "typescript" },
  tsx: { label: "TypeScript (TSX)", monaco: "typescript" },
  java: { label: "Java", monaco: "java" },
  c: { label: "C", monaco: "c" },
  h: { label: "C header", monaco: "c" },
  cpp: { label: "C++", monaco: "cpp" },
  cc: { label: "C++", monaco: "cpp" },
  cxx: { label: "C++", monaco: "cpp" },
  hpp: { label: "C++ header", monaco: "cpp" },
  hh: { label: "C++ header", monaco: "cpp" },
  cs: { label: "C#", monaco: "csharp" },
  go: { label: "Go", monaco: "go" },
  rs: { label: "Rust", monaco: "rust" },
  rb: { label: "Ruby", monaco: "ruby" },
  php: { label: "PHP", monaco: "php" },
  swift: { label: "Swift", monaco: "swift" },
  kt: { label: "Kotlin", monaco: "kotlin" },
  kts: { label: "Kotlin", monaco: "kotlin" },
  scala: { label: "Scala", monaco: "scala" },
  dart: { label: "Dart", monaco: "dart" },
  lua: { label: "Lua", monaco: "lua" },
  jl: { label: "Julia", monaco: "julia" },
  r: { label: "R", monaco: "r" },
  pl: { label: "Perl", monaco: "perl" },
  pm: { label: "Perl", monaco: "perl" },
  sh: { label: "Shell", monaco: "shell" },
  bash: { label: "Shell", monaco: "shell" },
  zsh: { label: "Shell", monaco: "shell" },
  ps1: { label: "PowerShell", monaco: "powershell" },
  bat: { label: "Batch", monaco: "bat" },
  cmd: { label: "Batch", monaco: "bat" },
  sql: { label: "SQL", monaco: "sql" },
  sol: { label: "Solidity", monaco: "solidity" },
  proto: { label: "Protocol Buffers", monaco: "protobuf" },
  graphql: { label: "GraphQL", monaco: "graphql" },
  gql: { label: "GraphQL", monaco: "graphql" },
  v: { label: "Verilog", monaco: "systemverilog" },
  sv: { label: "SystemVerilog", monaco: "systemverilog" },
  html: { label: "HTML", monaco: "html" },
  htm: { label: "HTML", monaco: "html" },
  vue: { label: "Vue", monaco: "html" },
  svelte: { label: "Svelte", monaco: "html" },
  css: { label: "CSS", monaco: "css" },
  scss: { label: "SCSS", monaco: "scss" },
  less: { label: "Less", monaco: "less" },
  json: { label: "JSON", monaco: "json" },
  jsonc: { label: "JSON", monaco: "json" },
  yaml: { label: "YAML", monaco: "yaml" },
  yml: { label: "YAML", monaco: "yaml" },
  xml: { label: "XML", monaco: "xml" },
  toml: { label: "TOML", monaco: "ini" },
  ini: { label: "INI", monaco: "ini" },
  cfg: { label: "Config", monaco: "ini" },
  conf: { label: "Config", monaco: "ini" },
  // No Monaco grammar ships for these, but they are text a student writes by
  // hand, so the editor should still open them.
  m: { label: "MATLAB", monaco: "plaintext" },
  tex: { label: "LaTeX", monaco: "plaintext" },
  vhd: { label: "VHDL", monaco: "plaintext" },
  vhdl: { label: "VHDL", monaco: "plaintext" },
  hs: { label: "Haskell", monaco: "plaintext" },
  asm: { label: "Assembly", monaco: "plaintext" },
  txt: { label: "Plain text", monaco: "plaintext" },
};

/** Can this file be opened in the editor and saved back as text? */
export function isCodeFile(name: string): boolean {
  return extOf(name) in CODE_LANGS;
}

/** Monaco language id for a filename. Markdown is editable too. */
export function languageOf(name: string): string {
  if (kindOf(name) === "markdown") return "markdown";
  return CODE_LANGS[extOf(name)]?.monaco ?? "plaintext";
}

/**
 * Ceiling on a file edited in the browser. The text travels as base64 inside a
 * JSON body, so it has to clear Vercel's 4.5 MB request cap with room to spare;
 * a source file anywhere near this is not something anyone is hand-editing.
 */
export const MAX_CODE_BYTES = 1_000_000;

export function languageLabelOf(name: string): string {
  if (kindOf(name) === "markdown") return "Markdown";
  return CODE_LANGS[extOf(name)]?.label ?? "Plain text";
}

/**
 * Shebang interpreter -> extension. Only the interpreters a student is
 * plausibly pasting; anything else falls through to the rules below.
 */
const SHEBANG_EXT: Record<string, string> = {
  python: "py",
  python2: "py",
  python3: "py",
  node: "js",
  deno: "ts",
  bash: "sh",
  sh: "sh",
  zsh: "zsh",
  ruby: "rb",
  perl: "pl",
  php: "php",
  Rscript: "r",
};

/**
 * Ordered most specific first. Order carries most of the weight here: a Java
 * file also has braces, and a TypeScript file also has `import`, so a loose
 * rule placed too early would swallow everything below it.
 */
const GUESSES: [string, RegExp][] = [
  ["php", /^\s*<\?php/],
  ["xml", /^\s*<\?xml/],
  ["html", /^\s*<!doctype html|^\s*<html[\s>]/i],
  ["java", /\bclass\s+\w+[\s\S]*\bpublic\s+static\s+void\s+main\b|System\.out\.print|^\s*import\s+java\./m],
  ["cpp", /#include\s*<(iostream|vector|string|map|set|algorithm)>|\bstd::|\busing\s+namespace\s+std\b/],
  ["c", /#include\s*<\w+\.h>|\bprintf\s*\(/],
  ["cs", /\busing\s+System\b|\bConsole\.WriteLine\b/],
  ["go", /^\s*package\s+\w+\s*$[\s\S]*^\s*func\s/m],
  ["rs", /\bfn\s+main\s*\(\s*\)|\blet\s+mut\b|\bprintln!\s*\(/],
  // `import x` must end the line, so that `import React from "react"` is not
  // mistaken for Python.
  ["py", /^\s*def\s+\w+\s*\(|^\s*from\s+[\w.]+\s+import\b|^\s*import\s+[\w.]+(\s+as\s+\w+)?\s*$|^\s*elif\b|__name__\s*==/m],
  ["sql", /\bcreate\s+table\b|\binsert\s+into\b|\bselect\b[\s\S]{0,400}\bfrom\b/i],
  ["ts", /:\s*(string|number|boolean)\b|\binterface\s+\w+\s*\{|^\s*type\s+\w+\s*=/m],
  ["js", /\b(const|let|function)\s+\w|=>|\bconsole\.log\b/],
  ["r", /<-\s*(function|c\()|\blibrary\s*\(/],
  ["css", /^[.#]?[\w-]+[^{};]*\{[^{}]*:[^{}]*;/m],
];

/** Best guess at an extension for a pasted snippet, or "" if nothing fits. */
function guessExtension(text: string): string {
  // The head is plenty — the imports and the first declaration are where the
  // language shows itself, and scanning a whole megabyte would not help.
  const head = text.slice(0, 4000);
  const trimmed = head.trim();
  if (!trimmed) return "";

  // A shebang is the author saying it outright, so it wins.
  const shebang = /^#!\s*(?:\S*\/env\s+)?(\S+)/.exec(trimmed);
  if (shebang) {
    const ext = SHEBANG_EXT[shebang[1].split("/").pop() ?? ""];
    if (ext) return ext;
  }

  // JSON matches none of the rules below, and parsing settles it exactly.
  if (/^[[{]/.test(trimmed)) {
    try {
      JSON.parse(text);
      return "json";
    } catch {
      /* not JSON after all */
    }
  }

  for (const [ext, pattern] of GUESSES) {
    if (pattern.test(head)) return ext;
  }
  return "";
}

/**
 * A filename to prefill when code is pasted and the name box is still empty.
 * Java is the one language where the name is not a free choice, so the class
 * name is used when there is one. Returns "" when the language is unclear —
 * a wrong guess is worse than no guess, since the student has to notice it.
 */
export function suggestFilename(text: string): string {
  const ext = guessExtension(text);
  if (!ext) return "";
  if (ext === "java") {
    const cls = /\bclass\s+([A-Za-z_$][\w$]*)/.exec(text);
    if (cls) return `${cls[1]}.java`;
  }
  return `untitled.${ext}`;
}

export function kindOf(name: string): FileKind {
  const ext = extOf(name);
  if (ext === "pdf") return "pdf";
  if (ext === "md" || ext === "markdown" || ext === "mdx") return "markdown";
  if (IMAGE_EXT.has(ext)) return "image";
  if (ext in CODE_LANGS) return "code";
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
  const ext = extOf(name);
  const known = MIME[ext];
  if (known) return known;
  // Source files the editor understands are text, even the ones without an
  // entry above — serving them as octet-stream would force a download.
  if (ext in CODE_LANGS) return "text/plain; charset=utf-8";
  return "application/octet-stream";
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

/**
 * Turn a note title into a filename stem. Non-ASCII is kept — course notes are
 * often written in Chinese — so this strips only what a path cannot hold.
 */
export function slugifyTitle(raw: string): string {
  const stem = raw
    .normalize("NFC")
    // Characters that are illegal or awkward in a path, plus control codes.
    .replace(/[/\\:*?"<>|]/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80)
    .replace(/^[.\-]+/, "")
    .replace(/[.\-]+$/, "")
    .toLowerCase();
  return stem || "note";
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
