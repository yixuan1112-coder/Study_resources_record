import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppHeader } from "@/components/AppHeader";
import { CourseWorkspace } from "@/components/CourseWorkspace";
import { loadIndex } from "@/lib/courses";
import { GitHubError, listDir } from "@/lib/github";
import { isValidLogin } from "@/lib/sharing";
import { kindOf, normalizeCode, type Course, type VaultFile } from "@/lib/types";

/** One course inside a vault someone shared with me. Read-only. */
export default async function SharedCoursePage({
  params,
}: {
  params: Promise<{ owner: string; code: string }>;
}) {
  const session = await auth();
  if (!session?.login || !session.accessToken) redirect("/");
  const { accessToken: token, login: me } = session;

  const { owner: rawOwner, code: rawCode } = await params;
  const owner = rawOwner;
  const code = normalizeCode(rawCode);
  if (!isValidLogin(owner) || !code) notFound();
  if (owner.toLowerCase() === me.toLowerCase()) redirect(`/course/${code}`);

  let course: Course | undefined;
  let files: VaultFile[] = [];
  try {
    const { data } = await loadIndex(token, owner);
    course = data.courses.find((c) => c.code === code);
    if (!course) notFound();

    files = (await listDir(token, owner, `courses/${code}`))
      .filter((e) => e.type === "file" && e.name !== "README.md")
      .map((e) => ({
        name: e.name,
        path: e.path,
        sha: e.sha,
        size: e.size,
        kind: kindOf(e.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  } catch (e) {
    if (e instanceof GitHubError && (e.status === 404 || e.status === 403)) {
      redirect(`/u/${owner}`);
    }
    throw e;
  }

  // Destinations offered by "Save a copy to my vault".
  let myCourses: Course[] = [];
  try {
    myCourses = (await loadIndex(token, me)).data.courses;
  } catch {
    /* copying is optional — don't fail the page over it */
  }

  return (
    <div className="min-h-screen">
      <AppHeader login={me} />
      <CourseWorkspace
        course={course}
        initialFiles={files}
        owner={owner}
        myCourses={myCourses}
      />
    </div>
  );
}
