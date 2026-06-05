import { describe, expect, it } from "vitest";
import { getComponent, listComponents, validateProps } from "@news/compositions";

/**
 * Registration + example-validity checks for the starter scene catalog
 * (Requirement 14.4). These stay render-free: they only assert that each
 * component is registered, that its bundled `example` parses against its own
 * Zod schema, and that the public catalog lists it. No Remotion runtime render
 * happens here, so the suite is fast and deterministic.
 */

const ORIGINAL_COMPONENTS = ["hero-announcement", "price-spotlight", "insight-stack", "final-cta"] as const;
const NEW_COMPONENTS = ["quote-pull", "comparison-split", "stat-grid"] as const;
const ALL_COMPONENTS = [...ORIGINAL_COMPONENTS, ...NEW_COMPONENTS];

describe("scene component catalog (Req 14.4)", () => {
  for (const id of NEW_COMPONENTS) {
    describe(`new component "${id}"`, () => {
      it("is registered", () => {
        expect(getComponent(id)).toBeDefined();
      });

      it("has an example that parses against its own schema", () => {
        const def = getComponent(id);
        expect(def).toBeDefined();
        const result = validateProps(id, def!.example);
        if (!result.ok) {
          console.error(id, result.errors);
        }
        expect(result.ok).toBe(true);
        expect(result.errors).toEqual([]);
      });

      it("exposes a displayName and promptGuide for the planner catalog", () => {
        const def = getComponent(id)!;
        expect(def.displayName.length).toBeGreaterThan(0);
        expect(def.promptGuide.length).toBeGreaterThan(0);
      });
    });
  }

  it("listComponents() includes the original starters and the new ones", () => {
    const ids = listComponents().map((d) => d.id);
    for (const id of ALL_COMPONENTS) {
      expect(ids).toContain(id);
    }
    expect(ids.length).toBeGreaterThanOrEqual(ALL_COMPONENTS.length);
  });

  it("rejects an obviously invalid payload for each new component", () => {
    for (const id of NEW_COMPONENTS) {
      expect(validateProps(id, { not: "valid" }).ok).toBe(false);
    }
  });
});
