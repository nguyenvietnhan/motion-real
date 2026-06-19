import { describe, expect, it } from "vitest";
import { getInfo as interInfo, fontFamily as interFamily } from "@remotion/google-fonts/Inter";
import { getInfo as bvpInfo, fontFamily as bvpFamily } from "@remotion/google-fonts/BeVietnamPro";
import { getInfo as cascadiaInfo, fontFamily as cascadiaFamily } from "@remotion/google-fonts/CascadiaMono";
import { listStylePackIds, getStylePack } from "@news/theme";
import { VENDORED_FONTS } from "./vendor-fonts.generated.js";
import { fontCoverageReport } from "./fonts.js";

/** Leading family name of a CSS font stack, unquoted. */
function leading(stack: string): string {
  return (stack.split(",")[0] ?? "").trim().replace(/^["']|["']$/g, "");
}

// Feature: tool-productization, Property 19: Style-pack fonts cover Vietnamese and load render-safe
describe("style-pack fonts — Property 19: Vietnamese coverage + render-safe", () => {
  it("every loaded pack font ships the vietnamese subset (no diacritic fallback)", () => {
    for (const info of [interInfo(), bvpInfo(), cascadiaInfo()]) {
      expect(info.subsets).toContain("vietnamese");
    }
  });

  it("every style pack's font families are render-safe loaded families", () => {
    const loaded = new Set<string>([interFamily, bvpFamily, cascadiaFamily]); // Inter, Be Vietnam Pro, Cascadia Mono
    for (const id of listStylePackIds()) {
      const f = getStylePack(id)!.fonts;
      for (const stack of [f.display, f.body, f.mono]) {
        expect(loaded.has(leading(stack))).toBe(true);
      }
    }
  });

  it("the neutral theme leads with a render-safe Vietnamese-complete face", () => {
    const loaded = new Set<string>([interFamily, bvpFamily, cascadiaFamily]);
    const f = getStylePack().fonts;
    expect(loaded.has(leading(f.display))).toBe(true);
  });
});

// The self-hosting net (font timeout robustness): fonts are vendored as base64
// woff2 data URLs so a render NEVER fetches fonts.gstatic.com (the source of the
// intermittent "Timed out loading Google Font" failures). These lock the vendored
// manifest's completeness so a bad re-vendor can't silently drop a family/subset.
describe("vendored fonts — self-hosted, render-safe (no network)", () => {
  it("vendors all three style-pack families with the vietnamese subset", () => {
    for (const family of ["Inter", "Be Vietnam Pro", "Cascadia Mono"]) {
      const viet = VENDORED_FONTS.filter((f) => f.family === family && f.subset === "vietnamese");
      expect(viet.length, `${family} must have a vendored vietnamese face`).toBeGreaterThan(0);
    }
  });

  it("vendors the latin subset too (latin glyphs + the cream-base punctuation)", () => {
    for (const family of ["Inter", "Be Vietnam Pro", "Cascadia Mono"]) {
      const latin = VENDORED_FONTS.filter((f) => f.family === family && f.subset === "latin");
      expect(latin.length, `${family} must have a vendored latin face`).toBeGreaterThan(0);
    }
  });

  it("every vendored face is a real base64 woff2 data URL with a unicode-range", () => {
    expect(VENDORED_FONTS.length).toBeGreaterThan(0);
    for (const f of VENDORED_FONTS) {
      expect(f.dataUrl.startsWith("data:font/woff2;base64,")).toBe(true);
      expect(f.dataUrl.length).toBeGreaterThan(100); // not a truncated/empty stub
      expect(f.unicodeRange.length).toBeGreaterThan(0);
    }
  });

  it("fontCoverageReport reports vietnamese coverage for all three families", () => {
    const report = fontCoverageReport();
    expect(report).toHaveLength(3);
    expect(report.every((r) => r.hasVietnamese)).toBe(true);
  });
});
