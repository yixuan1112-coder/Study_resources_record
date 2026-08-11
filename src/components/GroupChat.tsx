"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, MessageSquare, RefreshCw, Send } from "lucide-react";

export type ChatRoom = {
  /** Whose vault the room belongs to. */
  owner: string;
  avatarUrl: string;
};

type Message = {
  id: number;
  author: string;
  avatarUrl: string;
  body: string;
  createdAt: string;
  url: string;
};

const POLL_MS = 10_000;
const MAX_CHARS = 4000;

export function GroupChat({ me, rooms }: { me: string; rooms: ChatRoom[] }) {
  const [active, setActive] = useState(rooms[0]?.owner ?? me);
  const [messages, setMessages] = useState<Message[]>([]);
  /** Which room the messages on screen belong to; drives the spinner. */
  const [loadedRoom, setLoadedRoom] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const scroller = useRef<HTMLDivElement>(null);

  const loading = loadedRoom !== active;

  // Load the room, then keep it fresh while the tab is in front — which also
  // picks up replies written on GitHub itself.
  useEffect(() => {
    let cancelled = false;

    async function pull() {
      const res = await fetch(`/api/chat?owner=${encodeURIComponent(active)}`);
      const body = await res.json().catch(() => ({}));
      if (cancelled) return;
      if (!res.ok) {
        setError(body.error ?? "Could not load this chat");
        setMessages([]);
      } else {
        setError(null);
        setMessages(body.messages ?? []);
      }
      setLoadedRoom(active);
    }

    const tick = () => {
      if (document.visibilityState === "visible") void pull();
    };

    void pull();
    const id = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [active, reloads]);

  // Keep the newest message in view.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;

    setSending(true);
    setError(null);
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ owner: active, body: text }),
    });
    const body = await res.json().catch(() => ({}));
    setSending(false);

    if (!res.ok) {
      setError(body.error ?? "Message not sent");
      return;
    }
    setDraft("");
    setMessages((prev) =>
      prev.some((m) => m.id === body.message.id) ? prev : [...prev, body.message],
    );
  }

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-faint">
        <MessageSquare className="h-4 w-4" />
        Group chat
      </h2>

      {rooms.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {rooms.map((r) => (
            <button
              key={r.owner}
              onClick={() => setActive(r.owner)}
              className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                active === r.owner
                  ? "bg-accent-soft font-medium text-accent"
                  : "text-muted hover:bg-raised"
              }`}
            >
              {/* GitHub avatars are public URLs; next/image would need remote config. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={r.avatarUrl} alt="" className="h-4 w-4 rounded-full" />
              {r.owner === me ? "Your group" : r.owner}
            </button>
          ))}
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <span className="min-w-0 flex-1 text-sm">
            {active === me ? (
              <>
                Everyone you share your vault with
                <span className="block text-xs text-faint">
                  Your group — messages live in your vault repository
                </span>
              </>
            ) : (
              <>
                <span className="font-mono">{active}</span>&apos;s study group
                <span className="block text-xs text-faint">
                  Everyone {active} shares that vault with can read this
                </span>
              </>
            )}
          </span>
          <button
            onClick={() => setReloads((n) => n + 1)}
            className="rounded p-1.5 text-faint hover:bg-raised hover:text-ink"
            title="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>

        {error && (
          <p className="border-b border-line px-4 py-2.5 text-sm text-danger">
            {error}
          </p>
        )}

        <div ref={scroller} className="max-h-[26rem] min-h-[12rem] overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading messages…
            </div>
          ) : messages.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">
              No messages yet. Say hello — everyone in this group will see it.
            </p>
          ) : (
            <ol className="space-y-3">
              {messages.map((m, i) => (
                <Bubble
                  key={m.id}
                  message={m}
                  mine={m.author.toLowerCase() === me.toLowerCase()}
                  /* Consecutive messages from one person share a header. */
                  compact={messages[i - 1]?.author === m.author}
                />
              ))}
            </ol>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          className="flex items-end gap-2 border-t border-line p-3"
        >
          <textarea
            rows={1}
            maxLength={MAX_CHARS}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={
              active === me ? "Message your group…" : `Message ${active}'s group…`
            }
            className="field max-h-32 min-h-[2.5rem] flex-1 resize-y"
          />
          <button
            type="submit"
            disabled={sending || !draft.trim()}
            className="btn-primary shrink-0"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            <span className="hidden sm:inline">Send</span>
          </button>
        </form>
      </div>

      <p className="mt-2 text-xs text-faint">
        Enter sends · Shift+Enter starts a new line. Messages are stored as
        comments on a &ldquo;Study group chat&rdquo; issue in the vault
        repository, so they are readable on GitHub too.
      </p>
    </section>
  );
}

function Bubble({
  message,
  mine,
  compact,
}: {
  message: Message;
  mine: boolean;
  compact: boolean;
}) {
  return (
    <li className={`flex gap-2.5 ${mine ? "flex-row-reverse" : ""}`}>
      <span className="w-7 shrink-0">
        {!compact && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={message.avatarUrl}
              alt=""
              className="h-7 w-7 rounded-full"
            />
          </>
        )}
      </span>
      <div className={`min-w-0 max-w-[80%] ${mine ? "text-right" : ""}`}>
        {!compact && (
          <p className="mb-1 text-xs text-faint">
            <span className="font-mono">{mine ? "you" : message.author}</span>
            <span> · {formatWhen(message.createdAt)}</span>
          </p>
        )}
        <div
          className={`inline-block whitespace-pre-wrap break-words rounded-xl px-3 py-2 text-left text-sm ${
            mine ? "bg-accent-soft text-ink" : "bg-raised text-ink"
          }`}
        >
          {message.body}
        </div>
      </div>
    </li>
  );
}

function formatWhen(iso: string): string {
  const then = new Date(iso);
  const mins = Math.round((Date.now() - then.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
