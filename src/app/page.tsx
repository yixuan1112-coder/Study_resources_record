import { redirect } from "next/navigation";
import { AlertTriangle, FileText, FolderTree, Github, Lock, Users } from "lucide-react";
import { auth, missingAuthEnv, signIn } from "@/auth";

const ERROR_HINTS: Record<string, string> = {
  Configuration:
    "The server is missing its GitHub OAuth settings, or they do not match the OAuth App.",
  AccessDenied: "You cancelled the GitHub authorisation, or it was refused.",
  Verification: "That sign-in link has already been used or has expired.",
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.login) redirect("/dashboard");

  const { error } = await searchParams;
  const missing = missingAuthEnv();

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-16">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-accent">
        <span className="inline-block h-2 w-2 rounded-full bg-accent" />
        NTU Course Vault
      </div>

      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        Every course, every file, one index.
      </h1>
      <p className="mt-4 text-[15px] leading-7 text-muted">
        Drop lecture PDFs, your markdown notes and photos of the whiteboard into
        the course they belong to, then read them all back in one place when it is
        time to revise.
      </p>

      {(error || missing.length > 0) && (
        <SetupHelp error={error} missing={missing} />
      )}

      <form
        className="mt-8"
        action={async () => {
          "use server";
          await signIn("github", { redirectTo: "/dashboard" });
        }}
      >
        <button
          type="submit"
          disabled={missing.length > 0}
          className="btn-primary w-full py-2.5"
        >
          <Github className="h-4 w-4" />
          Continue with GitHub
        </button>
      </form>

      <ul className="mt-10 space-y-4 text-sm text-muted">
        <Point icon={<Lock className="h-4 w-4" />}>
          Your files live in a <strong className="font-medium text-ink">private
          repo on your own GitHub account</strong> — not in someone else&apos;s
          database.
        </Point>
        <Point icon={<FolderTree className="h-4 w-4" />}>
          One folder per course code, so <span className="font-mono text-[13px]">
          CZ1003</span> stays separate from <span className="font-mono text-[13px]">
          MH1812</span>.
        </Point>
        <Point icon={<FileText className="h-4 w-4" />}>
          PDFs, markdown and images all preview in the browser. Rename or move
          anything without leaving the page.
        </Point>
        <Point icon={<Users className="h-4 w-4" />}>
          Share your vault with coursemates read-only, and save copies of their
          notes into your own.
        </Point>
      </ul>

      <p className="mt-10 text-xs leading-5 text-faint">
        Signing in asks for repository access so the app can create your private
        vault and save files into it. Nothing is written until you upload
        something.
      </p>
    </main>
  );
}

/** Names the actual misconfiguration instead of "check the server logs". */
function SetupHelp({
  error,
  missing,
}: {
  error?: string;
  missing: string[];
}) {
  return (
    <div className="card mt-8 border-danger/40 p-4">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
        <div className="min-w-0 text-sm">
          <p className="font-medium text-danger">Sign-in is not configured yet</p>
          {error && (
            <p className="mt-1 leading-6 text-muted">
              {ERROR_HINTS[error] ?? `GitHub returned "${error}".`}
            </p>
          )}

          {missing.length > 0 ? (
            <>
              <p className="mt-3 leading-6 text-muted">
                These environment variables are not set on the server:
              </p>
              <ul className="mt-2 space-y-1">
                {missing.map((name) => (
                  <li key={name} className="font-mono text-[13px] text-ink">
                    {name}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs leading-5 text-faint">
                On Vercel: Project → Settings → Environment Variables. Adding
                them does not affect the running deployment — you must redeploy
                afterwards. Locally: put them in <code>.env.local</code> and
                restart.
              </p>
            </>
          ) : (
            <p className="mt-3 text-xs leading-5 text-faint">
              All three variables are set, so the likely cause is a mismatch:
              the OAuth App&apos;s callback URL must be exactly this site&apos;s
              origin followed by <code>/api/auth/callback/github</code>, and the
              client secret must belong to that same OAuth App.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Point({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 shrink-0 text-accent">{icon}</span>
      <span className="leading-6">{children}</span>
    </li>
  );
}
