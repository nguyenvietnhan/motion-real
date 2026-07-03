import type { ApplyResult, ScriptEdit } from "../../shared/types.js";
import { createLogger } from "@motionreal/pipeline";

const log = createLogger("script");

/**
 * Script-gate edit application (web-dashboard Task 4.7, design §script gate,
 * Req 4.3/4.4/4.5). Applying confirmed `ScriptEdit[]` to the manifest scenes:
 *   - any edit that would leave a scene's narration with zero non-whitespace
 *     characters is REJECTED, the prior text retained, and the scene identified
 *     (Property 4);
 *   - on write failure the pre-edit manifest is left unchanged.
 * The pure computation (`computeScriptEdits`) is separated from the write so the
 * empty-narration guard is testable without disk.
 */

export type ManifestScene = { sceneId: string; narration: string; headline?: string };

export type ComputeResult =
  | { ok: true; scenes: ManifestScene[] }
  | { ok: false; reason: "empty-narration"; sceneId: string };

const hasText = (s: string | undefined): boolean => (s ?? "").trim().length > 0;

/**
 * Pure: fold the edits onto the scenes WITHOUT mutating the input. Rejects the
 * whole batch (returning the first offending scene) if any edit empties a
 * narration, so a partial write can never leave an empty narration behind.
 */
export function computeScriptEdits(scenes: ManifestScene[], edits: ScriptEdit[]): ComputeResult {
  const next = scenes.map((s) => ({ ...s }));
  const editById = new Map(edits.map((e) => [e.sceneId, e]));

  // Iterate in MANIFEST order (not edits order) so the first offending scene
  // reported matches the dashboard's Current_Behavior, which scans
  // `manifest.scenes` rather than the edit list (reconcile-main-controllers R4.4).
  for (const scene of next) {
    const edit = editById.get(scene.sceneId);
    if (!edit) continue; // scenes without an edit are untouched
    if (edit.narration !== undefined) {
      if (!hasText(edit.narration)) {
        return { ok: false, reason: "empty-narration", sceneId: scene.sceneId };
      }
      scene.narration = edit.narration;
    }
    if (edit.headline !== undefined) {
      scene.headline = edit.headline;
    }
  }
  return { ok: true, scenes: next };
}

/**
 * Apply + persist. `writeScenes` performs the manifest write (normalization +
 * disk) and may throw; on any throw the pre-edit manifest is left untouched and
 * `write-failed` is returned (Req 4.5). The empty-narration guard runs first so
 * the writer is never called with an emptied narration (Req 4.4).
 */
export async function applyScriptEdits(
  scenes: ManifestScene[],
  edits: ScriptEdit[],
  writeScenes: (scenes: ManifestScene[]) => Promise<void>,
): Promise<ApplyResult> {
  const computed = computeScriptEdits(scenes, edits);
  if (!computed.ok) return computed;
  try {
    await writeScenes(computed.scenes);
    return { ok: true };
  } catch (error) {
    log.warn({ err: error }, "script edit persistence failed; returning typed write-failed result");
    return { ok: false, reason: "write-failed" };
  }
}
