// Scaffold tests: id validation rules per app/PLUGINS.md, generated project
// layout, and the derived names (display name, Rust struct, crate/lib names).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { BuildError } from "../lib/build.mjs";
import { parsePluginId, scaffoldPlugin } from "../lib/scaffold.mjs";

let work;

beforeEach(() => {
  work = mkdtempSync(path.join(tmpdir(), "companion-cli-scaffold-"));
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

function readJoined(dir, rel) {
  return JSON.parse(readFileSync(path.join(dir, rel), "utf8"));
}

describe("parsePluginId", () => {
  it("accepts lowercase alnum ids with - and _", () => {
    expect(parsePluginId("my-plugin")).toBe("my-plugin");
    expect(parsePluginId("voice_2")).toBe("voice_2");
    expect(parsePluginId("  spaced  ")).toBe("spaced");
    expect(parsePluginId("9lives")).toBe("9lives");
  });

  it("throws without a name", () => {
    expect(() => parsePluginId(undefined)).toThrow(BuildError);
    expect(() => parsePluginId("")).toThrow(/no plugin name given/);
    expect(() => parsePluginId("   ")).toThrow(BuildError);
  });

  it("rejects uppercase, symbols, and leading separators", () => {
    expect(() => parsePluginId("My-Plugin")).toThrow(/invalid plugin id/);
    expect(() => parsePluginId("my plugin")).toThrow(BuildError);
    expect(() => parsePluginId("-lead")).toThrow(BuildError);
    expect(() => parsePluginId("_lead")).toThrow(BuildError);
    expect(() => parsePluginId("dot.name")).toThrow(BuildError);
  });

  it("rejects double underscores in any position", () => {
    expect(() => parsePluginId("a__b")).toThrow(/no "__"/);
    expect(() => parsePluginId("__lead")).toThrow(BuildError);
  });
});

describe("scaffoldPlugin", () => {
  it("creates a full backend project", () => {
    const target = path.join(work, "demo");
    const { dir, files } = scaffoldPlugin({ targetDir: target, id: "demo" });

    expect(dir).toBe(path.resolve(target));
    expect(files).toEqual([
      "manifest.json",
      "package.json",
      "tsconfig.json",
      ".gitignore",
      "README.md",
      "src/index.tsx",
      "backend/Cargo.toml",
      "backend/src/lib.rs",
    ]);
    for (const rel of files) {
      expect(existsSync(path.join(target, rel)), rel).toBe(true);
    }
  });

  it("omits backend files with backend: false", () => {
    const { files } = scaffoldPlugin({
      targetDir: path.join(work, "demo"),
      id: "demo",
      backend: false,
    });
    expect(files).not.toContain("backend/Cargo.toml");
    expect(files).not.toContain("backend/src/lib.rs");
    expect(existsSync(path.join(work, "demo", "backend"))).toBe(false);
  });

  it("manifest carries the id, derived name, and backend library name", () => {
    const dir = scaffoldPlugin({
      targetDir: path.join(work, "my-voice"),
      id: "my-voice",
    }).dir;
    const manifest = readJoined(dir, "manifest.json");
    expect(manifest.id).toBe("my-voice");
    expect(manifest.name).toBe("My Voice");
    expect(manifest.frontend).toEqual({ entry: "frontend.js" });
    expect(manifest.backend).toEqual({ library: "libmy_voice_backend.dylib" });
    expect(manifest.abi).toBe(3);
  });

  it("derives Rust names from the id (dashes to underscores)", () => {
    const dir = scaffoldPlugin({
      targetDir: path.join(work, "cool-thing_x"),
      id: "cool-thing_x",
    }).dir;
    const cargo = readFileSync(path.join(dir, "backend/Cargo.toml"), "utf8");
    expect(cargo).toContain('name = "cool-thing_x-backend"');
    expect(cargo).toContain('name = "cool_thing_x_backend"');
    const backend = readFileSync(path.join(dir, "backend/src/lib.rs"), "utf8");
    expect(backend).toContain("pub struct CoolThingX {");
    expect(backend).toContain('export_plugin!(CoolThingX::new());');
    expect(backend).toContain('"cool-thing_x.ping"');
  });

  it("uses the given description, else a derived default", () => {
    const a = scaffoldPlugin({
      targetDir: path.join(work, "a"),
      id: "a",
      description: "  Custom words here  ",
    }).dir;
    expect(readJoined(a, "manifest.json").description).toBe("Custom words here");

    const b = scaffoldPlugin({ targetDir: path.join(work, "b"), id: "b" }).dir;
    expect(readJoined(b, "manifest.json").description).toBe(
      "B plugin for companion.",
    );
  });

  it("generated package.json matches the id and build script", () => {
    const dir = scaffoldPlugin({
      targetDir: path.join(work, "demo"),
      id: "demo",
    }).dir;
    const pkg = readJoined(dir, "package.json");
    expect(pkg.name).toBe("companion-plugin-demo");
    expect(pkg.scripts.build).toBe("companion-cli build");
  });

  it("refuses to scaffold into a non-empty directory", () => {
    const target = path.join(work, "full");
    mkdirSync(target, { recursive: true });
    writeFileSync(path.join(target, "keep.txt"), "user data");
    expect(() => scaffoldPlugin({ targetDir: target, id: "demo" })).toThrow(
      /refusing to scaffold into non-empty directory/,
    );
  });

  it("scaffolds into an existing empty directory", () => {
    const target = path.join(work, "empty");
    mkdirSync(target, { recursive: true });
    const { files } = scaffoldPlugin({ targetDir: target, id: "demo" });
    expect(files).toHaveLength(8);
  });

  it("rejects an invalid id before writing anything", () => {
    const target = path.join(work, "never");
    expect(() => scaffoldPlugin({ targetDir: target, id: "BAD ID" })).toThrow(
      BuildError,
    );
    expect(existsSync(target)).toBe(false);
  });
});
