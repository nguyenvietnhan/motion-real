import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  makeTheme,
  getStylePack,
  listStylePackIds,
  registerStylePack,
  DEFAULT_STYLE_PACK_ID,
  type Theme,
} from "./index.js";

/** Arbitrary 6-digit hex color. */
const arbHex = fc.integer({ min: 0, max: 0xffffff }).map((n) => `#${n.toString(16).padStart(6, "0")}`);

const PACK_IDS = listStylePackIds();

/** Theme tokens minus the `space` closure (functions aren't value-equal). */
function tokens(t: Theme): Omit<Theme, "space"> {
  const { space: _space, ...rest } = t;
  return rest;
}

// --- WCAG luminance / contrast (local, for the legibility property) -------
function lum(hex: string): number {
  const v = hex.replace("#", "");
  const ch = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
  const lin = ch.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
}
function contrast(a: string, b: string): number {
  const la = lum(a);
  const lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// Feature: tool-productization, Property 1: Default style pack
describe("makeTheme — Property 1: default style pack", () => {
  it("no stylePackId ⇒ bold-editorial chrome (existing projects unchanged)", () => {
    fc.assert(
      fc.property(arbHex, (hex) => {
        const t = makeTheme(hex);
        expect(t.stylePackId).toBe(DEFAULT_STYLE_PACK_ID);
        expect(t.stylePackId).toBe("bold-editorial");
        expect(t.chrome).toEqual(getStylePack("bold-editorial")!.chrome);
      }),
      { numRuns: 100 },
    );
  });
});

// Feature: tool-productization, Property 3: Style-pack theme determinism
describe("makeTheme — Property 3: determinism", () => {
  it("same (dominant, stylePackId) ⇒ identical tokens", () => {
    fc.assert(
      fc.property(arbHex, fc.constantFrom(...PACK_IDS), (hex, pid) => {
        expect(tokens(makeTheme(hex, pid))).toEqual(tokens(makeTheme(hex, pid)));
      }),
      { numRuns: 100 },
    );
  });
});

// Feature: tool-productization, Property 4: Base wash stays light and legible
describe("makeTheme — Property 4: base wash stays light and legible", () => {
  it("any dominant × any pack ⇒ light cream base + high text contrast (N18)", () => {
    fc.assert(
      fc.property(arbHex, fc.constantFrom(...PACK_IDS), (hex, pid) => {
        const t = makeTheme(hex, pid);
        // Base stays light (never tinted toward dark by the dominant).
        expect(lum(t.colors.bg)).toBeGreaterThan(0.6);
        // Foreground text contrast clears the N18 minimum (3:1).
        expect(contrast(t.colors.fg, t.colors.bg)).toBeGreaterThanOrEqual(3);
      }),
      { numRuns: 100 },
    );
  });
});

// Feature: tool-productization, Property 2: Unknown style pack is a hard error
describe("makeTheme — Property 2: unknown style pack throws", () => {
  it("any unregistered id ⇒ throws naming the id + the registered packs", () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 24 }).filter((s) => !PACK_IDS.includes(s)),
        (bad) => {
          expect(() => makeTheme("#2F5FF0", bad)).toThrow(/Unknown stylePackId/);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("style-pack registry", () => {
  it("ships bold-editorial + clean-premium and is extensible", () => {
    expect(PACK_IDS).toContain("bold-editorial");
    expect(PACK_IDS).toContain("clean-premium");

    registerStylePack({
      id: "test-pack-xyz",
      name: "Test",
      description: "t",
      chrome: getStylePack("clean-premium")!.chrome,
    });
    expect(listStylePackIds()).toContain("test-pack-xyz");
    expect(() => makeTheme("#2F5FF0", "test-pack-xyz")).not.toThrow();
  });

  it("clean-premium is restrained vs bold-editorial (the look actually differs)", () => {
    const bold = getStylePack("bold-editorial")!.chrome;
    const clean = getStylePack("clean-premium")!.chrome;
    expect(bold.grid).toBe(true);
    expect(clean.grid).toBe(false);
    expect(clean.registrationTicks).toBe(false);
    expect(clean.border.width).toBeLessThan(bold.border.width);
    expect(clean.accentCount).toBeLessThan(bold.accentCount);
  });
});
