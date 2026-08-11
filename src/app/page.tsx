import { redirect } from "next/navigation";
import { FileText, FolderTree, Github, Lock } from "lucide-react";
import { auth, signIn } from "@/auth";

export default async function Home() {
  const session = await auth();
  if (session?.login) redirect("/dashboard");

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

      <form
        className="mt-8"
        action={async () => {
          "use server";
          await signIn("github", { redirectTo: "/dashboard" });
        }}
      >
        <button type="submit" className="btn-primary w-full py-2.5">
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
      </ul>

      <p className="mt-10 text-xs leading-5 text-faint">
        Signing in asks for repository access so the app can create your private
        vault and save files into it. Nothing is written until you upload
        something.
      </p>
    </main>
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
