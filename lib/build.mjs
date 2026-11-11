// Shared companion plugin build logic.
//
// Builds a plugin package directory into `outDir`:
// - bundles `src/index.{tsx,ts,jsx,js}` into the manifest's frontend entry
//   (default frontend.js) with esbuild, aliasing react/@companion/plugin to
//   the host SDK shims so the plugin never bundles its own React;
// - with backend enabled, runs `cargo build --release` in `backend/` and
//   copies the produced cdylib under the manifest's backend.library name;
// - copies manifest.json.
//
// Used by both `plugin-cli/bin/companion-cli.mjs` (build + zip) and the dev
// wrapper `app/scripts/build-plugin.mjs` (unpacked, for `plugins/` discovery).

import { existsSync, readFileSync, copyFileSync, mkdirSync, writeFileSync, cpSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

export const FRONTEND_SRC_CANDIDATES = [
  "src/index.tsx",
  "src/index.ts",
  "src/index.jsx",
  "src/index.js",
];

/** Error with a user-facing message; the CLI prints it without a stack. */
export class BuildError extends Error {}

/**
 * Build a plugin package.
 *
 * @param {object} opts
 * @param {string} opts.pluginDir   Plugin source dir containing manifest.json.
 * @param {string} opts.outDir      Dir the package is assembled into (created).
 * @param {"auto"|boolean} [opts.frontend]
 *   "auto": bundle when manifest.frontend is declared (error if its source is
 *   missing), skip for frontend-less plugins. true: always bundle (dev wrapper
 *   behavior). false: never bundle.
 * @param {"auto"|boolean} [opts.backend]
 *   "auto": build when backend/ + manifest.backend both exist (error if one is
 *   missing while the other is present). true: require both. false: never build.
 * @param {object} [opts.esbuild]   Pre-loaded esbuild module (required to bundle).
 * @param {string} [opts.sdkDir]    Path to sdk/js/@companion/plugin (required to bundle).
 * @param {(msg: string) => void} [opts.log]
 * @returns {Promise<{ manifest: object, files: string[] }>} staged files, relative to outDir.
 */
export async function buildPlugin({
  pluginDir,
  outDir,
  frontend = "auto",
  backend = "auto",
  esbuild = null,
  sdkDir = null,
  log = defaultLog,
}) {
  pluginDir = path.resolve(pluginDir);
  outDir = path.resolve(outDir);

  const manifestPath = path.join(pluginDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new BuildError(`no manifest.json in ${pluginDir}`);
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    throw new BuildError(`manifest.json is not valid JSON: ${e.message}`);
  }
  if (!manifest.id) throw new BuildError("manifest.json is missing \"id\"");

  mkdirSync(outDir, { recursive: true });
  copyFileSync(manifestPath, path.join(outDir, "manifest.json"));
  const files = ["manifest.json"];

  const staged = (name) => {
    files.push(name);
    log(`[plugin] ${manifest.id}: staged ${name}`);
  };

  if (await buildFrontend({ manifest, pluginDir, outDir, frontend, esbuild, sdkDir, log })) {
    staged(frontendEntryName(manifest));
  }
  if (buildBackend({ manifest, pluginDir, outDir, backend, log })) {
    staged(manifest.backend.library);
  }

  // Copy bundled assets/ (if present) so plugins ship their own models/libs.
  // Each file is staged as its own relative path (not the directory itself) so
  // the zip step can read every entry. Plugins that keep heavyweight runtime
  // data (e.g. GB-scale models fetched into the data dir by their setup
  // script) out of the package opt out with "assets": false in manifest.json.
  const assetsDir = path.join(pluginDir, "assets");
  if (existsSync(assetsDir)) {
    if (manifest.assets === false) {
      log(`[plugin] ${manifest.id}: assets/ present but manifest.assets=false; not bundling`);
    } else {
      cpSync(assetsDir, path.join(outDir, "assets"), { recursive: true });
      const assetFiles = walkFiles(path.join(outDir, "assets"));
      for (const file of assetFiles) files.push(path.relative(outDir, file));
      log(`[plugin] ${manifest.id}: staged assets (${assetFiles.length} files)`);
    }
  }

  return { manifest, files };
}

function frontendEntryName(manifest) {
  return manifest.frontend?.entry ?? "frontend.js";
}

async function buildFrontend({ manifest, pluginDir, outDir, frontend, esbuild, sdkDir, log }) {
  const srcEntry = FRONTEND_SRC_CANDIDATES.map((p) => path.join(pluginDir, p)).find(existsSync);
  const wantsFrontend =
    frontend === true ||
    (frontend === "auto" && (manifest.frontend != null || srcEntry != null));
  if (!wantsFrontend) return false;
  if (!srcEntry) {
    throw new BuildError(
      `no frontend source found (looked for ${FRONTEND_SRC_CANDIDATES.join(", ")})`,
    );
  }
  if (!esbuild) throw new BuildError("frontend build requested but no esbuild module was provided");
  if (!sdkDir || !existsSync(path.join(sdkDir, "index.ts"))) {
    throw new BuildError(
      `frontend build requested but SDK not found at ${sdkDir} (pass --sdk <dir>)`,
    );
  }

  const entry = frontendEntryName(manifest);
  await esbuild.build({
    entryPoints: [srcEntry],
    bundle: true,
    format: "esm",
    target: ["chrome120", "safari17"],
    jsx: "automatic",
    minify: true,
    sourcemap: false,
    outfile: path.join(outDir, entry),
    // The bundle resolves react/react-dom from the HOST APP at runtime via the
    // @companion/plugin shims — the plugin never bundles its own React.
    // @companion-lab/plugin is the same SDK published as a package (used by
    // standalone plugin repos); alias it to the local shims too so those
    // repos build against exactly what the installed host provides.
    alias: {
      "@companion/plugin": path.join(sdkDir, "index.ts"),
      "@companion-lab/plugin": path.join(sdkDir, "index.ts"),
      react: path.join(sdkDir, "react.js"),
      "react/jsx-runtime": path.join(sdkDir, "jsx-runtime.js"),
      "react/jsx-dev-runtime": path.join(sdkDir, "jsx-runtime.js"),
      "react-dom": path.join(sdkDir, "react-dom.js"),
      "react-dom/client": path.join(sdkDir, "react-dom.js"),
    },
  });
  log(`[plugin] ${manifest.id}: bundled ${rel(srcEntry)} -> ${rel(path.join(outDir, entry))}`);
  return true;
}

function buildBackend({ manifest, pluginDir, outDir, backend, log }) {
  const backendDir = path.join(pluginDir, "backend");
  const hasCrate = existsSync(path.join(backendDir, "Cargo.toml"));
  const hasEntry = manifest.backend != null;

  let wantsBackend;
  if (backend === true) {
    if (!hasCrate || !hasEntry) {
      throw new BuildError("--backend requested but no backend/ crate or manifest.backend entry");
    }
    wantsBackend = true;
  } else if (backend === "auto") {
    if (hasEntry && !hasCrate) {
      throw new BuildError(
        `manifest.backend declares "${manifest.backend.library}" but no backend/Cargo.toml exists`,
      );
    }
    if (hasCrate && !hasEntry) {
      log(
        `[plugin] ${manifest.id}: backend/ crate found but manifest.backend not declared; skipping Rust build`,
      );
    }
    wantsBackend = hasCrate && hasEntry;
  } else {
    wantsBackend = false;
  }
  if (!wantsBackend) return false;

  execSync("cargo build --release", { cwd: backendDir, stdio: "inherit" });
  const crateName = backendCrateName(backendDir);
  const names = [
    `lib${crateName}.dylib`,
    `${crateName}.dll`,
    `lib${crateName}.so`,
  ];
  const produced = names.map((n) => path.join(backendDir, "target", "release", n)).find(existsSync);
  if (!produced) {
    throw new BuildError(`could not find built cdylib (looked for ${names.join(", ")})`);
  }
  // Platform-correct filename: cargo emits lib<crate>.dylib / .so / <crate>.dll.
  // Rewrite the manifest's backend.library to match so the host loads the
  // right file on every OS (instead of a hard-coded macOS name).
  const producedName = path.basename(produced);
  manifest.backend.library = producedName;
  copyFileSync(produced, path.join(outDir, producedName));
  // Re-stage manifest.json with the updated library field.
  writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  log(
    `[plugin] ${manifest.id}: backend copied -> ${rel(path.join(outDir, producedName))}`,
  );
  return true;
}

function backendCrateName(backendDir) {
  const toml = readFileSync(path.join(backendDir, "Cargo.toml"), "utf8");
  const m = toml.match(/^\s*name\s*=\s*"([^"]+)"/m);
  if (!m) throw new BuildError(`no package name in ${backendDir}/Cargo.toml`);
  return m[1].replaceAll("-", "_");
}

function defaultLog(msg) {
  console.log(msg);
}

/** Recursively list files under `dir` (absolute paths), skipping directories. */
function walkFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(p));
    else out.push(p);
  }
  return out;
}

function rel(p) {
  return path.relative(process.cwd(), p) || ".";
}
