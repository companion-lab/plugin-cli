# companion-cli-cli

Scaffolds, builds, and packages companion plugins (JS frontend + Rust
backend) into a zip ready for the app's **Settings → Plugins → Import
plugin…** flow.

For build, the plugin dir must contain a `manifest.json`; see `app/PLUGINS.md`
for the plugin format. The zip contains only package files — `manifest.json`,
the bundled frontend entry, and the backend library. Sources, `node_modules/`,
and cargo `target/` never ship.

## Install

```bash
npm install -g companion-cli
```

Or run without installing: `npx companion-cli <command>`.

From source (inside a companion-tauri checkout):

```bash
cd plugin-cli
pnpm install        # standalone, not part of the app workspace
npm link            # or: pnpm link --global — exposes `companion-cli` on PATH
```

esbuild is also resolved from `app/node_modules` as a fallback, so the CLI
usually works from a checkout even without this install step.

## Usage

```bash
# Scaffold a new plugin project (frontend + backend):
companion-cli init my-plugin

# Build + zip for the app's plugin importer:
companion-cli build my-plugin
# -> my-plugin/dist/my-plugin-0.1.0.zip

# Or straight from a companion-tauri checkout (no install needed):
node plugin-cli/bin/companion-cli.mjs build my-plugin
```

The frontend is bundled with esbuild (React is aliased to the host's copies
via the SDK shims — never bundled). The Rust backend is built with
`cargo build --release` whenever `backend/` and `manifest.backend` both
exist; use `--no-backend` to skip it.

## Init

`companion-cli init <name>` scaffolds a new plugin project into
`./<name>/` — a React/TSX frontend (settings tab + section, one tool) and a
Rust cdylib backend answering `<id>.ping`, modeled on the bundled feature
plugins. The generated project builds immediately; `npm install` is only
needed for editor type-checking.

```bash
companion-cli init my-plugin
cd my-plugin
npm install
companion-cli build .   # -> dist/my-plugin-0.1.0.zip
```

### Init options

| Option | Meaning |
|---|---|
| `--description <text>` | Plugin description (default `<Name> plugin for companion.`). |
| `--no-backend` | Frontend-only: skip the Rust backend scaffold. |

`init` refuses to write into an existing non-empty directory, and `<name>`
must be a valid plugin id (lowercase letters, digits, `-`/`_`, no `__` — see
`app/PLUGINS.md`).

### Options

| Option | Meaning |
|---|---|
| `--out <dir>` | Directory for the zip (default `./dist`). |
| `--name <file>` | Zip filename (default `<id>-<version>.zip`). |
| `--flat` | Put `manifest.json` at the zip root instead of inside an `<id>/` folder. The importer accepts both layouts. |
| `--no-backend` | Skip the Rust build even if `backend/` exists. |
| `--no-frontend` | Skip the JS bundle (backend-only plugin). |
| `--sdk <dir>` | Path to the plugin JS SDK (default `<repo>/sdk/js/@companion/plugin`). |

### Zip layout

Default layout mirrors a manually-produced package — one top-level folder
named after the plugin id:

```
notes/
  manifest.json
  frontend.js
  libnotes_backend.dylib
```

`--flat` drops the folder. Zip entries use a fixed timestamp, so identical
inputs produce byte-identical archives.

## Dev builds

The unpacked dev flow used while iterating inside the repo is unchanged:

```bash
node app/scripts/build-plugin.mjs plugin-repos/companion-cli-alarms --backend --out plugins/alarms
```

That script is a thin wrapper over `plugin-cli/lib/build.mjs` — the same
build logic that powers this CLI.
