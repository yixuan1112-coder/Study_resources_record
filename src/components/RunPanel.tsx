"use client";

import { Loader2, X } from "lucide-react";
import type { RunOutcome } from "@/lib/run";

/**
 * What came back from the runner, under the editor: the program's own input on
 * the left, everything it printed on the right.
 */
export function RunPanel({
  running,
  outcome,
  error,
  stdin,
  onStdin,
  onClose,
}: {
  running: boolean;
  outcome: RunOutcome | null;
  error: string | null;
  stdin: string;
  onStdin: (text: string) => void;
  onClose: () => void;
}) {
  const failed =
    !!outcome && (!!outcome.compileError || (outcome.exitCode ?? 0) !== 0);

  return (
    <div className="flex h-52 shrink-0 border-t border-line">
      <div className="flex w-56 shrink-0 flex-col border-r border-line">
        <div className="px-2.5 py-1.5 text-[11px] text-faint">Input (stdin)</div>
        <textarea
          value={stdin}
          onChange={(e) => onStdin(e.target.value)}
          spellCheck={false}
          placeholder="Anything the program reads from input…"
          className="min-h-0 flex-1 resize-none bg-transparent px-2.5 pb-2 font-mono
                     text-xs leading-5 text-ink outline-none placeholder:text-faint"
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-faint">
          <span className="text-muted">Output</span>
          {running && <Loader2 className="h-3 w-3 animate-spin" />}
          {outcome && (
            <>
              {outcome.runtime && <span>{outcome.runtime}</span>}
              <span className={failed ? "text-danger" : "text-muted"}>
                {outcome.compileError
                  ? "did not compile"
                  : outcome.signal
                    ? `killed (${outcome.signal})`
                    : `exit ${outcome.exitCode}`}
              </span>
              {outcome.wallTime !== undefined && <span>{outcome.wallTime} ms</span>}
            </>
          )}
          <button
            onClick={onClose}
            className="ml-auto rounded p-0.5 text-faint hover:bg-raised hover:text-ink"
            title="Hide the output"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-2.5 pb-2">
          {error ? (
            <p className="font-mono text-xs leading-5 text-danger">{error}</p>
          ) : running && !outcome ? (
            <p className="font-mono text-xs leading-5 text-faint">Running…</p>
          ) : outcome ? (
            <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5">
              {outcome.compileError && (
                <span className="text-danger">{outcome.compileError}</span>
              )}
              {outcome.stdout}
              {outcome.stderr && (
                <span className="text-danger">{outcome.stderr}</span>
              )}
              {outcome.timedOut && (
                <span className="text-danger">
                  Stopped at the time limit — an infinite loop, or waiting on input
                  that was never given.
                </span>
              )}
              {!outcome.compileError &&
                !outcome.stdout &&
                !outcome.stderr &&
                !outcome.timedOut && (
                  <span className="text-faint">
                    It ran and printed nothing.
                  </span>
                )}
              {outcome.truncated && (
                <span className="text-faint">{"\n"}— output cut off here —</span>
              )}
            </pre>
          ) : (
            <p className="font-mono text-xs leading-5 text-faint">
              Nothing has been run yet.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
