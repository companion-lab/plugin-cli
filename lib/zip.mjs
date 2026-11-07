// Zip assembly for companion plugin packages.
//
// Produces an archive the host importer accepts (app/src-tauri
// plugin_host::import_archive): manifest.json either at the zip root or
// inside a single top-level folder. Entries get a fixed timestamp so builds
// are reproducible byte-for-byte.

import { zipSync } from "fflate";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

// DOS-era zips can't represent pre-1980 dates; 2020-01-01 is a stable anchor.
const FIXED_MTIME = new Date("2020-01-01T00:00:00Z");

/**
 * Write a zip from staged package files.
 *
 * @param {object} opts
 * @param {Array<{ from: string, name: string }>} opts.files
 *   `from` is the absolute path of the staged file, `name` its path inside
 *   the archive (e.g. "manifest.json" or "frontend.js").
 * @param {string} opts.outPath   Where to write the zip.
 * @param {string|null} [opts.folder]
 *   Top-level folder inside the archive (defaults to the plugin id in the
 *   caller). null places files at the zip root (--flat).
 * @returns {{ outPath: string, bytes: number, entries: string[] }}
 */
export function writeZip({ files, outPath, folder = null }) {
  const tree = {};
  const entries = [];
  for (const file of files) {
    const key = folder ? `${folder}/${file.name}` : file.name;
    tree[key] = [new Uint8Array(readFileSync(file.from)), { mtime: FIXED_MTIME, level: 9 }];
    entries.push(key);
  }
  const zipped = zipSync(tree);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, zipped);
  return { outPath, bytes: zipped.length, entries };
}

/** Human-readable size, e.g. "213.4 KB". */
export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
