import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Bundle the Electron main + preload (web-dashboard). The `@news/*` workspace
 * packages are source-only (no built dist), so we ALIAS them to their `src`
 * entry and let esbuild inline the first-party graph; everything in node_modules
 * (electron, react, remotion, etc.) stays external and resolves at runtime.
 */
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const pkg = (name) => resolve(repo, "packages", name, "src", "index.ts");

const alias = {
  "@news/schema": pkg("schema"),
  "@news/design": pkg("design"),
  "@news/blocks": pkg("blocks"),
  "@news/tts": pkg("tts"),
  "@news/compositions": pkg("compositions"),
  "@news/pipeline": pkg("pipeline"),
  "@news/mcp": pkg("mcp"),
};

const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  packages: "external", // keep node_modules deps external
  alias,
  sourcemap: true,
  logLevel: "info",
  // ESM interop for bundled CJS deps that use __dirname etc.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
};

await build({
  ...common,
  entryPoints: [resolve(here, "src/main/index.ts")],
  outfile: resolve(here, "dist-electron/main/index.js"),
});

await build({
  ...common,
  entryPoints: [resolve(here, "src/preload/index.ts")],
  outfile: resolve(here, "dist-electron/preload/index.js"),
});

console.log("[build-electron] main + preload bundled → dist-electron/");
