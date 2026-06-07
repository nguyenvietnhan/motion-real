import { describe, expect, it } from "vitest";
import { getInfo as interInfo, fontFamily as interFamily } from "@remotion/google-fonts/Inter";
import { getInfo as bvpInfo, fontFamily as bvpFamily } from "@remotion/google-fonts/BeVietnamPro";
import { getInfo as cascadiaInfo, fontFamily as cascadiaFamily } from "@remotion/google-fonts/CascadiaMono";
import { listStylePackIds, getStylePack } from "@news/design";

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
      const f = getStylePack(id)!.chrome.fontFamily;
      for (const stack of [f.display, f.body, f.mono]) {
        expect(loaded.has(leading(stack))).toBe(true);
      }
    }
  });

  it("clean-premium leads with Be Vietnam Pro (the Vietnamese-complete premium face)", () => {
    expect(leading(getStylePack("clean-premium")!.chrome.fontFamily.display)).toBe("Be Vietnam Pro");
  });
});
