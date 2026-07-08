import type { SceneCard, StoryboardModel } from "../../shared/types.js";

/**
 * Storyboard view-model for desktop review. Per-scene slides are the pipeline's
 * review keyframes (`review/<sceneId>.png`); the UI reads paths and does not
 * render stills itself. Only `buildStoryboard` remains here — older batch-edit /
 * re-author controllers were removed with the deferred Review_Edit_Loop.
 */

/**
 * Build the Storyboard view-model from ordered scene ids. `stillPath` is
 * produced by the injected `toStill` mapper so the caller controls whether the
 * path is raw or wrapped (e.g. through `mediaUrl` for the renderer). Defaults to
 * the raw `review/<sceneId>.png` path under `root`.
 */
export function buildStoryboard(
  projectId: string,
  root: string,
  sceneIds: string[],
  globalNotes = "",
  toStill: (root: string, sceneId: string) => string = (r, id) => `${r}/review/${id}.png`,
): StoryboardModel {
  const scenes: SceneCard[] = sceneIds.map((sceneId, i) => ({
    sceneId,
    order: i,
    stillPath: toStill(root, sceneId),
    editText: "",
  }));
  return { projectId, scenes, globalNotes };
}
