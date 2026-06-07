import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { validateBatch } from "./batch-submit-controller.js";
import type { EditBatch } from "../../shared/types.js";

/**
 * Feature: web-dashboard, Property 8: Empty and last-scene submissions are
 * rejected without changing the draft. A batch with no per-scene text and no
 * global notes ⇒ no-changes; a removal of the only remaining scene ⇒
 * last-scene. (Req 8.11, 8.13)
 */

const batchArb: fc.Arbitrary<EditBatch> = fc.record({
  perScene: fc.array(
    fc.record({ sceneId: fc.string({ minLength: 1, maxLength: 8 }), text: fc.string({ maxLength: 30 }) }),
    { maxLength: 8 },
  ),
  globalNotes: fc.string({ maxLength: 40 }),
});

describe("Property 8: empty and last-scene rejection", () => {
  it("matches the spec semantics for any batch / sceneCount / removals", () => {
    fc.assert(
      fc.property(
        batchArb,
        fc.integer({ min: 1, max: 8 }),
        fc.array(fc.string({ minLength: 1, maxLength: 8 }), { maxLength: 8 }),
        (batch, sceneCount, removals) => {
          const result = validateBatch(batch, sceneCount, removals);
          const hasText = batch.perScene.some((p) => p.text.trim().length > 0);
          const hasNotes = batch.globalNotes.trim().length > 0;
          const removalCount = new Set(removals).size;

          if (!hasText && !hasNotes && removalCount === 0) {
            expect(result).toEqual({ ok: false, reason: "no-changes" });
          } else if (removalCount > 0 && sceneCount - removalCount < 1) {
            expect(result).toEqual({ ok: false, reason: "last-scene" });
          } else {
            expect(result).toEqual({ ok: true });
          }
        },
      ),
      { numRuns: 400 },
    );
  });

  it("removing the only remaining scene is always last-scene", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 8 }), (sceneId) => {
        const batch: EditBatch = { perScene: [], globalNotes: "" };
        expect(validateBatch(batch, 1, [sceneId])).toEqual({ ok: false, reason: "last-scene" });
      }),
      { numRuns: 100 },
    );
  });
});
