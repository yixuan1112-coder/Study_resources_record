import "server-only";
import { readFile, writeFile } from "./github";
import type { CoursesFile } from "./types";

export const INDEX_PATH = "courses.json";

export async function loadIndex(
  token: string,
  owner: string,
): Promise<{ data: CoursesFile; sha: string | undefined }> {
  const file = await readFile(token, owner, INDEX_PATH);
  if (!file) return { data: { version: 1, courses: [] }, sha: undefined };
  try {
    const parsed = JSON.parse(file.text) as CoursesFile;
    return { data: { version: 1, courses: parsed.courses ?? [] }, sha: file.sha };
  } catch {
    // Someone hand-edited it into invalid JSON; don't clobber it silently.
    throw new Error("courses.json in your vault repo is not valid JSON");
  }
}

export async function saveIndex(
  token: string,
  owner: string,
  data: CoursesFile,
  sha: string | undefined,
  message: string,
): Promise<void> {
  data.courses.sort((a, b) => a.code.localeCompare(b.code));
  await writeFile(
    token,
    owner,
    INDEX_PATH,
    JSON.stringify(data, null, 2) + "\n",
    message,
    sha,
  );
}
