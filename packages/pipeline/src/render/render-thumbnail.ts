import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { VideoFormat } from "@news/schema";
import { projectPaths, ensureProject } from "../store/store.js";
import { loadManifest } from "../authoring/manifest.js";
import { renderProjectStillsUnlocked } from "./render-stills.js";
import { withProjectRenderLock } from "./project-lock.js";

/**
 * Cover render (R12/I3): render the first authored scene through the existing
 * no-TTS stills path, then copy that caption-free PNG to the stable public
 * artifact `review/thumbnail.png`.
 *
 * `renderProjectStills` writes a temporary no-audio lock to the project's normal
 * lock path. A published project must retain its full-render lock, so this
 * wrapper snapshots and restores the lock in `finally`, including failed cover
 * renders. The workspace controller serializes project work, so no other render
 * can observe the temporary lock while this runs.
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

async function renderThumbnailUnlocked(projectId: string): Promise<RenderThumbnailResult> {
  const paths = projectPaths(projectId);
  const manifest = await loadManifest(projectId);
  const firstScene = manifest.scenes[0];
  if (!firstScene) throw new Error(`Project ${projectId} has no scene to use as its cover.`);

  const format: VideoFormat = manifest.format ?? "tiktok";
  let previousLock: Buffer | null = null;
  let hadPreviousLock = false;

  try {
    previousLock = await readFile(paths.lock);
    hadPreviousLock = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  try {
    const { stills } = await renderProjectStillsUnlocked(projectId, { sceneIds: [firstScene.id] });
    const firstSceneStill = stills.find((path) => basename(path) === `${firstScene.id}.png`);
    if (!firstSceneStill) throw new Error(`Cover still was not rendered for first scene ${firstScene.id}.`);

    await mkdir(paths.reviewDir, { recursive: true });
    const output = join(paths.reviewDir, THUMBNAIL_FILENAME);
    await copyFile(firstSceneStill, output);
    return { projectId, path: output, format };
  } finally {
    if (hadPreviousLock && previousLock) await writeFile(paths.lock, previousLock);
    else await rm(paths.lock, { force: true });
  }
}
