import { NextRequest, NextResponse } from "next/server";
import { getActor, unauthorized } from "@/lib/session";
import { isSafeFilename } from "@/lib/types";
import {
  MAX_SOURCE_BYTES,
  MAX_STDIN_BYTES,
  runLanguageOf,
  truncateOutput,
  type RunOutcome,
} from "@/lib/run";

/**
 * Runs a file from the editor in a sandbox.
 *
 * The sandbox is a Piston instance on our own machine — see runner/README.md.
 * It is reached only from here: RUNNER_URL and RUNNER_TOKEN never leave the
 * server, so the sandbox is not an open code-execution endpoint that anyone
 * who reads the page source can drive.
 */
const RUNNER_URL = process.env.RUNNER_URL;
const RUNNER_TOKEN = process.env.RUNNER_TOKEN;

/** Time limits handed to the sandbox, in milliseconds. */
const COMPILE_TIMEOUT = 10_000;
const RUN_TIMEOUT = 6_000;
/** Bytes. A student's exercise does not need more, and this box is shared. */
const RUN_MEMORY = 256 * 1024 * 1024;
/** Our own ceiling, above the sandbox's, so a hung runner cannot hold a slot. */
const REQUEST_TIMEOUT = 25_000;

function runnerFetch(path: string, init?: RequestInit) {
  return fetch(`${RUNNER_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(RUNNER_TOKEN ? { "X-Runner-Token": RUNNER_TOKEN } : {}),
    },
  });
}

type Runtime = { language: string; version: string; aliases?: string[] };

/**
 * What the sandbox has installed. Cached because it only changes when someone
 * installs a package on the runner, and the editor asks for it on every mount.
 */
let runtimeCache: { at: number; languages: Record<string, string> } | null = null;
const RUNTIME_TTL = 5 * 60 * 1000;

async function runtimes(): Promise<Record<string, string>> {
  if (runtimeCache && Date.now() - runtimeCache.at < RUNTIME_TTL) {
    return runtimeCache.languages;
  }
  const res = await runnerFetch("/api/v2/runtimes", {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Runner returned ${res.status}`);
  const list = (await res.json()) as Runtime[];

  // Aliases matter: the sandbox calls C++ "c++" but answers to "cpp" too, and
  // which name is canonical differs between packages.
  const languages: Record<string, string> = {};
  for (const rt of list) {
    for (const key of [rt.language, ...(rt.aliases ?? [])]) {
      languages[key] = rt.version;
    }
  }
  runtimeCache = { at: Date.now(), languages };
  return languages;
}

/** Which languages the editor may offer a Run button for. */
export async function GET() {
  const actor = await getActor();
  if (!actor) return unauthorized();
  if (!RUNNER_URL) return NextResponse.json({ available: false, languages: [] });

  try {
    return NextResponse.json({
      available: true,
      languages: Object.keys(await runtimes()),
    });
  } catch {
    // A runner that is down should grey the button out, not break the editor.
    return NextResponse.json({ available: false, languages: [] });
  }
}

export async function POST(req: NextRequest) {
  const actor = await getActor();
  if (!actor) return unauthorized();

  if (!RUNNER_URL) {
    return NextResponse.json(
      { error: "No runner is configured for this site" },
      { status: 503 },
    );
  }

  const body = (await req.json().catch(() => null)) as {
    name?: string;
    source?: string;
    stdin?: string;
  } | null;

  const name = body?.name ?? "";
  const source = body?.source ?? "";
  const stdin = body?.stdin ?? "";

  if (!isSafeFilename(name) || typeof source !== "string") {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES) {
    return NextResponse.json(
      { error: "That file is too big to run" },
      { status: 413 },
    );
  }
  if (Buffer.byteLength(stdin, "utf8") > MAX_STDIN_BYTES) {
    return NextResponse.json({ error: "That input is too long" }, { status: 413 });
  }

  const language = runLanguageOf(name);
  if (!language) {
    return NextResponse.json(
      { error: "The runner has no language for that file type" },
      { status: 400 },
    );
  }

  let version: string;
  try {
    const installed = await runtimes();
    if (!installed[language]) {
      return NextResponse.json(
        { error: `The runner does not have ${language} installed` },
        { status: 400 },
      );
    }
    version = installed[language];
  } catch {
    return NextResponse.json(
      { error: "The runner is not answering" },
      { status: 502 },
    );
  }

  try {
    const res = await runnerFetch("/api/v2/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      body: JSON.stringify({
        language,
        version,
        // The real filename travels with the code: Java insists the file be
        // named after its public class, and compiler messages quote it.
        files: [{ name, content: source }],
        stdin,
        compile_timeout: COMPILE_TIMEOUT,
        run_timeout: RUN_TIMEOUT,
        run_memory_limit: RUN_MEMORY,
      }),
    });

    if (!res.ok) {
      const detail = (await res.json().catch(() => null)) as { message?: string } | null;
      return NextResponse.json(
        { error: detail?.message ?? `The runner returned ${res.status}` },
        { status: 502 },
      );
    }

    const out = (await res.json()) as {
      language: string;
      version: string;
      compile?: { stdout: string; stderr: string; code: number };
      run: {
        stdout: string;
        stderr: string;
        code: number | null;
        signal: string | null;
        wall_time?: number;
      };
    };

    // A failed compile means the program never ran. Piston copies the compiler
    // output into the run stage as well, so reporting both would print the
    // same errors twice.
    const compileFailed = !!out.compile && out.compile.code !== 0;
    const stdout = truncateOutput(compileFailed ? "" : (out.run.stdout ?? ""));
    const stderr = truncateOutput(compileFailed ? "" : (out.run.stderr ?? ""));

    // The compile script chmods a binary that a failed compile never produced,
    // and its complaint lands after the real errors where it reads like a
    // permissions problem rather than the typo it is.
    const compileText = (out.compile?.stderr || out.compile?.stdout || "")
      .split("\n")
      .filter((line) => !line.startsWith("chmod: cannot access"))
      .join("\n")
      .trimEnd();

    const outcome: RunOutcome = {
      stdout: stdout.text,
      stderr: stderr.text,
      exitCode: out.run.code,
      signal: out.run.signal,
      wallTime: out.run.wall_time,
      runtime: `${out.language} ${out.version}`,
      truncated: stdout.truncated || stderr.truncated,
      ...(compileFailed
        ? {
            compileError: truncateOutput(compileText || "Compilation failed").text,
          }
        : {}),
      // Piston kills a program at the time limit with SIGKILL and no message
      // of its own, which on its own looks like an unexplained crash.
      ...(out.run.signal === "SIGKILL" && !out.run.stderr ? { timedOut: true } : {}),
    };

    return NextResponse.json(outcome);
  } catch (e) {
    const timedOut = e instanceof Error && e.name === "TimeoutError";
    return NextResponse.json(
      { error: timedOut ? "The runner took too long" : "Could not reach the runner" },
      { status: 504 },
    );
  }
}
