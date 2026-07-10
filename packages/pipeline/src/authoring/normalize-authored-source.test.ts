import { describe, expect, it } from "vitest";
import { normalizeAuthoredSource, stripReactNativeStyleKeys } from "./normalize-authored-source.js";

describe("stripReactNativeStyleKeys", () => {
  it("removes shadowColor from a style object (the N10 TS2353 case)", () => {
    const src = `style={{ shadowColor: ballColor }}`;
    expect(stripReactNativeStyleKeys(src)).toBe("style={{ }}");
  });

  it("keeps valid CSS shadow props", () => {
    const src = `style={{ boxShadow: "0 0 8px #000", textShadow: "0 1px 2px #000" }}`;
    expect(stripReactNativeStyleKeys(src)).toBe(src);
  });

  it("strips shadowColor while keeping sibling textShadow", () => {
    const src = `style={{
                  textShadow: "0px 2px 8px rgba(0,0,0,0.8)",
                  shadowColor: ballColor,
                  fontFamily: "monospace"
                }}`;
    const out = stripReactNativeStyleKeys(src);
    expect(out).toContain("textShadow");
    expect(out).toContain("fontFamily");
    expect(out).not.toMatch(/\bshadowColor\b/);
  });

  it("strips the full RN shadow set", () => {
    const src =
      "style={{ shadowColor: c, shadowOffset: {width:1,height:1}, shadowOpacity: 0.5, shadowRadius: 4, elevation: 2 }}";
    const out = stripReactNativeStyleKeys(src);
    expect(out).not.toMatch(/shadowColor|shadowOffset|shadowOpacity|shadowRadius|elevation/);
  });
});

describe("normalizeAuthoredSource", () => {
  it("is a pure pipeline entry for pre-write rewrites", () => {
    expect(normalizeAuthoredSource(`style={{ shadowColor: "red" }}`)).toBe("style={{ }}");
  });
});
