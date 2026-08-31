"use client";

import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Download, ExternalLink, Loader2, X } from "lucide-react";
import { formatBytes, type VaultFile } from "@/lib/types";
import { PdfViewer } from "./PdfViewer";

/** `owner` is set only when reading a vault someone shared with me. */
export function fileUrl(
  code: string,
  name: string,
  opts: { download?: boolean; owner?: string; v?: string } = {},
) {
  const q = new URLSearchParams({ code, name });
  if (opts.download) q.set("download", "1");
  if (opts.owner) q.set("owner", opts.owner);
  // `v` is the blob sha. /api/file ignores it — its only job is to put the
  // file's identity in the URL, so the URL changes when the bytes do. Without
  // it an edit by someone else is invisible twice over: the browser holds the
  // response for a minute (see the Cache-Control the route sets), and the
  // viewer below is keyed on this string, so it never even remounts to ask.
  if (opts.v) q.set("v", opts.v);
  return `/api/file?${q}`;
}

export function FileViewer({
  code,
  file,
  owner,
  onClose,
}: {
  code: string;
  file: VaultFile;
  owner?: string;
  onClose: () => void;
}) {
  const src = fileUrl(code, file.name, { owner, v: file.sha });

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {file.name}
        </span>
        <span className="shrink-0 text-xs text-faint">
          {formatBytes(file.size)}
        </span>
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className="rounded p-1.5 text-faint hover:bg-raised hover:text-ink"
          title="Open in a new tab"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
        <a
          href={fileUrl(code, file.name, { download: true, owner, v: file.sha })}
          className="rounded p-1.5 text-faint hover:bg-raised hover:text-ink"
          title="Download"
        >
          <Download className="h-4 w-4" />
        </a>
        <button
          onClick={onClose}
          className="rounded p-1.5 text-faint hover:bg-raised hover:text-ink"
          title="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {file.kind === "pdf" ? (
          // Keyed so opening a different PDF starts from a clean reader
          // instead of inheriting the previous one's pages and highlights.
          <PdfViewer key={src} code={code} file={file} src={src} owner={owner} />
        ) : file.kind === "image" ? (
          <div className="flex h-full items-center justify-center p-4">
            {/* Proxied through our API because vault repos are private. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={file.name}
              className="max-h-[75vh] max-w-full rounded-lg object-contain"
            />
          </div>
        ) : file.kind === "markdown" ? (
          // Keyed so switching notes remounts with fresh state.
          <MarkdownView key={src} code={code} src={src} owner={owner} />
        ) : (
          <div className="flex h-full min-h-[320px] flex-col items-center justify-center px-6 text-center">
            <p className="text-sm text-muted">No preview for this file type.</p>
            <a
              href={fileUrl(code, file.name, { download: true, owner, v: file.sha })}
              className="btn-ghost mt-4"
            >
              <Download className="h-4 w-4" />
              Download {file.name}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function MarkdownView({
  code,
  src,
  owner,
}: {
  code: string;
  src: string;
  owner?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(src, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error("Could not load this note");
        return r.text();
      })
      .then(setText)
      .catch((e: Error) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, [src]);

  if (error) return <p className="p-6 text-sm text-danger">{error}</p>;
  if (text === null) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading note…
      </div>
    );
  }

  return (
    <article className="prose-notes p-5">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Images written as plain filenames live beside the note in the same
          // course folder, so point them at the proxy.
          img: ({ src: imgSrc, alt }) => {
            const raw = typeof imgSrc === "string" ? imgSrc : "";
            const resolved = /^(https?:|data:)/.test(raw)
              ? raw
              : fileUrl(code, raw.replace(/^\.?\//, ""), { owner });
            // eslint-disable-next-line @next/next/no-img-element
            return <img src={resolved} alt={alt ?? ""} />;
          },
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </Markdown>
    </article>
  );
}
