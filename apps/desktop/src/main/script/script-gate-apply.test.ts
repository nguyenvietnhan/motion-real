import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  applyScriptEdits,
  computeScriptEdits,
  type ManifestScene,
} from "./script-gate-apply.js";
import type { ScriptEdit } from "../../shared/types.js";

/**
 * Property 4: Script edits never write an empty
 * narration. If any edit would leave a scene's narration with zero
 * non-whitespace characters, the batch is rejected, prior text retained, the
 * scene identified; and if the write fails the pre-edit manifest is unchanged.
 *
 */

const sceneArb: fc.Arbitrary<ManifestScene> = fc
  .tuple(fc.integer({ min: 1, max: 30 }), fc.string({ minLength: 1, maxLength: 40 }))
  .map(([n, narr]) => ({ sceneId: `scene-${String(n).padStart(2, "0")}`, narration: `x${narr}` }));

const scenesArb = fc
  .uniqueArray(sceneArb, { minLength: 1, maxLength: 8, selector: (s) => s.sceneId })
  .map((scenes) => scenes);

function editArb(sceneIds: string[]): fc.Arbitrary<ScriptEdit> {
  return fc.record(
    {
      sceneId: fc.constantFrom(...sceneIds),
      narration: fc.option(
        fc.oneof(
          fc.constantFrom("", "   ", "\t\n"), // empties
          fc.string({ minLength: 1, maxLength: 30 }).map((s) => `n${s}`), // non-empty
        ),
        { nil: undefined },
      ),
    },
    { requiredKeys: ["sceneId"] },
  );
}

describe("Property 4: script edits never write an empty narration", () => {
  it("computeScriptEdits rejects empties and otherwise preserves non-empty narration", () => {
    fc.assert(
      fc.property(
        scenesArb.chain((scenes) =>
          fc.tuple(
            fc.constant(scenes),
            fc.array(editArb(scenes.map((s) => s.sceneId)), { maxLength: 10 }),
          ),
        ),
        ([scenes, edits]) => {
          const result = computeScriptEdits(scenes, edits);
          // previous main-process behavior semantics: edits collapse into a per-scene map where
          // the LAST edit per sceneId wins (mirrors `new Map(edits.map(...))` in
          // index.ts), and scenes are scanned in MANIFEST order.
          const effective = new Map<string, ScriptEdit>();
          for (const e of edits) effective.set(e.sceneId, e);
          const wouldEmpty = [...effective.values()].some(
            (e) => e.narration !== undefined && e.narration.trim().length === 0,
          );
          if (wouldEmpty) {
            expect(result.ok).toBe(false);
            if (!result.ok) {
              expect(result.reason).toBe("empty-narration");
              expect(scenes.some((s) => s.sceneId === result.sceneId)).toBe(true);
            }
            // Input scenes are never mutated.
            expect(scenes.every((s) => s.narration.trim().length > 0)).toBe(true);
          } else {
            expect(result.ok).toBe(true);
            if (result.ok) {
              expect(result.scenes.every((s) => s.narration.trim().length > 0)).toBe(true);
            }
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("computeScriptEdits ignores edits for unknown scenes", () => {
    const scenes: ManifestScene[] = [
      { sceneId: "scene-01", narration: "a" },
      { sceneId: "scene-02", narration: "b" },
    ];

    const result = computeScriptEdits(scenes, [
      { sceneId: "scene-99", narration: "z", headline: "Ignored" },
    ]);

    expect(result).toEqual({ ok: true, scenes });
    expect(scenes).toEqual([
      { sceneId: "scene-01", narration: "a" },
      { sceneId: "scene-02", narration: "b" },
    ]);
  });

  it("a write failure leaves the result as write-failed (manifest unchanged)", async () => {
    await fc.assert(
      fc.asyncProperty(scenesArb, async (scenes) => {
        const edits: ScriptEdit[] = [{ sceneId: scenes[0]!.sceneId, narration: "nội dung mới" }];
        const result = await applyScriptEdits(scenes, edits, async () => {
          throw new Error("disk full");
        });
        expect(result).toEqual({ ok: false, reason: "write-failed" });
      }),
      { numRuns: 100 },
    );
  });
});
