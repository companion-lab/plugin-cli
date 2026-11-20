// CLI-level tests: spawn bin/companion-cli.mjs as a real process. parseArgs
// is internal, so behavior is exercised through the public surface the same
// way CI's smoke workflow does.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BIN = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "bin",
  "companion-cli.mjs",
);

let work;

beforeEach(() => {
  work = mkdtempSync(path.join(tmpdir(), "companion-cli-bin-"));
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

function run(args, cwd = work) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8" });
}

describe("help and argument errors", () => {
  it("--help prints usage and exits 0", () => {
    const r = run(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("usage: companion-cli");
    expect(r.stdout).toContain("init <name>");
  });

  it("no arguments prints usage and exits 1", () => {
    const r = run([]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("usage: companion-cli");
  });

  it("unknown option exits 1 with an error: line (no stack)", () => {
    const r = run(["build", ".", "--bogus"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("error: unknown option: --bogus");
    expect(r.stderr).not.toContain("at ");
  });

  it("a value-taking option at the end reports the missing value", () => {
    const r = run(["--out"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("error: --out expects a value");
  });
});

describe("init", () => {
  it("scaffolds a frontend-only project in the cwd", () => {
    const r = run(["init", "smoke", "--no-backend"]);
    expect(r.status).toBe(0, r.stderr);
    const dir = path.join(work, "smoke");
    expect(existsSync(path.join(dir, "manifest.json"))).toBe(true);
    expect(existsSync(path.join(dir, "src", "index.tsx"))).toBe(true);
    expect(existsSync(path.join(dir, "backend"))).toBe(false);
    expect(r.stdout).toContain("scaffolded");
  });

  it("rejects an invalid id with an error: line", () => {
    const r = run(["init", "Bad__Id"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("error: invalid plugin id");
    expect(readdirSync(work)).toEqual([]); // nothing written
  });
});

describe("build + zip", () => {
  it("builds a scaffolded frontend-only plugin into dist/<id>-<version>.zip", () => {
    const init = run(["init", "smoke", "--no-backend"]);
    expect(init.status).toBe(0, init.stderr);

    const r = run(["build", path.join(work, "smoke")]);
    expect(r.status).toBe(0, r.stderr);

    const zip = path.join(work, "dist", "smoke-0.1.0.zip");
    expect(existsSync(zip)).toBe(true);
    // The path is printed relative to the cwd when it stays inside it.
    expect(r.stdout).toContain("dist/smoke-0.1.0.zip");
    // Folder layout: entries live under smoke/.
    expect(r.stdout).toContain("smoke/manifest.json");
    expect(r.stdout).toContain("smoke/frontend.js");
  });

  it("errors on a directory without manifest.json", () => {
    const r = run(["build", work]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("error: no manifest.json");
  });

  it("honors --out and --name", () => {
    const init = run(["init", "smoke", "--no-backend"]);
    expect(init.status).toBe(0, init.stderr);
    const r = run([
      "build",
      path.join(work, "smoke"),
      "--out",
      path.join(work, "custom"),
      "--name",
      "renamed.zip",
    ]);
    expect(r.status).toBe(0, r.stderr);
    expect(existsSync(path.join(work, "custom", "renamed.zip"))).toBe(true);
  });
});
