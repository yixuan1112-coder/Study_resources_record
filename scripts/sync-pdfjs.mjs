/**
 * Copies the pdf.js runtime out of node_modules into public/pdfjs.
 *
 * The viewer imports the library itself through the bundler, but three things
 * have to be fetched at runtime from a URL: the worker, the CMap tables (what
 * makes a Chinese lecture PDF render instead of coming out blank), and the
 * standard font data. Serving them from our own origin keeps a private vault's
 * PDFs from being read with help from a third-party CDN.
 *
 * public/pdfjs is generated, so it is gitignored and rebuilt by the
 * predev/prebuild hooks.
 */
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "pdfjs-dist");
const dest = join(root, "public", "pdfjs");
const stamp = join(dest, ".version");

if (!existsSync(src)) {
  console.error(
    "pdfjs-dist is not installed — run `npm install` before dev or build.",
  );
  process.exit(1);
}

const { version } = JSON.parse(
  await readFile(join(src, "package.json"), "utf8"),
);

const current = existsSync(stamp) ? await readFile(stamp, "utf8") : "";
if (current.trim() === version) {
  console.log(`pdfjs ${version} already in public/pdfjs`);
  process.exit(0);
}

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });
await cp(
  join(src, "build", "pdf.worker.min.mjs"),
  join(dest, "pdf.worker.min.mjs"),
);
// cmaps: CJK encodings. standard_fonts: the 14 base fonts a PDF may omit.
// wasm + iccs: JPEG 2000 / JBIG2 images and colour profiles.
for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  await cp(join(src, dir), join(dest, dir), { recursive: true });
}
await writeFile(stamp, `${version}\n`);
console.log(`pdfjs ${version} copied to public/pdfjs`);
