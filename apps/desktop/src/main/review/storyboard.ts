import type { EditBatch, EvidenceWarning, SceneCard, StoryboardModel, SubmitResult } from "../../shared/types.js";
import { routeEdits, type ParsedSceneEdit } from "./edit-router.js";
import { validateBatch } from "./batch-submit-controller.js";

/**
 * Storyboard model + batch submission (web-dashboard Task 9.1, design §Storyboard,
 * Req 8). The per-scene "slides" are the engine's existing review keyframes
 * (`review/<sceneId>.png`); the dashboard reads their paths, it does not render
 * stills itself. A submitted batch is validated, routed via the EditRouter, and
 * only the changed scenes are re-authored + re-rendered (the cache keeps the rest
 * byte-identical). A per-scene re-render failure preserves the edits + the prior
 * still and names the failed scene (Req 8.12).
 */

export const MAX_SCENE_EDIT_CHARS = 2000;
export const MAX_GLOBAL_NOTES_CHARS = 4000;

/** Build the Storyboard view-model from ordered scene ids + the project root. */
export function buildStoryboard(
  projectId: string,
  root: string,
  sceneIds: string[],
  globalNotes = "",
): StoryboardModel {
  const scenes: SceneCard[] = sceneIds.map((sceneId, i) => ({
    sceneId,
    order: i,
    stillPath: `${root}/review/${sceneId}.png`,
    editText: "",
  }));
  return { projectId, scenes, globalNotes };
}

/**
 * The re-author + re-render effect the submit drives. Returns evidence-gate
 * warnings (N9 through the Agent_Worker, Req 8.9) on success, or names the scene
 * that failed to re-render (Req 8.12).
 */
export interface StoryboardBackend {
  reauthorAndRender(
    projectId: string,
    sceneIds: string[],
    perSceneIntent: Record<string, string>,
    globalNotes: string,
  ): Promise<
    | { ok: true; warnings?: EvidenceWarning[] }
    | { ok: false; reason: "scene-render-failed"; sceneId: string }
  >;
}

export class BatchSubmitController {
  private revision = 0;

  constructor(
    private readonly projectId: string,
    private readonly backend: StoryboardBackend,
  ) {}

  /** Treat each free-text storyboard edit as a VISUAL intent (re-author). */
  private toParsed(batch: EditBatch): ParsedSceneEdit[] {
    return batch.perScene
      .filter((p) => p.text.trim().length > 0)
      .map((p) => ({ sceneId: p.sceneId, visualIntent: p.text.trim() }));
  }

  async submit(batch: EditBatch, sceneCount: number, removals: string[] = []): Promise<SubmitResult> {
    const valid = validateBatch(batch, sceneCount, removals);
    if (!valid.ok) return { ok: false, reason: valid.reason };

    const routed = routeEdits(this.toParsed(batch), batch.globalNotes.trim());
    const result = await this.backend.reauthorAndRender(
      this.projectId,
      routed.visual.sceneIds,
      routed.visual.preprompt.perSceneIntent,
      routed.visual.preprompt.globalNotes,
    );

    if (!result.ok) {
      // Preserve the current Draft + edits; name the failed scene (Req 8.12).
      return { ok: false, reason: "scene-render-failed", sceneId: result.sceneId };
    }

    this.revision += 1;
    return result.warnings && result.warnings.length > 0
      ? { ok: true, revision: this.revision, warnings: result.warnings }
      : { ok: true, revision: this.revision };
  }
}
