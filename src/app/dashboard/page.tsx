import Link from "next/link";
import { redirect } from "next/navigation";
import { Users } from "lucide-react";
import { auth } from "@/auth";
import { AppHeader } from "@/components/AppHeader";
import { CourseIndex } from "@/components/CourseIndex";
import { loadIndex } from "@/lib/courses";
import { ensureRepo } from "@/lib/github";
import { listIncomingInvites, listSharedVaults, type Person } from "@/lib/sharing";
import type { Course } from "@/lib/types";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.login || !session.accessToken) redirect("/");
  const { accessToken: token, login: me } = session;

  // First visit creates the private vault repo, so this runs before paint
  // rather than as a spinner on the client.
  let courses: Course[] = [];
  let error: string | null = null;
  try {
    await ensureRepo(token, me);
    courses = (await loadIndex(token, me)).data.courses;
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not open your vault";
  }

  // Sharing is a bonus panel — never let it break the main page.
  let shared: Person[] = [];
  let pendingInvites = 0;
  try {
    const [vaults, invites] = await Promise.all([
      listSharedVaults(token, me),
      listIncomingInvites(token),
    ]);
    shared = vaults;
    pendingInvites = invites.length;
  } catch {
    /* ignore */
  }

  return (
    <div className="min-h-screen">
      <AppHeader login={me} pendingInvites={pendingInvites} />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <CourseIndex initialCourses={courses} initialError={error} />

        {(shared.length > 0 || pendingInvites > 0) && (
          <section className="mt-10 border-t border-line pt-8">
            <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-faint">
              <Users className="h-4 w-4" />
              Shared with you
            </h2>

            {pendingInvites > 0 && (
              <Link
                href="/connections"
                className="card mb-3 block border-accent/40 p-4 text-sm hover:shadow-md"
              >
                <span className="font-medium text-accent">
                  {pendingInvites} invitation{pendingInvites === 1 ? "" : "s"}{" "}
                  waiting
                </span>
                <span className="mt-0.5 block text-muted">
                  Accept to start reading their materials.
                </span>
              </Link>
            )}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {shared.map((p) => (
                <Link
                  key={p.login}
                  href={`/u/${p.login}`}
                  className="card flex items-center gap-3 p-4 transition-shadow hover:shadow-md"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.avatarUrl} alt="" className="h-9 w-9 rounded-full" />
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-sm font-medium">
                      {p.login}
                    </span>
                    <span className="block text-xs text-faint">
                      Browse their courses
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
