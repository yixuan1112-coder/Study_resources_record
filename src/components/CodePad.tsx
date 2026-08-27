"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { Loader2 } from "lucide-react";
import { editorOptions, prepareMonaco, themeOf, usePrefersDark } from "@/lib/monaco";
import { languageOf } from "@/lib/types";

/**
 * A small Monaco surface for composing a file that does not exist yet — the
 * same editor the vault opens saved files in, so code is written and pasted
 * with highlighting, auto-indentation and completions from the first
 * keystroke rather than only after the file is created.
 *
 * It behaves like the textarea it replaced: it grows with its content, shows a
 * placeholder while empty, and leaves Escape and Ctrl/Cmd+Enter to the form
 * around it.
 */
export function CodePad({
  value,
  filename,
  onChange,
  onPasteAll,
  onEscape,
  onSubmit,
  placeholder,
  minLines = 9,
  maxLines = 24,
}: {
  value: string;
  /** Drives the language and the indent width; may be empty while unnamed. */
  filename: string;
  onChange: (text: string) => void;
  /** A paste that filled the whole (previously empty) editor, with its text. */
  onPasteAll?: (text: string) => void;
  onEscape?: () => void;
  onSubmit?: () => void;
  placeholder?: string;
  minLines?: number;
  maxLines?: number;
}) {
  const dark = usePrefersDark();
  // Line numbers push the text right by a variable amount; the placeholder has
  // to sit exactly where the first character will land.
  const [contentLeft, setContentLeft] = useState(62);

  // An unnamed file has no extension, so this is plaintext until it is named.
  const language = languageOf(filename);
  const options = useMemo(
    () =>
      editorOptions(filename, {
        lineNumbersMinChars: 3,
        folding: false,
        renderLineHighlight: "none",
      }),
    [filename],
  );

  const lines = value ? value.split("\n").length : 1;
  const height =
    Math.min(Math.max(lines + 1, minLines), maxLines) * 20 + 24;

  // Monaco binds its keyboard commands once, at mount, so they have to reach
  // the current callbacks through refs rather than captured copies.
  const handlers = useRef({ onEscape, onSubmit, onPasteAll });
  useEffect(() => {
    handlers.current = { onEscape, onSubmit, onPasteAll };
  }, [onEscape, onSubmit, onPasteAll]);

  const handleMount: OnMount = useCallback((editor, monaco) => {
    setContentLeft(editor.getLayoutInfo().contentLeft);
    editor.onDidLayoutChange((info) => setContentLeft(info.contentLeft));

    // Escape only reaches the form when no editor widget is up — otherwise it
    // is the suggestion list or the find box that should close.
    editor.addCommand(
      monaco.KeyCode.Escape,
      () => handlers.current.onEscape?.(),
      "editorTextFocus && !suggestWidgetVisible && !parameterHintsVisible && " +
        "!findWidgetVisible && !inSnippetMode && !renameInputVisible",
    );
    // Enter is a newline in a code box, so submitting needs the modifier.
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () =>
      handlers.current.onSubmit?.(),
    );

    editor.onDidPaste((e) => {
      const model = editor.getModel();
      if (!model) return;
      const pasted = model.getValueInRange(e.range);
      // The pasted range covering the whole document is how we know it landed
      // in an empty editor — the only case the caller wants to hear about.
      if (pasted === model.getValue()) handlers.current.onPasteAll?.(pasted);
    });
  }, []);

  return (
    <div
      className="relative overflow-hidden rounded-lg border border-line bg-surface
                 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20"
      style={{ height }}
    >
      <Editor
        // A path of its own keeps this model separate from any file with the
        // same name already open in the editor below.
        path="inmemory://compose/new-file"
        language={language}
        value={value}
        theme={themeOf(dark)}
        beforeMount={prepareMonaco}
        onMount={handleMount}
        onChange={(next) => onChange(next ?? "")}
        options={options}
        loading={
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Starting the editor…
          </div>
        }
      />
      {value === "" && placeholder && (
        <p
          className="pointer-events-none absolute top-3 text-[13px] leading-5 text-faint"
          style={{ left: contentLeft }}
        >
          {placeholder}
        </p>
      )}
    </div>
  );
}
