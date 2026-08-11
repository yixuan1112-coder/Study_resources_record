import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppHeader } from "@/components/AppHeader";
import { CourseWorkspace } from "@/components/CourseWorkspace";
import { loadIndex } from "@/lib/courses";
import { listDir } from "@/lib/github";
import { kindOf, normalizeCode, type VaultFile } from "@/lib/types";

export default async function CoursePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const session = await auth();
  if (!session?.login || !session.accessToken) redirect("/");
  const { token, owner } = { token: session.accessToken, owner: session.login };

  const code = normalizeCode((await params).code);
  if (!code) notFound();

  const { data } = await loadIndex(token, owner);
  const course = data.courses.find((c) => c.code === code);
  if (!course) notFound();

  const entries = await listDir(token, owner, `courses/${code}`);
  const files: VaultFile[] = entries
    .filter((e) => e.type === "file" && e.name !== "README.md")
    .map((e) => ({
      name: e.name,
      path: e.path,
      sha: e.sha,
      size: e.size,
      kind: kindOf(e.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  return (
    <div className="min-h-screen">
      <AppHeader login={session.login} />
      <CourseWorkspace course={course} initialFiles={files} />
    </div>
  );
}
