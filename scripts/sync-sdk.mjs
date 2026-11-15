// Vendor the JS plugin SDK from companion-lab/companion-sdk-js into the copy
// this CLI ships (sdk/js/@companion/plugin) — the build aliases SDK specifiers
// against these files, so the copy must not drift.
//
//   node scripts/sync-sdk.mjs [ref]      default ref: main
//
// Fetches the 4 source files from raw.githubusercontent.com, overwrites the
// vendored copy, and prints what changed. Exits non-zero if any fetch fails
// (a 404 means the ref or filename is wrong; nothing is left half-written
// beyond unchanged files).

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "companion-lab/companion-sdk-js";
const FILES = ["index.ts", "jsx-runtime.js", "react.js", "react-dom.js"];

const ref = process.argv[2] || "main";
const destDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "sdk",
  "js",
  "@companion",
  "plugin",
);

console.log(`syncing from ${REPO}@${ref} -> ${path.relative(process.cwd(), destDir)}/`);

let changed = 0;
for (const file of FILES) {
  const res = await fetch(`https://raw.githubusercontent.com/${REPO}/${ref}/${file}`);
  if (!res.ok) {
    console.error(`error: fetching ${REPO}@${ref}/${file} -> HTTP ${res.status}`);
    process.exit(1);
  }
  const next = await res.text();
  const dest = path.join(destDir, file);
  let prev = null;
  try {
    prev = readFileSync(dest, "utf8");
  } catch {
    // missing vendored file — will be created
  }
  if (prev === next) {
    console.log(`  unchanged  ${file}`);
    continue;
  }
  writeFileSync(dest, next);
  changed++;
  console.log(
    `  ${prev === null ? "created" : "updated"}  ${file} (${prev?.length ?? 0} -> ${next.length} bytes)`,
  );
}

console.log(
  changed === 0
    ? `vendored copy already matches ${REPO}@${ref}`
    : `synced ${changed}/${FILES.length} file(s) from ${REPO}@${ref}`,
);
