import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Bundle the Electron main + preload (web-dashboard). The `@motionreal/*` workspace
 * packages are source-only (no built dist), so we ALIAS them to their `src`
 * entry and let esbuild inline the first-party graph; everything in node_modules
 * (electron, react, remotion, etc.) stays external and resolves at runtime.
 */
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const pkg = (name) => resolve(repo, "packages", name, "src", "index.ts");

// A production build minifies and ships NO sourcemap, so the distributed
// `app.asar` doesn't carry readable gateway/orchestrator/admission logic an
// attacker can lift verbatim. A dev build keeps sourcemaps + readable output for
// debugging. Gate on either `--prod` or NODE_ENV=production.
const isProd = process.argv.includes("--prod") || process.env.NODE_ENV === "production";

const alias = {
  "@motionreal/schema": pkg("schema"),
  "@motionreal/theme": pkg("theme"),
  "@motionreal/blocks": pkg("blocks"),
  "@motionreal/tts": pkg("tts"),
  "@motionreal/compositions": pkg("compositions"),
  "@motionreal/pipeline": pkg("pipeline"),
};

const common = {
  bundle: true,
  platform: "node",
  // Electron 33 ships Node 20; node22 is the closest supported esbuild target
  // that lets esbuild keep modern syntax instead of down-leveling unnecessarily.
  target: "node22",
  packages: "external", // keep node_modules deps external
  alias,
  // Prod: minify + NO sourcemap (smaller bundle, no readable source in app.asar).
  // Dev: keep sourcemaps + readable output so a stack trace points at real lines.
  minify: isProd,
  sourcemap: !isProd,
  legalComments: "none",
  logLevel: "info",
};

// Main: ESM (uses import.meta.url). Shim require for any bundled CJS deps.
await build({
  ...common,
  format: "esm",
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  entryPoints: [resolve(here, "src/main/index.ts")],
  outfile: resolve(here, "dist-electron/main/index.js"),
});

// Preload: CommonJS — Electron's contextIsolated preload must be CJS, not ESM.
await build({
  ...common,
  format: "cjs",
  entryPoints: [resolve(here, "src/preload/index.ts")],
  outfile: resolve(here, "dist-electron/preload/index.cjs"),
});

// MotionReal-owned Harness extension. First-party imports are bundled so the
// fork can load the same small plugin without vendoring or patching Harness.
await build({
  ...common,
  format: "esm",
  entryPoints: [resolve(here, "src/harness/motionreal-submission-tools.ts")],
  outfile: resolve(here, "dist-electron/harness/motionreal-submission-tools.mjs"),
});

console.log("[build-electron] main + preload + Harness tools bundled → dist-electron/");
