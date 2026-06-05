/**
 * Production build = a real Remotion webpack bundle of the app (Requirement
 * 12.4). This compiles and bundles the entire React/Remotion graph — the app
 * entry, the master composition, every registered scene component, and the
 * `@news/*` workspace sources reached through the shared alias override. If any
 * of that fails to type-resolve or compile under webpack, the bundle throws and
 * this script exits non-zero; on success it exits 0.
 *
 * Bundling is webpack-only: it never launches or downloads a browser. There is
 * deliberately no `ensureBrowser()` call here — that is only needed to *render*
 * frames, not to *bundle* them. So `npm run build` works fully offline with no
 * Chromium dependency.
 *
 * The override + entry helpers are reused from the renderer so the build and
 * the render path resolve workspace modules identically.
 */
import { rm } from "node:fs/promises";
import { bundle } from "@remotion/bundler";
import {
  makeWorkspaceWebpackOverride,
  remotionAppRoot,
  remotionEntry,
  workspaceRoot,
} from "../packages/pipeline/src/renderer.js";

async function main(): Promise<void> {
  const root = workspaceRoot();
  const entryPoint = remotionEntry();

  console.log("[build] Bundling the Remotion app (webpack only, no browser)…");
  console.log(`[build]   entry: ${entryPoint}`);

  let lastReported = -1;
  const serveUrl = await bundle({
    entryPoint,
    rootDir: remotionAppRoot(),
    // The app/sample spec uses bundled fixtures only; no public assets needed.
    publicDir: null,
    webpackOverride: makeWorkspaceWebpackOverride(root),
    onProgress: (progress: number) => {
      if (progress >= lastReported + 20 || progress === 100) {
        lastReported = progress;
        console.log(`[build]   webpack ${progress}%`);
      }
    },
  });

  console.log(`[build] Bundle succeeded at ${serveUrl}`);

  // The bundle is a build-verification artifact, not a deploy target, so discard
  // it to keep the working tree clean. Cleanup failure must not fail the build.
  try {
    await rm(serveUrl, { recursive: true, force: true });
  } catch {
    console.warn("[build] note: could not remove temporary bundle directory.");
  }

  console.log("[build] OK");
}

main().catch((error: unknown) => {
  console.error("[build] FAILED");
  console.error(error);
  process.exitCode = 1;
});
