import { describe, expect, it } from "vitest";
import { severityForN10 } from "./typecheck-authored.js";

describe("severityForN10 soft-gate", () => {
  it("softens CSSProperties / RN excess property errors (TS2353)", () => {
    expect(
      severityForN10(
        2353,
        "Object literal may only specify known properties, and 'paddingHorizontal' does not exist in type 'Properties<string | number, string & {}>'.",
      ),
    ).toBe("warning");
    expect(
      severityForN10(
        2353,
        "Object literal may only specify known properties, and 'shadowColor' does not exist in type 'Properties<string | number, string & {}>'.",
      ),
    ).toBe("warning");
  });

  it("softens missing data-field access (TS2339)", () => {
    expect(
      severityForN10(
        2339,
        "Property 'elevation' does not exist on type '{ id: number; title: string; shadow: string }'.",
      ),
    ).toBe("warning");
  });

  it("keeps unbound names hard (TS2304)", () => {
    expect(severityForN10(2304, "Cannot find name 'foo'.")).toBe("error");
  });
});
