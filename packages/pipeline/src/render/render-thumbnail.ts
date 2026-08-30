import { copyFile, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import type { VideoFormat } from "@motionreal/schema";
import { projectPaths, ensureProject } from "../store/store.js";
import { loadManifest } from "../authoring/manifest.js";
import { renderProjectStillsUnlocked } from "./render-stills.js";
import { withProjectRenderLock } from "./project-lock.js";

/**
 * Cover render: render the first authored scene through the existing
 * no-TTS stills path, then copy that caption-free PNG to the stable public
 * artifact `review/thumbnail.png`.
 *
 * `renderProjectStills` writes its no-audio lock to a separate stills-only path,
 * so a published project's canonical full-render lock is never touched.
 */

const THUMBNAIL_FILENAME = "thumbnail.png";

export type RenderThumbnailResult = {
  projectId: string;
  /** Absolute path to the written thumbnail PNG. */
  path: string;
  format: VideoFormat;
};

export async function renderThumbnail(projectId: string): Promise<RenderThumbnailResult> {
  await ensureProject(projectId);
  return withProjectRenderLock(projectId, "thumbnail", () => renderThumbnailUnlocked(projectId));
}

// Private by design: callers must still hold the project render lock so the
// thumbnail cannot race a full render over the same review artifacts.
async function renderThumbnailUnlocked(projectId: string): Promise<RenderThumbnailResult> {
  const paths = projectPaths(projectId);
  const manifest = await loadManifest(projectId);
  const firstScene = manifest.scenes[0];
  if (!firstScene) throw new Error(`Project ${projectId} has no scene to use as its cover.`);

  const format: VideoFormat = manifest.format ?? "tiktok";
  const { stills } = await renderProjectStillsUnlocked(projectId, { sceneIds: [firstScene.id] });
  const firstSceneStill = stills.find((path) => basename(path) === `${firstScene.id}.png`);
  if (!firstSceneStill) throw new Error(`Cover still was not rendered for first scene ${firstScene.id}.`);

  await mkdir(paths.reviewDir, { recursive: true });
  const output = join(paths.reviewDir, THUMBNAIL_FILENAME);
  await copyFile(firstSceneStill, output);
  return { projectId, path: output, format };
}
