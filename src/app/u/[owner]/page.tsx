import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Lock } from "lucide-react";
import { auth } from "@/auth";
import { AppHeader } from "@/components/AppHeader";
import { loadIndex } from "@/lib/courses";
import { GitHubError } from "@/lib/github";
import { isValidLogin } from "@/lib/sharing";
import { colorForCode, type Course } from "@/lib/types";

/** Read-only view of a vault someone shared with me. */
export default async function SharedVaultPage({
  params,
}: {
  params: Promise<{ owner: string }>;
}) {
  const session = await auth();
  if (!session?.login || !session.accessToken) redirect("/");

  const owner = (await params).owner;
  if (!isValidLogin(owner)) notFound();
  if (owner.toLowerCase() === session.login.toLowerCase()) redirect("/dashboard");

  let courses: Course[] = [];
  try {
    courses = (await loadIndex(session.accessToken, owner)).data.courses;
  } catch (e) {
    // GitHub answers 404 for private repos you cannot see, so this covers both
    // "no such vault" and "they have not shared it with you".
    if (e instanceof GitHubError && (e.status === 404 || e.status === 403)) {
      return (
        <div className="min-h-screen">
          <AppHeader login={session.login} />
          <main className="mx-auto max-w-xl px-4 py-16 text-center sm:px-6">
            <Lock className="mx-auto mb-4 h-8 w-8 text-faint" />
            <h1 className="text-xl font-semibold">No access to this vault</h1>
            <p className="mt-2 text-sm leading-6 text-muted">
              <span className="font-mono">{owner}</span> has not shared their
              vault with you, or they have not set one up yet. If they just sent
              an invite, accept it first.
            </p>
            <Link href="/connections" className="btn-primary mt-6">
              Go to study group
            </Link>
          </main>
        </div>
      );
    }
    throw e;
  }

  return (
    <div className="min-h-screen">
      <AppHeader login={session.login} />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <Link
          href="/connections"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" />
          Study group
        </Link>

        <h1 className="text-2xl font-semibold tracking-tight">
          <span className="font-mono">{owner}</span>&apos;s courses
        </h1>
        <p className="mt-1 text-sm text-muted">
          {courses.length} course{courses.length === 1 ? "" : "s"} · read only
        </p>

        {courses.length === 0 ? (
          <p className="card mt-6 px-6 py-14 text-center text-sm text-muted">
            They haven&apos;t added any courses yet.
          </p>
        ) : (
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {courses.map((course) => {
              const color = colorForCode(course.code);
              return (
                <Link
                  key={course.code}
                  href={`/u/${owner}/${course.code}`}
                  className="card relative flex flex-col overflow-hidden p-4 transition-shadow hover:shadow-md"
                >
                  <span
                    className="absolute inset-x-0 top-0 h-1"
                    style={{ backgroundColor: color }}
                  />
                  <span
                    className="font-mono text-sm font-semibold"
                    style={{ color }}
                  >
                    {course.code}
                  </span>
                  <p className="mt-1.5 line-clamp-2 text-[15px] font-medium leading-snug">
                    {course.title || (
                      <span className="text-faint">Untitled course</span>
                    )}
                  </p>
                  {(course.ay || course.sem) && (
                    <p className="mt-auto pt-3 text-xs text-faint">
                      {course.ay}
                      {course.sem ? ` · Sem ${course.sem}` : ""}
                    </p>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
