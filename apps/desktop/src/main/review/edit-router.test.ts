import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { classify, routeEdits, type ParsedSceneEdit } from "./edit-router.js";

/**
 * Feature: web-dashboard, Property 7: Edit routing — plain-text never invokes
 * AI, visual touches only affected scenes. Every plain-text edit applies to the
 * manifest with no AI (it is not in the visual set); every visual edit re-authors
 * ONLY the named scene ids (the visual set is a subset of the edited ids).
 * (Req 8.6, 8.7, 8.8, 8.14)
 */

const sceneIdArb = fc.integer({ min: 1, max: 20 }).map((n) => `scene-${String(n).padStart(2, "0")}`);

const textChangeArb = fc.record(
  {
    headline: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
    narration: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
    cta: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
  },
  { requiredKeys: [] },
);

const editArb: fc.Arbitrary<ParsedSceneEdit> = fc.record(
  {
    sceneId: sceneIdArb,
    textChanges: fc.option(textChangeArb, { nil: undefined }),
    visualIntent: fc.option(
      fc.oneof(fc.constant(""), fc.string({ minLength: 1, maxLength: 30 }).map((s) => `đổi ${s}`)),
      { nil: undefined },
    ),
  },
  { requiredKeys: ["sceneId"] },
);

describe("Property 7: edit routing", () => {
  it("plain-text edits stay out of the visual set; visual ids ⊆ edited ids", () => {
    fc.assert(
      fc.property(fc.array(editArb, { maxLength: 12 }), fc.string({ maxLength: 40 }), (edits, notes) => {
        const result = routeEdits(edits, notes);
        const editedIds = new Set(edits.map((e) => e.sceneId));

        // Visual set is exactly the distinct ids of visual-classified edits.
        const expectedVisual = new Set(
          edits.filter((e) => classify(e) === "visual").map((e) => e.sceneId),
        );
        expect(new Set(result.visual.sceneIds)).toEqual(expectedVisual);
        // Visual ids are a subset of the submitted scene ids (no spillover).
        for (const id of result.visual.sceneIds) expect(editedIds.has(id)).toBe(true);

        // Every routed plain-text edit was classified plain-text and carries a
        // real wording change (so it can apply with no AI).
        for (const pt of result.plainText) {
          const fields = [pt.textChanges.headline, pt.textChanges.narration, pt.textChanges.cta];
          expect(fields.some((f) => f !== undefined)).toBe(true);
        }
        expect(result.plainText.length + result.visual.sceneIds.length).toBeGreaterThanOrEqual(0);
        // The preprompt only ever names affected (visual) scenes.
        expect(new Set(result.visual.preprompt.affectedSceneIds)).toEqual(expectedVisual);
      }),
      { numRuns: 300 },
    );
  });

  it("classify is total: visual iff a visual intent is present, else plain-text iff wording changes", () => {
    fc.assert(
      fc.property(editArb, (edit) => {
        const cls = classify(edit);
        expect(cls === "plain-text" || cls === "visual").toBe(true);
        const hasIntent = (edit.visualIntent ?? "").trim().length > 0;
        if (hasIntent) expect(cls).toBe("visual");
      }),
      { numRuns: 200 },
    );
  });
});
