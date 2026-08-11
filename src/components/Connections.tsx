"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Loader2, Mail, UserPlus, Users, X } from "lucide-react";
import type { IncomingInvite, Person, SentInvite } from "@/lib/sharing";

export type ConnectionState = {
  me: string;
  iShareWith: Person[];
  sentInvites: SentInvite[];
  sharingWithMe: Person[];
  incoming: IncomingInvite[];
};

export function Connections({
  initial,
  initialError,
}: {
  initial: ConnectionState;
  initialError: string | null;
}) {
  const [state, setState] = useState(initial);
  const [error, setError] = useState<string | null>(initialError);
  const [login, setLogin] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/connections");
    const body = await res.json().catch(() => ({}));
    if (res.ok) setState(body);
    else setError(body.error ?? "Could not refresh connections");
  }

  async function act(key: string, run: () => Promise<Response>) {
    setBusy(key);
    setError(null);
    const res = await run();
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "That did not work");
    } else {
      await refresh();
    }
    setBusy(null);
  }

  const invite = (e: React.FormEvent) => {
    e.preventDefault();
    const who = login.trim().replace(/^@/, "");
    if (!who) return;
    void act("invite", () =>
      fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "invite", login: who }),
      }).then((r) => {
        if (r.ok) setLogin("");
        return r;
      }),
    );
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Study group</h1>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
          Share your vault with a coursemate and they can read everything in it
          — and save copies into their own. Access is read-only: nobody can
          change or delete your files, and you can revoke it at any time.
        </p>
      </div>

      {error && (
        <div className="card flex items-start gap-2 border-danger/40 p-4 text-sm text-danger">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <form onSubmit={invite} className="card p-4">
        <label className="mb-1.5 block text-sm font-medium">
          Invite by GitHub username
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            className="field max-w-xs flex-1 font-mono"
            placeholder="their-github-username"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
          />
          <button
            type="submit"
            disabled={busy === "invite" || !login.trim()}
            className="btn-primary"
          >
            {busy === "invite" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <UserPlus className="h-4 w-4" />
            )}
            Send invite
          </button>
        </div>
        <p className="mt-2 text-xs text-faint">
          They will get a GitHub notification, then need to accept it here or on
          GitHub.
        </p>
      </form>

      {state.incoming.length > 0 && (
        <Section
          icon={<Mail className="h-4 w-4" />}
          title="Invitations waiting for you"
        >
          {state.incoming.map((inv) => (
            <Row key={inv.id} login={inv.owner} avatar={inv.avatarUrl}>
              <button
                disabled={busy === `a${inv.id}`}
                onClick={() =>
                  void act(`a${inv.id}`, () =>
                    fetch("/api/connections", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "accept", id: inv.id }),
                    }),
                  )
                }
                className="btn-primary px-3 py-1.5 text-xs"
              >
                {busy === `a${inv.id}` ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                Accept
              </button>
              <button
                disabled={busy === `d${inv.id}`}
                onClick={() =>
                  void act(`d${inv.id}`, () =>
                    fetch("/api/connections", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "decline", id: inv.id }),
                    }),
                  )
                }
                className="btn-ghost px-3 py-1.5 text-xs"
              >
                Decline
              </button>
            </Row>
          ))}
        </Section>
      )}

      <Section
        icon={<Users className="h-4 w-4" />}
        title="Vaults shared with you"
        empty="Nobody has shared their vault with you yet."
      >
        {state.sharingWithMe.map((p) => (
          <Row key={p.login} login={p.login} avatar={p.avatarUrl}>
            <Link href={`/u/${p.login}`} className="btn-ghost px-3 py-1.5 text-xs">
              Browse courses
            </Link>
          </Row>
        ))}
      </Section>

      <Section
        icon={<UserPlus className="h-4 w-4" />}
        title="People you share with"
        empty="You are not sharing your vault with anyone yet."
      >
        {state.iShareWith.map((p) => (
          <Row key={p.login} login={p.login} avatar={p.avatarUrl}>
            <button
              disabled={busy === `r${p.login}`}
              onClick={() => {
                if (!confirm(`Stop sharing your vault with ${p.login}?`)) return;
                void act(`r${p.login}`, () =>
                  fetch(`/api/connections?login=${encodeURIComponent(p.login)}`, {
                    method: "DELETE",
                  }),
                );
              }}
              className="btn-ghost px-3 py-1.5 text-xs"
            >
              {busy === `r${p.login}` && (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              )}
              Revoke
            </button>
          </Row>
        ))}
        {state.sentInvites.map((inv) => (
          <Row key={inv.id} login={inv.login} avatar={inv.avatarUrl} pending>
            <button
              disabled={busy === `c${inv.id}`}
              onClick={() =>
                void act(`c${inv.id}`, () =>
                  fetch(`/api/connections?inviteId=${inv.id}`, { method: "DELETE" }),
                )
              }
              className="btn-ghost px-3 py-1.5 text-xs"
            >
              {busy === `c${inv.id}` && (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              )}
              Cancel invite
            </button>
          </Row>
        ))}
      </Section>
    </div>
  );
}

function Section({
  icon,
  title,
  empty,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  empty?: string;
  children: React.ReactNode;
}) {
  const isEmpty = Array.isArray(children)
    ? children.flat().filter(Boolean).length === 0
    : !children;

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-faint">
        {icon}
        {title}
      </h2>
      {isEmpty && empty ? (
        <p className="card px-4 py-6 text-center text-sm text-muted">{empty}</p>
      ) : (
        <div className="card divide-y divide-line overflow-hidden">{children}</div>
      )}
    </section>
  );
}

function Row({
  login,
  avatar,
  pending,
  children,
}: {
  login: string;
  avatar: string;
  pending?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 p-3">
      {/* GitHub avatars are public URLs; next/image would need remote config. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={avatar} alt="" className="h-8 w-8 rounded-full" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-sm">{login}</span>
        {pending && (
          <span className="block text-xs text-faint">invite pending</span>
        )}
      </span>
      <div className="flex shrink-0 gap-1.5">{children}</div>
    </div>
  );
}
