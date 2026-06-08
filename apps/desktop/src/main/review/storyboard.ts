import type { SceneCard, StoryboardModel } from "../../shared/types.js";

/**
 * Storyboard view-model (web-dashboard Task 9.1, design §Storyboard, Req 8). The
 * per-scene "slides" are the engine's existing review keyframes
 * (`review/<sceneId>.png`); the dashboard reads their paths, it does not render
 * stills itself.
 *
 * NOTE (reconcile-main-controllers S1): the batch-submit / edit-router /
 * re-author path that previously lived here served the Review_Edit_Loop, which
 * is intentionally deferred (kept as a stub). It was removed; only the live
 * `buildStoryboard` view-model builder remains.
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
