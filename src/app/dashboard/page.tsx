import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppHeader } from "@/components/AppHeader";
import { CourseIndex } from "@/components/CourseIndex";
import { loadIndex } from "@/lib/courses";
import { ensureRepo } from "@/lib/github";
import type { Course } from "@/lib/types";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.login || !session.accessToken) redirect("/");

  // First visit creates the private vault repo, so this runs before paint
  // rather than as a spinner on the client.
  let courses: Course[] = [];
  let error: string | null = null;
  try {
    await ensureRepo(session.accessToken, session.login);
    courses = (await loadIndex(session.accessToken, session.login)).data.courses;
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not open your vault";
  }

  return (
    <div className="min-h-screen">
      <AppHeader login={session.login} />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <CourseIndex initialCourses={courses} initialError={error} />
      </main>
    </div>
  );
}
