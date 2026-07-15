import { describe, expect, it } from "vitest";
import { makeTheme } from "@motionreal/theme";
import { VENDORED_FONTS } from "./vendor-fonts.generated.js";
import { fontCoverageReport, LOADED_FONT_FAMILIES } from "./fonts.js";

/** Leading family name of a CSS font stack, unquoted. */
function leading(stack: string): string {
  return (stack.split(",")[0] ?? "").trim().replace(/^["']|["']$/g, "");
}

const RENDER_FAMILIES = [
  LOADED_FONT_FAMILIES.display,
  LOADED_FONT_FAMILIES.bodyPremium,
  LOADED_FONT_FAMILIES.mono,
] as const;

// Property 19: render fonts cover Vietnamese and load safely
describe("render fonts — Property 19: Vietnamese coverage + render-safe", () => {
  it("every loaded render font ships the vietnamese subset (no diacritic fallback)", () => {
    for (const family of RENDER_FAMILIES) {
      expect(
        VENDORED_FONTS.some((f) => f.family === family && f.subset === "vietnamese"),
        `${family} must vendor vietnamese`,
      ).toBe(true);
    }
  });

  it("the neutral theme font families are render-safe loaded families", () => {
    const loaded = new Set<string>(RENDER_FAMILIES);
    const f = makeTheme().fonts;
    for (const stack of [f.display, f.body, f.mono]) {
      expect(loaded.has(leading(stack))).toBe(true);
    }
  });

  it("the neutral theme leads with a render-safe Vietnamese-complete face", () => {
    const loaded = new Set<string>(RENDER_FAMILIES);
    const f = makeTheme().fonts;
    expect(loaded.has(leading(f.display))).toBe(true);
  });
});

// Fonts are vendored as base64 woff2 data URLs so a render NEVER fetches
// fonts.gstatic.com. These lock the vendored manifest's completeness.
describe("vendored fonts — self-hosted, render-safe (no network)", () => {
  it("vendors all three render families with the vietnamese subset", () => {
    for (const family of RENDER_FAMILIES) {
      const viet = VENDORED_FONTS.filter((f) => f.family === family && f.subset === "vietnamese");
      expect(viet.length, `${family} must have a vendored vietnamese face`).toBeGreaterThan(0);
    }
  });

  it("vendors the latin subset too (latin glyphs + punctuation)", () => {
    for (const family of RENDER_FAMILIES) {
      const latin = VENDORED_FONTS.filter((f) => f.family === family && f.subset === "latin");
      expect(latin.length, `${family} must have a vendored latin face`).toBeGreaterThan(0);
    }
  });

  it("every vendored face is a real base64 woff2 data URL with a unicode-range", () => {
    expect(VENDORED_FONTS.length).toBeGreaterThan(0);
    for (const f of VENDORED_FONTS) {
      expect(f.dataUrl.startsWith("data:font/woff2;base64,")).toBe(true);
      expect(f.dataUrl.length).toBeGreaterThan(100);
      expect(f.unicodeRange.length).toBeGreaterThan(0);
    }
  });

  it("fontCoverageReport reports vietnamese coverage for all three families", () => {
    const report = fontCoverageReport();
    expect(report).toHaveLength(3);
    expect(report.every((r) => r.hasVietnamese)).toBe(true);
  });
});
