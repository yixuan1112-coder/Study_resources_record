import { NextRequest, NextResponse } from "next/server";
import { loadIndex, saveIndex } from "@/lib/courses";
import { ensureRepo, writeFile } from "@/lib/github";
import { getActor, toErrorResponse, unauthorized } from "@/lib/session";
import { normalizeCode, type Course } from "@/lib/types";

export async function GET() {
  const actor = await getActor();
  if (!actor) return unauthorized();
  try {
    const created = await ensureRepo(actor.token, actor.owner);
    const { data } = await loadIndex(actor.token, actor.owner);
    return NextResponse.json({ courses: data.courses, repoCreated: created });
  } catch (e) {
    return toErrorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  const actor = await getActor();
  if (!actor) return unauthorized();

  const body = (await req.json().catch(() => null)) as Partial<Course> | null;
  const code = normalizeCode(body?.code ?? "");
  const title = (body?.title ?? "").trim();
  if (!code) {
    return NextResponse.json(
      { error: "A course code is required (letters and digits)" },
      { status: 400 },
    );
  }

  try {
    await ensureRepo(actor.token, actor.owner);
    const { data, sha } = await loadIndex(actor.token, actor.owner);
    if (data.courses.some((c) => c.code === code)) {
      return NextResponse.json(
        { error: `${code} is already in your index` },
        { status: 409 },
      );
    }

    const course: Course = {
      code,
      title,
      ay: body?.ay?.trim() || undefined,
      sem: body?.sem?.trim() || undefined,
      au: body?.au?.trim() || undefined,
      notes: body?.notes?.trim() || undefined,
      createdAt: new Date().toISOString(),
    };
    data.courses.push(course);
    await saveIndex(actor.token, actor.owner, data, sha, `Add course ${code}`);

    // Keep the folder alive even before the first upload.
    await writeFile(
      actor.token,
      actor.owner,
      `courses/${code}/README.md`,
      `# ${code}${title ? ` — ${title}` : ""}\n\nMaterials for this course.\n`,
      `Create folder for ${code}`,
    ).catch(() => {});

    return NextResponse.json({ course });
  } catch (e) {
    return toErrorResponse(e);
  }
}

export async function PATCH(req: NextRequest) {
  const actor = await getActor();
  if (!actor) return unauthorized();

  const body = (await req.json().catch(() => null)) as Partial<Course> | null;
  const code = normalizeCode(body?.code ?? "");
  if (!code) return NextResponse.json({ error: "Missing course" }, { status: 400 });

  try {
    const { data, sha } = await loadIndex(actor.token, actor.owner);
    const course = data.courses.find((c) => c.code === code);
    if (!course) {
      return NextResponse.json({ error: "No such course" }, { status: 404 });
    }
    if (body?.title !== undefined) course.title = body.title.trim();
    if (body?.ay !== undefined) course.ay = body.ay.trim() || undefined;
    if (body?.sem !== undefined) course.sem = body.sem.trim() || undefined;
    if (body?.au !== undefined) course.au = body.au.trim() || undefined;
    if (body?.notes !== undefined) course.notes = body.notes.trim() || undefined;

    await saveIndex(actor.token, actor.owner, data, sha, `Update ${code}`);
    return NextResponse.json({ course });
  } catch (e) {
    return toErrorResponse(e);
  }
}

export async function DELETE(req: NextRequest) {
  const actor = await getActor();
  if (!actor) return unauthorized();

  const code = normalizeCode(req.nextUrl.searchParams.get("code") ?? "");
  if (!code) return NextResponse.json({ error: "Missing course" }, { status: 400 });

  try {
    const { data, sha } = await loadIndex(actor.token, actor.owner);
    const next = data.courses.filter((c) => c.code !== code);
    if (next.length === data.courses.length) {
      return NextResponse.json({ error: "No such course" }, { status: 404 });
    }
    // Only the index entry goes; the files stay in git so nothing is lost.
    await saveIndex(
      actor.token,
      actor.owner,
      { version: 1, courses: next },
      sha,
      `Remove ${code} from index`,
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return toErrorResponse(e);
  }
}
