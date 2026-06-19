import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { bundle } from "@remotion/bundler";
import { ensureBrowser, renderStill, selectComposition } from "@remotion/renderer";
import type { VideoFormat } from "@news/schema";
import { projectPaths, ensureProject } from "../store/store.js";
import { loadManifest } from "../authoring/manifest.js";
import {
  makeWorkspaceWebpackOverride,
  remotionAppRoot,
  remotionEntry,
  workspaceRoot,
} from "./renderer.js";

/**
 * Thumbnail / cover render (freeform-engine R12, I3) — ONE clean BRAND CARD for
 * both delivery formats, rendered through the dedicated `Thumbnail` composition
 * (NOT `NewsVideo`), so it never touches `renderProject`/the orchestrator
 * (ADR-002) or the video render path.
 *
 * The cover is the theme wash + the publish title centered — NO scene frame
 * behind it. An authored scene is itself a text card (its own headline/eyebrow/
 * stat), so compositing the publish title OVER a scene frame stacked two big
 * text blocks that collided. A purpose-built card avoids that entirely and reads
 * clean on both 9:16 and 16:9.
 *
 * The `Thumbnail` composition sizes its own canvas off `geometry(format)` at the
 * Remotion `calculateMetadata` layer, so this just selects it with the right
 * `inputProps` and takes the still at the last frame (title reveal settled).
 *
 * Output: `review/thumbnail.png` — a distinct name from the per-scene
 * `<sceneId>.png` stills, so "which file is the thumbnail" is unambiguous (L6).
 */

const THUMBNAIL_COMPOSITION_ID = "Thumbnail";
const THUMBNAIL_FILENAME = "thumbnail.png";

/** Browser launch + per-frame resolve timeout (cold Windows box can be slow). */
const BROWSER_TIMEOUT_MS = 120_000;

export type RenderThumbnailResult = {
  projectId: string;
  /** Absolute path to the written thumbnail PNG. */
  path: string;
  format: VideoFormat;
};

/**
 * Render a project's thumbnail/cover PNG: a clean brand card (theme wash +
 * publish title) for both formats. Reads format/title/dominant from the manifest.
 */
export async function renderThumbnail(projectId: string): Promise<RenderThumbnailResult> {
  await ensureProject(projectId);
  const paths = projectPaths(projectId);
  const manifest = await loadManifest(projectId);

  const format: VideoFormat = manifest.format ?? "tiktok";
  const dominant = manifest.theme?.dominant ?? "#5B8CFF";
  const title = (manifest.title?.trim() || "Untitled").slice(0, 200);

  const inputProps = { format, dominant, title };

  await ensureBrowser({ logLevel: "warn" });
  const serveUrl = await bundle({
    entryPoint: remotionEntry(),
    rootDir: remotionAppRoot(),
    webpackOverride: makeWorkspaceWebpackOverride(workspaceRoot()),
  });
  const composition = await selectComposition({
    serveUrl,
    id: THUMBNAIL_COMPOSITION_ID,
    inputProps,
    timeoutInMilliseconds: BROWSER_TIMEOUT_MS,
    logLevel: "warn",
  });

  await mkdir(paths.reviewDir, { recursive: true });
  const output = join(paths.reviewDir, THUMBNAIL_FILENAME);
  await renderStill({
    composition,
    serveUrl,
    output,
    // Last frame: TitleBlock's entrance reveal (useReveal) has fully settled.
    frame: Math.max(0, composition.durationInFrames - 1),
    inputProps,
    imageFormat: "png",
    overwrite: true,
    timeoutInMilliseconds: BROWSER_TIMEOUT_MS,
    logLevel: "warn",
  });

  return { projectId, path: output, format };
}
