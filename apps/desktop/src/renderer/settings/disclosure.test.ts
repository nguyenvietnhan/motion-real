import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { ALL_CONTROL_IDS, disclosureOf, isRenderable, type ControlId } from "./disclosure.js";

/**
 * Feature: web-dashboard, Property 12: Disclosure placement is total and hides
 * all L0 internals. For any ControlId, disclosureOf returns exactly one level,
 * every L0 control id maps to L0, and no L0 id is ever renderable.
 * (Req 11.1, 11.2, 11.4, 11.5)
 */

const L0_IDS: ControlId[] = [
  "grid-codes",
  "determinism",
  "manifest-json",
  "tsx-source",
  "mcp",
  "stack-trace",
];

describe("Property 12: disclosure placement", () => {
  it("is total over every control id", () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL_CONTROL_IDS), (id) => {
        expect(["L0", "L1", "L2", "L3"]).toContain(disclosureOf(id));
      }),
      { numRuns: 200 },
    );
  });

  it("every L0 id maps to L0 and is never renderable", () => {
    fc.assert(
      fc.property(fc.constantFrom(...L0_IDS), (id) => {
        expect(disclosureOf(id)).toBe("L0");
        expect(isRenderable(id)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("no L0 id appears among the renderable controls", () => {
    const renderable = ALL_CONTROL_IDS.filter(isRenderable);
    for (const id of L0_IDS) expect(renderable).not.toContain(id);
  });
});
