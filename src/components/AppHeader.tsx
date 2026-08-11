import Link from "next/link";
import { Github, LogOut, Users } from "lucide-react";
import { signOut } from "@/auth";
import { VAULT_REPO } from "@/lib/github";

export function AppHeader({
  login,
  pendingInvites = 0,
}: {
  login: string;
  pendingInvites?: number;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
          <span className="inline-block h-2 w-2 rounded-full bg-accent" />
          <span className="tracking-tight">Course Vault</span>
        </Link>

        <div className="ml-auto flex items-center gap-1">
          <Link href="/connections" className="btn-quiet relative">
            <Users className="h-4 w-4" />
            <span className="hidden sm:inline">Study group</span>
            {pendingInvites > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white">
                {pendingInvites}
              </span>
            )}
          </Link>
          <a
            href={`https://github.com/${login}/${VAULT_REPO}`}
            target="_blank"
            rel="noreferrer"
            className="btn-quiet hidden sm:inline-flex"
            title="Open the vault repository on GitHub"
          >
            <Github className="h-4 w-4" />
            <span className="font-mono text-xs">{login}/{VAULT_REPO}</span>
          </a>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button type="submit" className="btn-quiet" title="Sign out">
              <LogOut className="h-4 w-4" />
              <span className="sr-only">Sign out</span>
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
