// Aliased from "react/jsx-runtime" and "react/jsx-dev-runtime" when building
// a plugin (automatic JSX). React comes from the host via
// globalThis.__companion_host__.

const host = globalThis.__companion_host__;

if (!host || !host.React) {
  throw new Error(
    "companion plugin runtime not present: this bundle must be activated by the companion host, not loaded directly",
  );
}

const R = host.React;
// The host's real jsx-runtime (see host.ts): carries React's own jsx/jsxs,
// including the dev build's static-children handling — jsxs marks static
// children validated, so React only warns for genuinely keyless elements in
// dynamic (expression-bearing) children arrays. Older hosts without the
// export fall through to R.jsx/R.jsxs (React 19 main entry) or, last, a
// createElement wrapper — under the fallback React has no static-children
// concept, so dev builds warn for every keyless element in any multi-child
// JSX. Note jsxDEV forwards to the same 3-arg jsx (plugin bundles build with
// the production JSX transform; esbuild jsxDev output would lose the
// static-children flag here).
const JR = host.JsxRuntime ?? null;

const createElementWrapper =
  (type, props, key) =>
    R.createElement(type, key === undefined ? props : { ...props, key }, props?.children);

const jsxImpl =
  (JR && typeof JR.jsx === "function" && JR.jsx) ||
  (typeof R.jsx === "function" && R.jsx) ||
  createElementWrapper;
const jsxsImpl =
  (JR && typeof JR.jsxs === "function" && JR.jsxs) ||
  (typeof R.jsxs === "function" && R.jsxs) ||
  createElementWrapper;

export const jsx = jsxImpl;
export const jsxs = jsxsImpl;
export const jsxDEV = jsxImpl;
export const Fragment = R.Fragment;
