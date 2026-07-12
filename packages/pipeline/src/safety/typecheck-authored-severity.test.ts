import { describe, expect, it } from "vitest";
import { isN10CrashClassDiagnostic } from "./typecheck-authored.js";

describe("N10 B-minimal crash-class filter", () => {
  it("hard-blocks unbound names (TS2304 → ReferenceError at render)", () => {
    expect(isN10CrashClassDiagnostic(2304, "Cannot find name 'fooNotDefined'.")).toBe(true);
  });

  it("does not treat CSSProperties / RN excess as crash-class", () => {
    expect(
      isN10CrashClassDiagnostic(
        2353,
        "Object literal may only specify known properties, and 'paddingHorizontal' does not exist in type 'Properties<string | number, string & {}>'.",
      ),
    ).toBe(false);
    expect(
      isN10CrashClassDiagnostic(
        2353,
        "Object literal may only specify known properties, and 'shadowColor' does not exist in type 'Properties<string | number, string & {}>'.",
      ),
    ).toBe(false);
  });

  it("does not treat missing data-field access (TS2339) as crash-class", () => {
    expect(
      isN10CrashClassDiagnostic(
        2339,
        "Property 'elevation' does not exist on type '{ id: number; title: string; shadow: string }'.",
      ),
    ).toBe(false);
  });

  it("does not treat generic assignability / prop noise as crash-class", () => {
    expect(isN10CrashClassDiagnostic(2322, "Type 'string' is not assignable to type 'number'.")).toBe(false);
    expect(isN10CrashClassDiagnostic(7006, "Parameter 'x' implicitly has an 'any' type.")).toBe(false);
  });
});
