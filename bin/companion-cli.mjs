#!/usr/bin/env node
// companion-cli — scaffold, build, and package companion plugins
// (JS frontend + Rust backend).
//
//   companion-cli init <name>     scaffold a new plugin project
//   companion-cli [build] <dir>   build + zip for the app's plugin importer
//
// For build, the plugin dir must contain manifest.json. The zip contains only
// the package files (manifest.json, bundled frontend entry, backend library) —
// sources and build junk never ship.

import { createRequire } from "node:module";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlugin, BuildError } from "../lib/build.mjs";
import { parsePluginId, scaffoldPlugin } from "../lib/scaffold.mjs";
import { writeZip, formatBytes } from "../lib/zip.mjs";

const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(cliRoot, "..");

const USAGE = `usage: companion-cli <command> [args] [options]

commands:
  init <name>      scaffold a new plugin project (React frontend + Rust
                   backend) into ./<name>/; ready to build immediately
  build <dir>      build a plugin's JS frontend (esbuild) and Rust backend
                   (cargo), then zip the package for import via the app's
                   Settings -> Plugins -> Import plugin...
                   (the subcommand token is optional: 'companion-cli <dir>'
                   also builds)

init options:
  --description <text>  plugin description (default: "<Name> plugin for companion.")
  --no-backend          frontend-only: skip the Rust backend scaffold

build options:
  --out <dir>      directory for the zip (default: ./dist)
  --name <file>    zip filename (default: <id>-<version>.zip)
  --flat           manifest.json at the zip root instead of an <id>/ folder
                   (the importer accepts both layouts)
  --no-backend     skip the Rust build even if backend/ exists
  --no-frontend    skip the JS bundle (backend-only plugin)
  --sdk <dir>      path to the plugin JS SDK
                   (default: <repo>/sdk/js/@companion/plugin)
  -h, --help       show this help

examples:
  companion-cli init my-plugin
  companion-cli init notes --no-backend
  companion-cli build my-plugin
  companion-cli my-plugin --out ~/Desktop
`;

function parseArgs(argv) {
  const positional = [];
  const opts = { flat: false, backend: "auto", frontend: "auto" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      if (i + 1 >= argv.length) throw new BuildError(`${arg} expects a value`);
      return argv[++i];
    };
    switch (arg) {
      case "--out":
        opts.out = value();
        break;
      case "--name":
        opts.name = value();
        break;
      case "--description":
        opts.description = value();
        break;
      case "--sdk":
        opts.sdk = value();
        break;
      case "--flat":
        opts.flat = true;
        break;
      case "--no-backend":
        opts.backend = false;
        break;
      case "--no-frontend":
        opts.frontend = false;
        break;
      case "-h":
      case "--help":
        opts.help = true;
        break;
      default:
        if (arg.startsWith("-")) throw new BuildError(`unknown option: ${arg}`);
        positional.push(arg);
    }
  }
  return { positional, opts };
}

async function loadEsbuild() {
  try {
    return await import("esbuild");
  } catch {
    // Fall back to the host app's copy so the CLI works before `pnpm install`
    // has ever run in plugin-cli/.
    const appEsbuild = path.join(repoRoot, "app", "node_modules", "esbuild");
    if (existsSync(appEsbuild)) {
      return createRequire(import.meta.url)(appEsbuild);
    }
    throw new BuildError(
      `esbuild not found (looked in ${cliRoot}/node_modules and ${appEsbuild}); run pnpm install in plugin-cli/`,
    );
  }
}

function defaultSdkDir() {
  // Inside a companion-tauri checkout, build against the repo's live SDK;
  // otherwise use the SDK shims bundled with this package (npm installs).
  const checkoutSdk = path.join(repoRoot, "sdk", "js", "@companion", "plugin");
  if (existsSync(path.join(checkoutSdk, "index.ts"))) return checkoutSdk;
  return path.join(cliRoot, "sdk", "js", "@companion", "plugin");
}

async function runInit(rest, opts) {
  const id = parsePluginId(rest[0]);
  const targetDir = path.resolve(id);
  const { files } = scaffoldPlugin({
    targetDir,
    id,
    description: opts.description,
    backend: opts.backend !== false,
    log: (rel) => console.log(`[init]   ${rel}`),
  });
  console.log(`[init] ${id}: scaffolded ${files.length} files in ./${id}/`);
  console.log("\nnext steps:");
  console.log(`  cd ${id}`);
  console.log("  npm install");
  console.log(`  companion-cli build .   # -> dist/${id}-0.1.0.zip`);
}

async function main() {
  const { positional, opts } = parseArgs(process.argv.slice(2));
  if (opts.help || positional.length === 0) {
    console.log(USAGE);
    process.exit(opts.help ? 0 : 1);
  }
  const [maybeSubcommand, ...rest] = positional;
  if (maybeSubcommand === "init" || maybeSubcommand === "new") {
    await runInit(rest, opts);
    return;
  }
  const pluginDirArg = maybeSubcommand === "build" ? rest[0] : maybeSubcommand;
  if (!pluginDirArg) {
    console.error("error: no plugin directory given\n");
    console.log(USAGE);
    process.exit(1);
  }

  const pluginDir = path.resolve(pluginDirArg);
  if (!existsSync(path.join(pluginDir, "manifest.json"))) {
    throw new BuildError(`no manifest.json in ${pluginDir}`);
  }

  const esbuild = await loadEsbuild();
  const sdkDir = opts.sdk ? path.resolve(opts.sdk) : defaultSdkDir();

  const staging = mkdtempSync(path.join(tmpdir(), "companion-cli-"));
  let zipResult;
  try {
    const { manifest, files } = await buildPlugin({
      pluginDir,
      outDir: staging,
      frontend: opts.frontend,
      backend: opts.backend,
      esbuild,
      sdkDir,
      // Staging lives in a temp dir; drop its prefix from log lines.
      log: (msg) => console.log(msg.split(`${staging}/`).join("")),
    });

    const zipName =
      opts.name ?? `${manifest.id}-${manifest.version ?? "0.0.0"}.zip`;
    const outPath = path.resolve(opts.out ?? "dist", zipName);
    zipResult = writeZip({
      files: files.map((name) => ({ from: path.join(staging, name), name })),
      outPath,
      folder: opts.flat ? null : manifest.id,
    });
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }

  const relToCwd = path.relative(process.cwd(), zipResult.outPath);
  const shown = relToCwd && !relToCwd.startsWith("..") ? relToCwd : zipResult.outPath;
  console.log(`[plugin] ${shown} written (${formatBytes(zipResult.bytes)})`);
  for (const entry of zipResult.entries) console.log(`  ${entry}`);
}

main().catch((err) => {
  if (err instanceof BuildError) {
    console.error(`error: ${err.message}`);
  } else {
    console.error(err?.stack ?? err);
  }
  process.exit(1);
});
