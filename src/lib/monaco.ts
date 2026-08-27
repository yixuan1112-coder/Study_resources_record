"use client";

import { useSyncExternalStore } from "react";
import { loader } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import { extOf } from "./types";

/**
 * Monaco is served from our own origin rather than a CDN — see
 * scripts/sync-monaco.mjs. This has to run before the first editor mounts,
 * which is why it sits at module scope.
 */
loader.config({ paths: { vs: "/monaco/vs" } });

/** Languages whose communities settled on two spaces rather than four. */
const TWO_SPACE = new Set([
  "js", "mjs", "cjs", "jsx", "ts", "tsx", "json", "jsonc", "html", "htm",
  "css", "scss", "less", "yaml", "yml", "vue", "svelte", "rb", "scala",
]);

/** Indent width a file starts at, before Monaco reads the real one off it. */
export function tabSizeOf(name: string): number {
  return TWO_SPACE.has(extOf(name)) ? 2 : 4;
}

/**
 * The editor settings shared by every Monaco surface in the app, tuned to
 * match VS Code's defaults: suggestions as you type, brackets and quotes that
 * close themselves, and indentation driven by the language rather than by the
 * previous line alone.
 *
 * `detectIndentation` is what makes pasted code keep its own indent width —
 * `tabSize` is only the fallback for a file that has no indentation yet.
 */
export function editorOptions(
  name: string,
  extra?: Monaco.editor.IStandaloneEditorConstructionOptions,
): Monaco.editor.IStandaloneEditorConstructionOptions {
  return {
    fontSize: 13,
    lineHeight: 20,
    fontFamily:
      "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontLigatures: false,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    automaticLayout: true,
    tabSize: tabSizeOf(name),
    insertSpaces: true,
    detectIndentation: true,
    autoIndent: "full",
    // Left off deliberately, as VS Code does: the indentation rules below
    // handle re-indenting, without a formatter rewriting lines as you type.
    formatOnType: false,
    autoClosingBrackets: "languageDefined",
    autoClosingQuotes: "languageDefined",
    autoSurround: "languageDefined",
    bracketPairColorization: { enabled: true },
    guides: { indentation: true, highlightActiveIndentation: true },
    // Word-based suggestions are what carry the languages with no language
    // service of their own — every identifier already in the file is offered.
    wordBasedSuggestions: "allDocuments",
    quickSuggestions: { other: true, comments: false, strings: false },
    quickSuggestionsDelay: 10,
    suggestOnTriggerCharacters: true,
    acceptSuggestionOnEnter: "on",
    snippetSuggestions: "inline",
    parameterHints: { enabled: true },
    suggestSelection: "first",
    suggest: {
      showWords: true,
      showSnippets: true,
      insertMode: "replace",
    },
    // Tab keeps indenting rather than accepting a suggestion — the same
    // default VS Code ships, and the reason Tab is predictable in a code box.
    tabCompletion: "off",
    renderWhitespace: "selection",
    smoothScrolling: true,
    padding: { top: 12, bottom: 12 },
    scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
    overviewRulerLanes: 0,
    stickyScroll: { enabled: false },
    ...extra,
  };
}

/**
 * Everything that has to be told to Monaco itself rather than to one editor:
 * the two themes, the indentation rules, and the completions for languages
 * that ship no language service. Safe to call before every mount — the work
 * only happens the first time.
 */
export function prepareMonaco(monaco: typeof Monaco) {
  defineThemes(monaco);
  defineIndentation(monaco);
  defineCompletions(monaco);
}

/** Monaco needs literal colours, so these mirror globals.css by hand. */
function defineThemes(monaco: typeof Monaco) {
  monaco.editor.defineTheme("vault-light", {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#ffffff",
      "editorGutter.background": "#ffffff",
      "editorLineNumber.foreground": "#8b8b96",
      "editorLineNumber.activeForeground": "#16161a",
      "editor.lineHighlightBackground": "#f7f7f8",
      "editorIndentGuide.background1": "#e3e3e7",
    },
  });
  monaco.editor.defineTheme("vault-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#151519",
      "editorGutter.background": "#151519",
      "editorLineNumber.foreground": "#71717f",
      "editorLineNumber.activeForeground": "#ececf1",
      "editor.lineHighlightBackground": "#1d1d23",
      "editorIndentGuide.background1": "#2b2b33",
      "editorWidget.background": "#1d1d23",
      "editorSuggestWidget.background": "#1d1d23",
    },
  });
}

/**
 * Monaco's bundled grammars carry brackets and comments but almost no
 * indentation rules, so out of the box only a line ending in `{` indents the
 * next one. These are VS Code's own patterns, registered as a second
 * configuration — Monaco merges it over the grammar's, leaving everything
 * else the grammar defines alone.
 */
const C_LIKE = [
  "java", "c", "cpp", "csharp", "go", "rust", "kotlin", "scala", "php",
  "swift", "dart", "javascript", "typescript",
];

const C_LIKE_RULES: Monaco.languages.IndentationRule = {
  increaseIndentPattern: /^((?!\/\/).)*(\{[^}"'`]*|\([^)"'`]*|\[[^\]"'`]*)$/,
  decreaseIndentPattern: /^((?!.*?\/\*).*\*\/)?\s*[}\])].*$/,
  // `if (x)` on its own line indents what follows, and only that one line —
  // this is the rule that makes brace-less bodies behave.
  indentNextLinePattern: /^\s*(if|else|for|while)\b(?!.*[;{}]\s*(\/\/.*)?$)/,
};

const PYTHON_RULES: Monaco.languages.IndentationRule = {
  increaseIndentPattern:
    /^\s*(?:(?:async\s+)?def|class|if|elif|else|for|while|with|try|except|finally|match|case)\b.*:\s*(?:#.*)?$/,
  decreaseIndentPattern: /^\s*(?:elif|else|except|finally|case)\b.*:\s*(?:#.*)?$/,
};

let indentationDone = false;

function defineIndentation(monaco: typeof Monaco) {
  if (indentationDone) return;
  indentationDone = true;
  for (const id of C_LIKE) {
    monaco.languages.setLanguageConfiguration(id, {
      indentationRules: C_LIKE_RULES,
    });
  }
  monaco.languages.setLanguageConfiguration("python", {
    indentationRules: PYTHON_RULES,
  });
}

/**
 * Only JavaScript, TypeScript, HTML, CSS and JSON come with a real language
 * service. The languages a student here is most likely to be pasting do not,
 * so they get the next best thing: their keywords and standard library, plus
 * the handful of snippets that are tedious to type out.
 *
 * `${1:name}` placeholders are snippet syntax — Tab walks between them.
 */
const KEYWORDS: Record<string, string[]> = {
  python: [
    "and", "as", "assert", "async", "await", "break", "class", "continue",
    "def", "del", "elif", "else", "except", "False", "finally", "for", "from",
    "global", "if", "import", "in", "is", "lambda", "match", "None",
    "nonlocal", "not", "or", "pass", "raise", "return", "True", "try", "while",
    "with", "yield", "abs", "all", "any", "bool", "dict", "dir", "enumerate",
    "filter", "float", "format", "input", "int", "isinstance", "len", "list",
    "map", "max", "min", "open", "print", "range", "reversed", "round", "set",
    "sorted", "str", "sum", "tuple", "type", "zip", "self", "__init__",
    "__name__", "__main__",
  ],
  java: [
    "abstract", "boolean", "break", "byte", "case", "catch", "char", "class",
    "continue", "default", "do", "double", "else", "enum", "extends", "final",
    "finally", "float", "for", "if", "implements", "import", "instanceof",
    "int", "interface", "long", "new", "null", "package", "private",
    "protected", "public", "return", "short", "static", "super", "switch",
    "this", "throw", "throws", "try", "void", "while", "String", "System",
    "ArrayList", "HashMap", "HashSet", "List", "Map", "Math", "Scanner",
    "Integer", "Double", "Boolean", "Object", "Exception", "Override",
  ],
  c: [
    "auto", "break", "case", "char", "const", "continue", "default", "do",
    "double", "else", "enum", "extern", "float", "for", "goto", "if", "int",
    "long", "return", "short", "signed", "sizeof", "static", "struct",
    "switch", "typedef", "union", "unsigned", "void", "while", "printf",
    "scanf", "malloc", "calloc", "realloc", "free", "strlen", "strcpy",
    "strcmp", "memset", "memcpy", "fopen", "fclose", "fgets", "NULL",
  ],
  cpp: [
    "auto", "bool", "break", "case", "catch", "char", "class", "const",
    "constexpr", "continue", "default", "delete", "do", "double", "else",
    "enum", "explicit", "false", "float", "for", "friend", "if", "inline",
    "int", "long", "namespace", "new", "nullptr", "operator", "private",
    "protected", "public", "return", "short", "sizeof", "static", "struct",
    "switch", "template", "this", "throw", "true", "try", "typedef", "using",
    "virtual", "void", "while", "std", "cin", "cout", "endl", "string",
    "vector", "map", "set", "pair", "queue", "stack", "sort", "push_back",
    "size", "begin", "end",
  ],
};

type Snippet = { label: string; body: string; detail: string };

const SNIPPETS: Record<string, Snippet[]> = {
  python: [
    { label: "def", body: "def ${1:name}(${2:args}):\n\t${0:pass}", detail: "function" },
    { label: "class", body: "class ${1:Name}:\n\tdef __init__(self${2:}):\n\t\t${0:pass}", detail: "class" },
    { label: "for", body: "for ${1:item} in ${2:iterable}:\n\t${0:pass}", detail: "loop" },
    { label: "forr", body: "for ${1:i} in range(${2:n}):\n\t${0:pass}", detail: "range loop" },
    { label: "while", body: "while ${1:condition}:\n\t${0:pass}", detail: "loop" },
    { label: "if", body: "if ${1:condition}:\n\t${0:pass}", detail: "branch" },
    { label: "try", body: "try:\n\t${1:pass}\nexcept ${2:Exception} as e:\n\t${0:print(e)}", detail: "try/except" },
    { label: "with", body: 'with open(${1:"file.txt"}) as ${2:f}:\n\t${0:pass}', detail: "context manager" },
    { label: "main", body: 'if __name__ == "__main__":\n\t${0:main()}', detail: "entry point" },
  ],
  java: [
    { label: "main", body: "public static void main(String[] args) {\n\t${0}\n}", detail: "entry point" },
    { label: "class", body: "public class ${1:Name} {\n\t${0}\n}", detail: "class" },
    { label: "sout", body: "System.out.println(${0});", detail: "print" },
    { label: "fori", body: "for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t${0}\n}", detail: "counted loop" },
    { label: "foreach", body: "for (${1:String} ${2:item} : ${3:items}) {\n\t${0}\n}", detail: "for-each" },
    { label: "try", body: "try {\n\t${1}\n} catch (${2:Exception} e) {\n\t${0:e.printStackTrace();}\n}", detail: "try/catch" },
    { label: "scanner", body: "Scanner ${1:sc} = new Scanner(System.in);\n${0}", detail: "read input" },
  ],
  c: [
    { label: "main", body: "int main(void) {\n\t${0}\n\treturn 0;\n}", detail: "entry point" },
    { label: "include", body: "#include <${1:stdio.h}>\n${0}", detail: "header" },
    { label: "fori", body: "for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t${0}\n}", detail: "counted loop" },
    { label: "printf", body: 'printf("${1:%d\\\\n}", ${0});', detail: "print" },
  ],
  cpp: [
    { label: "main", body: "int main() {\n\t${0}\n\treturn 0;\n}", detail: "entry point" },
    { label: "include", body: "#include <${1:iostream}>\n${0}", detail: "header" },
    { label: "fori", body: "for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t${0}\n}", detail: "counted loop" },
    { label: "cout", body: "std::cout << ${1} << std::endl;\n${0}", detail: "print" },
    { label: "vector", body: "std::vector<${1:int}> ${2:v};\n${0}", detail: "vector" },
  ],
};

let completionsDone = false;

function defineCompletions(monaco: typeof Monaco) {
  if (completionsDone) return;
  completionsDone = true;

  for (const id of Object.keys(KEYWORDS)) {
    monaco.languages.registerCompletionItemProvider(id, {
      provideCompletionItems(model, position) {
        // Replace the word being typed rather than inserting beside it, which
        // is what makes accepting a suggestion mid-word behave.
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };
        const kw = monaco.languages.CompletionItemKind.Keyword;
        const snip = monaco.languages.CompletionItemKind.Snippet;
        const asSnippet =
          monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;

        return {
          suggestions: [
            ...(SNIPPETS[id] ?? []).map((s) => ({
              label: s.label,
              kind: snip,
              detail: s.detail,
              insertText: s.body,
              insertTextRules: asSnippet,
              range,
              // Snippets sort above the plain keyword of the same name.
              sortText: `0${s.label}`,
            })),
            ...KEYWORDS[id].map((k) => ({
              label: k,
              kind: kw,
              insertText: k,
              range,
              sortText: `1${k}`,
            })),
          ],
        };
      },
    });
  }
}

/** The page follows the OS colour scheme, and so should the editor. */
const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribeToScheme(onChange: () => void) {
  const mq = window.matchMedia(DARK_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

export function usePrefersDark(): boolean {
  return useSyncExternalStore(
    subscribeToScheme,
    () => window.matchMedia(DARK_QUERY).matches,
    // On the server there is no media query; light is the CSS default too.
    () => false,
  );
}

export function themeOf(dark: boolean): string {
  return dark ? "vault-dark" : "vault-light";
}
