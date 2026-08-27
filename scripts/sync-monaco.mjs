/**
 * Copies the Monaco editor runtime out of node_modules into public/monaco.
 *
 * Monaco is loaded at runtime by its own AMD loader rather than bundled, and
 * serving it from our own origin (instead of a CDN) keeps the editor working
 * offline, behind a campus proxy, and without a third party seeing which files
 * a student opens. public/monaco is generated, so it is gitignored and rebuilt
 * by the predev/prebuild hooks.
 */
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "monaco-editor", "min", "vs");
const dest = join(root, "public", "monaco", "vs");
const stamp = join(root, "public", "monaco", ".version");

if (!existsSync(src)) {
  console.error(
    "monaco-editor is not installed — run `npm install` before dev or build.",
  );
  process.exit(1);
}

const { version } = JSON.parse(
  await readFile(join(root, "node_modules", "monaco-editor", "package.json"), "utf8"),
);

const current = existsSync(stamp) ? await readFile(stamp, "utf8") : "";
if (current.trim() === version) {
  console.log(`monaco ${version} already in public/monaco`);
  process.exit(0);
}

await rm(join(root, "public", "monaco"), { recursive: true, force: true });
await mkdir(dirname(dest), { recursive: true });
await cp(src, dest, {
  recursive: true,
  // The UI is English-only; the translation bundles are dead weight.
  filter: (path) => !/nls\.messages\.[a-z-]+\.js$/i.test(path),
});
await writeFile(stamp, `${version}\n`);
console.log(`monaco ${version} copied to public/monaco`);
