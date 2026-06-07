import type { EditBatch } from "../../shared/types.js";

/**
 * Batch-submission validation (web-dashboard Task 4.11, design §Batch→Preprompt,
 * Req 8.11/8.13). Pure guards run before any routing/re-render:
 *   - a batch with no per-scene text, no global notes, and no removals is
 *     rejected `no-changes`;
 *   - a removal that would leave zero scenes is rejected `last-scene`.
 * In both cases the current Draft is left unchanged (Property 8).
 */

export type BatchValidation = { ok: true } | { ok: false; reason: "no-changes" | "last-scene" };

const nonEmpty = (s: string): boolean => s.trim().length > 0;

export function validateBatch(
  batch: EditBatch,
  sceneCount: number,
  removals: string[] = [],
): BatchValidation {
  const hasSceneText = batch.perScene.some((p) => nonEmpty(p.text));
  const hasNotes = nonEmpty(batch.globalNotes);
  const removalCount = new Set(removals).size;

  if (!hasSceneText && !hasNotes && removalCount === 0) {
    return { ok: false, reason: "no-changes" };
  }
  if (removalCount > 0 && sceneCount - removalCount < 1) {
    return { ok: false, reason: "last-scene" };
  }
  return { ok: true };
}
