// Build tests: manifest validation, staging decisions (frontend/backend/
// assets), and a real esbuild bundle against the @companion-lab/plugin
// package shims. Rust builds (cargo spawn) are covered by the CI smoke
// workflow, not here.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildPlugin, BuildError, FRONTEND_SRC_CANDIDATES } from "../lib/build.mjs";

// The @companion-lab/plugin package — same target the build aliases to
// (mirrors the CLI's defaultSdkDir npm fallback).
const SDK_DIR = path.dirname(
  createRequire(import.meta.url).resolve("@companion-lab/plugin"),
);

let work;
let pluginDir;
let outDir;

beforeEach(() => {
  work = mkdtempSync(path.join(tmpdir(), "companion-cli-build-"));
  pluginDir = path.join(work, "plugin");
  outDir = path.join(work, "out");
  mkdirSync(pluginDir, { recursive: true });
  writeManifest({ id: "demo", version: "0.1.0" });
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

function writeManifest(manifest) {
  writeFileSync(path.join(pluginDir, "manifest.json"), JSON.stringify(manifest, null, 2));
}

// Frontend fixture that imports the SDK by its package specifier — the build
// must alias it (and react) to the SDK shims rather than fail resolution.
function writeFrontendSrc() {
  mkdirSync(path.join(pluginDir, "src"), { recursive: true });
  writeFileSync(
    path.join(pluginDir, "src", "index.js"),
    `import { definePlugin } from "@companion-lab/plugin";
export default definePlugin(() => {});
`,
  );
}

async function esbuildMod() {
  return import("esbuild");
}

describe("manifest validation", () => {
  it("rejects a missing manifest.json", async () => {
    rmSync(path.join(pluginDir, "manifest.json"));
    await expect(buildPlugin({ pluginDir, outDir })).rejects.toThrow(/no manifest\.json/);
  });

  it("rejects invalid JSON", async () => {
    writeFileSync(path.join(pluginDir, "manifest.json"), "{oops");
    await expect(buildPlugin({ pluginDir, outDir })).rejects.toThrow(BuildError);
    await expect(buildPlugin({ pluginDir, outDir })).rejects.toThrow(/not valid JSON/);
  });

  it("rejects a manifest without an id", async () => {
    writeManifest({ version: "1.0.0" });
    await expect(buildPlugin({ pluginDir, outDir })).rejects.toThrow(/missing "id"/);
  });
});

describe("staging decisions", () => {
  it("stages only the manifest when frontend and backend are off", async () => {
    const { manifest, files } = await buildPlugin({
      pluginDir,
      outDir,
      frontend: false,
      backend: false,
    });
    expect(manifest.id).toBe("demo");
    expect(files).toEqual(["manifest.json"]);
    expect(readFileSync(path.join(outDir, "manifest.json"), "utf8")).toContain('"demo"');
  });

  it("auto skips the frontend when none is declared or present", async () => {
    writeManifest({ id: "demo" }); // no frontend field
    const { files } = await buildPlugin({ pluginDir, outDir, backend: false });
    expect(files).toEqual(["manifest.json"]);
  });

  it("auto errors when frontend is declared but source is missing", async () => {
    writeManifest({ id: "demo", frontend: { entry: "frontend.js" } });
    await expect(buildPlugin({ pluginDir, outDir, backend: false })).rejects.toThrow(
      /no frontend source found/,
    );
  });

  it("errors when frontend: true without an esbuild module", async () => {
    writeFrontendSrc();
    await expect(
      buildPlugin({ pluginDir, outDir, frontend: true, backend: false }),
    ).rejects.toThrow(/no esbuild module was provided/);
  });

  it("errors when frontend: true without an SDK dir", async () => {
    writeFrontendSrc();
    const esbuild = await esbuildMod();
    await expect(
      buildPlugin({ pluginDir, outDir, frontend: true, backend: false, esbuild }),
    ).rejects.toThrow(/SDK not found/);
  });

  it("errors when manifest.backend is declared without a backend/ crate", async () => {
    writeManifest({ id: "demo", backend: { library: "libdemo.dylib" } });
    await expect(buildPlugin({ pluginDir, outDir, backend: "auto" })).rejects.toThrow(
      /no backend\/Cargo\.toml exists/,
    );
  });

  it("errors on backend: true without any backend", async () => {
    await expect(
      buildPlugin({ pluginDir, outDir, frontend: false, backend: true }),
    ).rejects.toThrow(/--backend requested but no backend\/ crate or manifest\.backend entry/);
  });

  it("auto skips the Rust build when the crate exists but manifest.backend is missing", async () => {
    writeManifest({ id: "demo" });
    mkdirSync(path.join(pluginDir, "backend"), { recursive: true });
    writeFileSync(path.join(pluginDir, "backend", "Cargo.toml"), '[package]\nname = "demo"\n');
    const log = vi.fn();
    const { files } = await buildPlugin({ pluginDir, outDir, frontend: false, backend: "auto", log });
    expect(files).toEqual(["manifest.json"]);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("manifest.backend not declared; skipping"),
    );
  });
});

describe("frontend bundling", () => {
  it("bundles src/index.js into frontend.js with SDK aliases", async () => {
    writeFrontendSrc();
    writeManifest({ id: "demo", frontend: { entry: "frontend.js" } });
    const { files } = await buildPlugin({
      pluginDir,
      outDir,
      backend: false,
      esbuild: await esbuildMod(),
      sdkDir: SDK_DIR,
    });
    expect(files).toEqual(["manifest.json", "frontend.js"]);
    const bundle = readFileSync(path.join(outDir, "frontend.js"), "utf8");
    // The SDK shim (definePlugin) was aliased and inlined, and the bundle
    // leaves no bare specifier behind — react comes from the host at runtime.
    expect(bundle).toContain("activate");
    expect(bundle).not.toContain("@companion-lab/plugin");
    expect(bundle).not.toMatch(/^\s*import\b/m);
  });

  it("honors a custom frontend entry name", async () => {
    writeFrontendSrc();
    writeManifest({ id: "demo", frontend: { entry: "ui.js" } });
    const { files } = await buildPlugin({
      pluginDir,
      outDir,
      backend: false,
      esbuild: await esbuildMod(),
      sdkDir: SDK_DIR,
    });
    expect(files).toContain("ui.js");
    expect(files).not.toContain("frontend.js");
  });

  it("picks the first existing source candidate", () => {
    // FRONTEND_SRC_CANDIDATES order is tsx > ts > jsx > js.
    expect(FRONTEND_SRC_CANDIDATES).toEqual([
      "src/index.tsx",
      "src/index.ts",
      "src/index.jsx",
      "src/index.js",
    ]);
  });
});

describe("assets", () => {
  it("copies assets/ and stages every file individually", async () => {
    mkdirSync(path.join(pluginDir, "assets", "models"), { recursive: true });
    writeFileSync(path.join(pluginDir, "assets", "readme.txt"), "hi");
    writeFileSync(path.join(pluginDir, "assets", "models", "a.bin"), "\u0000bin");
    const { files } = await buildPlugin({ pluginDir, outDir, frontend: false, backend: false });
    // Every asset is its own staged path (the zip step reads each one).
    expect(files.slice(1).sort()).toEqual(["assets/models/a.bin", "assets/readme.txt"]);
    expect(readFileSync(path.join(outDir, "assets", "models", "a.bin"), "utf8")).toContain("bin");
  });

  it("skips assets when manifest.assets is false", async () => {
    writeManifest({ id: "demo", assets: false });
    mkdirSync(path.join(pluginDir, "assets"), { recursive: true });
    writeFileSync(path.join(pluginDir, "assets", "big.bin"), "x");
    const log = vi.fn();
    const { files } = await buildPlugin({
      pluginDir,
      outDir,
      frontend: false,
      backend: false,
      log,
    });
    expect(files).toEqual(["manifest.json"]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("manifest.assets=false"));
  });
});
