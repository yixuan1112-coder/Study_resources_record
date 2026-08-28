/**
 * Running a file from the editor.
 *
 * The app itself never executes anything: it forwards the buffer to a runner
 * — a Piston sandbox on our own machine — and shows what came back. The runner
 * is optional, so every part of this degrades to "running is switched off"
 * rather than to an error when RUNNER_URL is unset.
 */
import { extOf } from "./types";

/**
 * Vault extension -> the language name the runner knows it by.
 *
 * Only what the runner actually has installed is offered, which is checked
 * against its own list of runtimes rather than assumed from this table — a
 * sandbox with just Python and Java installed should not show a Run button on
 * a Rust file.
 */
const RUN_LANGS: Record<string, string> = {
  py: "python",
  pyw: "python",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  java: "java",
  c: "c",
  cpp: "c++",
  cc: "c++",
  cxx: "c++",
  cs: "csharp",
  go: "go",
  rs: "rust",
  rb: "ruby",
  php: "php",
  swift: "swift",
  kt: "kotlin",
  scala: "scala",
  dart: "dart",
  lua: "lua",
  jl: "julia",
  r: "rscript",
  pl: "perl",
  sh: "bash",
  bash: "bash",
  sql: "sqlite3",
};

/** The runner's name for this file's language, or null if it has none. */
export function runLanguageOf(name: string): string | null {
  return RUN_LANGS[extOf(name)] ?? null;
}

/** A program has to fit in a request body; anything this big is not a script. */
export const MAX_SOURCE_BYTES = 128_000;
export const MAX_STDIN_BYTES = 64_000;
/** Trimmed before display — a runaway loop can print megabytes. */
export const MAX_OUTPUT_CHARS = 100_000;

export type RunOutcome = {
  stdout: string;
  stderr: string;
  /** Exit status. Null when the process was killed by a signal instead. */
  exitCode: number | null;
  signal: string | null;
  /** Wall-clock milliseconds inside the sandbox, when the runner reports it. */
  wallTime?: number;
  /** Set when the program never got as far as running. */
  compileError?: string;
  /** The runtime that was used, e.g. "python 3.12.0". */
  runtime?: string;
  /** True when the sandbox stopped it at the time limit. */
  timedOut?: boolean;
  truncated?: boolean;
};

export function truncateOutput(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_OUTPUT_CHARS) return { text, truncated: false };
  return { text: text.slice(0, MAX_OUTPUT_CHARS), truncated: true };
}
