# companion-cli

Scaffolds, builds, and packages [companion](https://github.com/companion-lab)
plugins (JS frontend + Rust backend) into a zip ready for the app's
**Settings → Plugins → Import plugin…** flow.

For build, the plugin dir must contain a `manifest.json`; see the
[plugin format docs](https://github.com/companion-lab/companion-desktop/blob/main/PLUGINS.md)
for details. The zip contains only package files — `manifest.json`, the
bundled frontend entry, and the backend library. Sources, `node_modules/`,
and cargo `target/` never ship.

## Install

```bash
npm install -g companion-cli
```

Or run without installing: `npx companion-cli <command>`.

From source:

```bash
git clone https://github.com/companion-lab/plugin-cli
cd plugin-cli
pnpm install
npm link            # or: pnpm link --global — exposes `companion-cli` on PATH
```

## Usage

```bash
# Scaffold a new plugin project (frontend + backend):
companion-cli init my-plugin

# Build + zip for the app's plugin importer:
companion-cli build my-plugin
# -> my-plugin/dist/my-plugin-0.1.0.zip
```

The frontend is bundled with esbuild (React is aliased to the host's copies
via the bundled SDK shims — never bundled). The Rust backend is built with
`cargo build --release` whenever `backend/` and `manifest.backend` both
exist; use `--no-backend` to skip it.

## Init

`companion-cli init <name>` scaffolds a new plugin project into
`./<name>/` — a React/TSX frontend (settings tab + section, one tool) and a
Rust cdylib backend answering `<id>.ping`. The generated project builds
immediately; `npm install` is only needed for editor type-checking.

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
the [plugin format docs](https://github.com/companion-lab/companion-desktop/blob/main/PLUGINS.md)).

### Options

| Option | Meaning |
|---|---|
| `--out <dir>` | Directory for the zip (default `./dist`). |
| `--name <file>` | Zip filename (default `<id>-<version>.zip`). |
| `--flat` | Put `manifest.json` at the zip root instead of inside an `<id>/` folder. The importer accepts both layouts. |
| `--no-backend` | Skip the Rust build even if `backend/` exists. |
| `--no-frontend` | Skip the JS bundle (backend-only plugin). |
| `--sdk <dir>` | Path to the plugin JS SDK. Defaults to the SDK shims bundled with this package; inside a companion-tauri checkout, the repo's own `sdk/js/@companion/plugin` is used. |

### Zip layout

Default layout mirrors a manually-produced package — one top-level folder
named after the plugin id:

```
my-plugin/
  manifest.json
  frontend.js
  libmy_plugin_backend.dylib
```

`--flat` drops the folder. Zip entries use a fixed timestamp, so identical
inputs produce byte-identical archives.

## Links

- Repository: https://github.com/companion-lab/plugin-cli
- Plugin format & SDK guide: https://github.com/companion-lab/companion-desktop/blob/main/PLUGINS.md
- JS SDK: https://www.npmjs.com/package/@companion-lab/plugin
- Rust SDK: https://crates.io/crates/companion-plugin-sdk
