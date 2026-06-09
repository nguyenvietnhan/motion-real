import { describe, expect, it } from "vitest";
import { normalizeAuthoredFontSizes, MIN_READABLE_FONT_PX } from "./normalize-fontsize.js";

describe("normalizeAuthoredFontSizes", () => {
  it("raises a tiny bare numeric fontSize up to the floor", () => {
    expect(normalizeAuthoredFontSizes(`fontSize: 12`)).toBe(`fontSize: ${MIN_READABLE_FONT_PX}`);
    expect(normalizeAuthoredFontSizes(`fontSize:10`)).toBe(`fontSize:${MIN_READABLE_FONT_PX}`);
  });

  it("raises a tiny px-string fontSize, preserving the quote style", () => {
    expect(normalizeAuthoredFontSizes(`fontSize: "12px"`)).toBe(`fontSize: "${MIN_READABLE_FONT_PX}px"`);
    expect(normalizeAuthoredFontSizes(`fontSize: '14px'`)).toBe(`fontSize: '${MIN_READABLE_FONT_PX}px'`);
  });

  it("leaves a fontSize already at or above the floor untouched", () => {
    expect(normalizeAuthoredFontSizes(`fontSize: 18`)).toBe(`fontSize: 18`);
    expect(normalizeAuthoredFontSizes(`fontSize: 48`)).toBe(`fontSize: 48`);
    expect(normalizeAuthoredFontSizes(`fontSize: "92px"`)).toBe(`fontSize: "92px"`);
  });

  it("leaves a non-literal fontSize (variable / expression) untouched", () => {
    expect(normalizeAuthoredFontSizes(`fontSize: valueFont`)).toBe(`fontSize: valueFont`);
    expect(normalizeAuthoredFontSizes(`fontSize: headline.length > 24 ? 92 : 108`)).toBe(
      `fontSize: headline.length > 24 ? 92 : 108`,
    );
  });

  it("normalizes every offending occurrence in a multi-style module", () => {
    const code = `<div style={{ fontSize: 84 }}><span style={{ fontSize: 11 }}>x</span><b style={{ fontSize: "9px" }}>y</b></div>`;
    const out = normalizeAuthoredFontSizes(code);
    expect(out).toContain(`fontSize: 84`);
    expect(out).toContain(`fontSize: ${MIN_READABLE_FONT_PX}`);
    expect(out).toContain(`fontSize: "${MIN_READABLE_FONT_PX}px"`);
    expect(out).not.toMatch(/fontSize:\s*11\b/);
    expect(out).not.toContain(`"9px"`);
  });

  it("does not touch a fractional size at the boundary that's already readable", () => {
    expect(normalizeAuthoredFontSizes(`fontSize: 17.5`)).toBe(`fontSize: ${MIN_READABLE_FONT_PX}`);
    expect(normalizeAuthoredFontSizes(`fontSize: 18.5`)).toBe(`fontSize: 18.5`);
  });
});
