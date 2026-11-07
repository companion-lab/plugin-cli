// Scaffold a new companion plugin project (JS frontend + optional Rust backend).
//
//   companion-cli init <name> [options]
//
// Generates a minimal but complete plugin modeled on the bundled feature
// plugins (`plugin-repos/*`): a React/TSX frontend registering a settings
// tab and section, plus a Rust cdylib backend answering `<id>.ping` (an
// internal liveness check the settings section calls — deliberately NOT
// registered as a chat tool; register real tools in `ctx.tools` / `tools()`
// only when the chat model should call them). The generated project builds
// immediately with `companion-cli build <dir>` — the build aliases the SDK
// specifiers, so `npm install` is only needed for editor type-checking.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BuildError } from "./build.mjs";

/** Validate a plugin id per app/PLUGINS.md: lowercase alnum plus `-`/`_`, no `__`. */
export function parsePluginId(raw) {
  const id = String(raw ?? "").trim();
  if (!id) {
    throw new BuildError("no plugin name given: companion-cli init <name>");
  }
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(id) || id.includes("__")) {
    throw new BuildError(
      `invalid plugin id "${id}": use lowercase letters, digits, "-" or "_" (no "__")`,
    );
  }
  return id;
}

/** `my-plugin` -> `My Plugin` */
function displayName(id) {
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

/** `my-plugin` -> `MyPlugin` */
function structName(id) {
  return displayName(id).replaceAll(" ", "");
}

/**
 * Scaffold a plugin project into `targetDir`.
 *
 * @param {{
 *   targetDir: string,
 *   id: string,
 *   description?: string,
 *   backend?: boolean,
 *   log?: (msg: string) => void,
 * }} options
 * @returns {{ dir: string, files: string[] }} created directory and relative file paths
 */
export function scaffoldPlugin({
  targetDir,
  id,
  description,
  backend = true,
  log = () => {},
}) {
  id = parsePluginId(id);
  const root = path.resolve(targetDir);
  if (existsSync(root) && readdirSync(root).length > 0) {
    throw new BuildError(`refusing to scaffold into non-empty directory: ${root}`);
  }

  const vars = {
    id,
    name: displayName(id),
    description: description?.trim() || `${displayName(id)} plugin for companion.`,
    crateName: `${id}-backend`,
    libName: `${id.replaceAll("-", "_")}_backend`,
    structName: structName(id),
  };

  /** @type {[string, string][]} */
  const files = [
    ["manifest.json", manifestTemplate(vars, backend)],
    ["package.json", packageTemplate(vars)],
    ["tsconfig.json", tsconfigTemplate],
    [".gitignore", gitignoreTemplate],
    ["README.md", readmeTemplate(vars, backend)],
    ["src/index.tsx", frontendTemplate(vars)],
  ];
  if (backend) {
    files.push(
      ["backend/Cargo.toml", cargoTemplate(vars)],
      ["backend/src/lib.rs", backendTemplate(vars)],
    );
  }

  mkdirSync(root, { recursive: true });
  for (const [rel, content] of files) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    log(rel);
  }
  return { dir: root, files: files.map(([rel]) => rel) };
}

function manifestTemplate(vars, backend) {
  const manifest = {
    id: vars.id,
    name: vars.name,
    version: "0.1.0",
    description: vars.description,
    abi: 2,
    permissions: ["storage", "events", "tools"],
    frontend: { entry: "frontend.js" },
  };
  if (backend) {
    manifest.backend = { library: `lib${vars.libName}.dylib` };
  }
  return JSON.stringify(manifest, null, 2) + "\n";
}

function packageTemplate(vars) {
  return `${JSON.stringify(
    {
      name: `companion-plugin-${vars.id}`,
      version: "0.1.0",
      private: true,
      description: vars.description,
      dependencies: {
        "@companion-lab/plugin": "^0.1.0",
      },
      devDependencies: {
        "@types/react": "^18.3.12",
      },
    },
    null,
    2,
  )}\n`;
}

// Editor-only config — the CLI bundles with esbuild, which resolves the SDK
// and host React through its own aliases, not through this file.
const tsconfigTemplate = `{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
`;

const gitignoreTemplate = `# Build outputs
node_modules/
target/
dist/
frontend.js

# macOS
.DS_Store
`;

function readmeTemplate(vars, backend) {
  const backendSection = backend
    ? `- \`backend/\` — Rust backend compiled to a cdylib (answers \`${vars.id}.ping\`)
`
    : "";
  return `# ${vars.name}

${vars.description}

## Layout

- \`manifest.json\` — plugin manifest (id, permissions, build entries)
- \`src/\` — JS frontend (React), bundled to \`frontend.js\`
${backendSection}
## Build

\`\`\`sh
npm install
companion-cli build .
\`\`\`

This writes \`dist/${vars.id}-0.1.0.zip\`. Import it in the app via
**Settings → Plugins → Import plugin…**. \`npm install\` is only needed for
editor type-checking; the build itself resolves the SDK and React itself.
`;
}

function frontendTemplate(vars) {
  return `import { definePlugin } from "@companion-lab/plugin";
import { useEffect, useState } from "react"; // aliased to the host's React at build time

type PingReply = { pong: boolean };

export default definePlugin((ctx) => {
  ctx.log.info("activating ${vars.id} plugin");

  ctx.settings.registerTab({
    id: "${vars.id}",
    label: "${vars.name}",
    group: "Plugins",
    desc: ${JSON.stringify(vars.description)},
  });

  ctx.settings.registerSection({
    id: "${vars.id}.status",
    tabId: "${vars.id}",
    slot: "top",
    order: 100,
    component: function ${vars.structName}Status() {
      const [status, setStatus] = useState("checking…");
      useEffect(() => {
        ctx.backend
          .call<PingReply>("${vars.id}.ping")
          .then(() => setStatus("backend reachable"))
          .catch((err) => setStatus("backend error: " + err));
      }, []);
      return <p>${vars.id}: {status}</p>;
    },
  });
});
`;
}

function cargoTemplate(vars) {
  return `[package]
name = "${vars.crateName}"
version = "0.1.0"
description = ${JSON.stringify(`${vars.name} backend for companion`)}
license = "MIT"
edition = "2021"

[lib]
name = "${vars.libName}"
crate-type = ["cdylib"]

[dependencies]
companion-plugin-sdk = "0.1"
serde_json = "1"

[profile.release]
strip = true
`;
}

function backendTemplate(vars) {
  return `//! ${vars.name} backend for companion.

use companion_plugin_sdk::{export_plugin, Plugin, PluginCtx};
use serde_json::{json, Value};

/// Backend state. Add fields here as the plugin grows; keep the ctx to emit
/// events or log outside \`init\`.
pub struct ${vars.structName} {
    ctx: Option<PluginCtx>,
}

impl Default for ${vars.structName} {
    fn default() -> Self {
        Self::new()
    }
}

impl ${vars.structName} {
    pub fn new() -> Self {
        ${vars.structName} { ctx: None }
    }
}

impl Plugin for ${vars.structName} {
    fn init(&mut self, ctx: PluginCtx) -> Result<(), String> {
        ctx.info("${vars.id} ready");
        self.ctx = Some(ctx);
        Ok(())
    }

    fn handle(&mut self, method: &str, _payload: Value) -> Result<Value, String> {
        match method {
            // Internal liveness check, called by the settings section above —
            // not a chat tool. Register chat-facing tools by overriding
            // \`Plugin::tools\` (backend) or \`ctx.tools.register\` (frontend)
            // with tools the model should actually call.
            "${vars.id}.ping" => Ok(json!({ "pong": true })),
            _ => Err(format!("unknown method: {method}")),
        }
    }
}

export_plugin!(${vars.structName}::new());
`;
}
