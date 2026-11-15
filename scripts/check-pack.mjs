// CI check: the published tarball must contain the CLI entry point, every
// lib module, and the vendored SDK copy the build aliases against.
//
//   node scripts/check-pack.mjs

import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const tarballs = JSON.parse(
  execSync("npm pack --dry-run --json", { cwd: root, encoding: "utf8" }),
);
const packed = new Set(tarballs[0].files.map((f) => f.path));

const required = [
  "bin/companion-cli.mjs",
  "lib/build.mjs",
  "lib/scaffold.mjs",
  "lib/zip.mjs",
  ...["index.ts", "jsx-runtime.js", "react.js", "react-dom.js"].map(
    (f) => `sdk/js/@companion/plugin/${f}`,
  ),
  "README.md",
  "LICENSE",
];

const missing = required.filter((f) => !packed.has(f));
if (missing.length > 0) {
  console.error(`tarball is missing ${missing.length} required file(s):`);
  for (const f of missing) console.error(`  ${f}`);
  console.error('fix: add them to "files" in package.json');
  process.exit(1);
}
console.log(`pack ok: ${packed.size} files packed, all ${required.length} required entries present`);
