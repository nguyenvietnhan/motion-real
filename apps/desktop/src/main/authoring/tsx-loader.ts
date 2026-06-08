import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Runtime loader for the authored-scene registration handshake (reconcile/desktop).
 *
 * The admission handshake imports each authored `.tsx` to verify it registers a
 * component. Under `npx tsx` (the build-script path) Node's tsx loader handles
 * `.tsx`, but the bundled Electron main is plain Node ESM with NO `.tsx` loader
 * → `import()` throws "Unknown file extension .tsx". This loader bundles the
 * authored module (aliasing the `@news/*` workspace packages to their `src`, the
 * SAME way build-electron.mjs does) into a self-contained ESM data URL and
 * imports that. The handshake's existing "mirror the default export into the
 * registry" path reconciles the bundle's own `@news/compositions` instance with
 * the app's, so the component still ends up registered once.
 */

// At runtime this file is bundled into apps/desktop/dist-electron/main/index.js,
// so import.meta.url resolves under dist-electron/main → repo root is up four.
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../..");
const pkg = (name: string): string => resolve(repo, "packages", name, "src", "index.ts");

const alias: Record<string, string> = {
  "@news/schema": pkg("schema"),
  "@news/design": pkg("design"),
  "@news/blocks": pkg("blocks"),
  "@news/tts": pkg("tts"),
  "@news/compositions": pkg("compositions"),
  "@news/pipeline": pkg("pipeline"),
};

/** Bundle an authored `.tsx` (given as a file:// URL) and import it as ESM. */
export async function loadAuthoredTsx(fileUrl: string): Promise<unknown> {
  // Lazy-import esbuild so it never enters the (heavy) test/module graph until
  // an actual authoring run needs it.
  const { build } = await import("esbuild");
  const entry = fileURLToPath(fileUrl);
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node18",
    jsx: "automatic",
    alias,
    write: false,
    logLevel: "silent",
  });
  const code = result.outputFiles[0]?.text ?? "";
  const url = `data:text/javascript;base64,${Buffer.from(code, "utf8").toString("base64")}`;
  return import(url);
}
