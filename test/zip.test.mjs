// Zip assembly tests: the host importer accepts manifest.json at the root or
// inside one top-level folder, and builds must be reproducible byte-for-byte.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { unzipSync } from "fflate";
import { writeZip, formatBytes } from "../lib/zip.mjs";

let work;

beforeEach(() => {
  work = mkdtempSync(path.join(tmpdir(), "companion-cli-zip-"));
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

// Stage a file with the given content; writeZip reads from disk.
function stage(name, content) {
  const from = path.join(work, name);
  mkdirSync(path.dirname(from), { recursive: true });
  writeFileSync(from, content);
  return { from, name };
}

function unzip(outPath) {
  return unzipSync(new Uint8Array(readFileSync(outPath)));
}

describe("formatBytes", () => {
  it("formats bytes below 1 KB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("formats kilobytes with one decimal", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(218557)).toBe("213.4 KB");
  });

  it("formats megabytes with one decimal", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(2.5 * 1024 * 1024)).toBe("2.5 MB");
  });
});

describe("writeZip", () => {
  it("round-trips staged files at the zip root (flat)", () => {
    const files = [
      stage("manifest.json", '{"id":"demo"}'),
      stage("frontend.js", "console.log('hi');"),
    ];
    const outPath = path.join(work, "out", "demo.zip");
    const result = writeZip({ files, outPath, folder: null });

    expect(result.entries.sort()).toEqual(["frontend.js", "manifest.json"]);
    expect(result.outPath).toBe(outPath);
    expect(result.bytes).toBe(statSync(outPath).size);

    const entries = unzip(outPath);
    expect(new TextDecoder().decode(entries["manifest.json"])).toBe('{"id":"demo"}');
    expect(new TextDecoder().decode(entries["frontend.js"])).toBe("console.log('hi');");
  });

  it("prefixes entries with the folder when given", () => {
    const files = [stage("manifest.json", '{"id":"demo"}')];
    const outPath = path.join(work, "demo.zip");
    const result = writeZip({ files, outPath, folder: "demo" });

    expect(result.entries).toEqual(["demo/manifest.json"]);
    const entries = unzip(outPath);
    expect(Object.keys(entries)).toEqual(["demo/manifest.json"]);
    expect(new TextDecoder().decode(entries["demo/manifest.json"])).toBe('{"id":"demo"}');
  });

  it("reproduces identical bytes across runs (fixed mtime)", () => {
    const files = [stage("manifest.json", '{"id":"demo"}')];
    const a = writeZip({ files, outPath: path.join(work, "a.zip"), folder: "demo" });
    const b = writeZip({ files, outPath: path.join(work, "b.zip"), folder: "demo" });
    expect(a.bytes).toBe(b.bytes);
    expect(readFileSync(a.outPath)).toEqual(readFileSync(b.outPath));
  });

  it("creates the output directory when missing", () => {
    const files = [stage("manifest.json", "{}")];
    const outPath = path.join(work, "deep", "nested", "demo.zip");
    writeZip({ files, outPath });
    expect(readFileSync(outPath).length).toBeGreaterThan(0);
  });

  it("zips arbitrary entry names", () => {
    const files = [stage("manifest.json", "{}"), stage("libdemo.so", "\u0000ELF")];
    const outPath = path.join(work, "demo.zip");
    const result = writeZip({ files, outPath, folder: null });
    expect(result.entries.sort()).toEqual(["libdemo.so", "manifest.json"]);
    const entries = unzip(outPath);
    expect(new TextDecoder().decode(entries["libdemo.so"])).toBe("\u0000ELF");
  });
});
