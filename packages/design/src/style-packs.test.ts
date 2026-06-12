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
describe("makeTheme — Property 1: default design language", () => {
  it("no stylePackId ⇒ the default language (bold-editorial); existing projects unchanged", () => {
    fc.assert(
      fc.property(arbHex, (hex) => {
        const t = makeTheme(hex);
        expect(t.stylePackId).toBe(DEFAULT_STYLE_PACK_ID);
        expect(t.stylePackId).toBe("bold-editorial");
        // The default language's surface grammar carries through to the theme.
        expect(t.surface).toEqual(getStylePack("bold-editorial")!.derive(hex).surface);
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

// Feature: tool-productization, Property 4: Base stays on-polarity and legible
// A language's base polarity is its own; the dominant never flips it. EITHER
// way fg/bg must clear the N18 contrast floor.
describe("makeTheme — Property 4: base stays on-polarity and legible", () => {
  it("any dominant × any pack ⇒ correct polarity base + high text contrast (N18)", () => {
    fc.assert(
      fc.property(arbHex, fc.constantFrom(...PACK_IDS), (hex, pid) => {
        const t = makeTheme(hex, pid);
        if (t.dark) {
          // Dark language: a deep base, never lightened toward a light wash.
          expect(lum(t.colors.bg)).toBeLessThan(0.2);
        } else {
          // Light language: the cream wash, never tinted toward dark.
          expect(lum(t.colors.bg)).toBeGreaterThan(0.6);
        }
        // Foreground text contrast clears the N18 minimum (3:1) on either base.
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

describe("design-language registry", () => {
  it("ships bold-editorial + galaxy and is extensible", () => {
    expect(PACK_IDS).toContain("bold-editorial");
    expect(PACK_IDS).toContain("galaxy");

    registerStylePack({
      ...getStylePack("galaxy")!,
      id: "test-pack-xyz",
      name: "Test",
      description: "t",
    });
    expect(listStylePackIds()).toContain("test-pack-xyz");
    expect(() => makeTheme("#2F5FF0", "test-pack-xyz")).not.toThrow();
  });

  it("galaxy is a distinct dark/rounded language vs bold-editorial (the look actually differs)", () => {
    const bold = makeTheme("#2F5FF0", "bold-editorial");
    const galaxy = makeTheme("#2F5FF0", "galaxy");

    // Polarity: editorial is light, galaxy is dark.
    expect(bold.dark).toBe(false);
    expect(galaxy.dark).toBe(true);

    // Geometry: editorial is squared (radius 0), galaxy is rounded (radius > 0).
    expect(bold.radius.md).toBe(0);
    expect(galaxy.radius.md).toBeGreaterThan(0);
    expect(galaxy.radius.sm).toBeGreaterThan(0);
    expect(galaxy.radius.lg).toBeGreaterThan(0);

    // Surface grammar: editorial = thick border + hard-offset + solid top-rule +
    // solid chips + shouty uppercase. Galaxy = hairline + glow + no top-rule +
    // outline chips + natural case.
    expect(bold.surface.borderWidth).toBeGreaterThan(galaxy.surface.borderWidth);
    expect(bold.surface.shadowStyle).toBe("hard-offset");
    expect(galaxy.surface.shadowStyle).toBe("glow");
    expect(bold.surface.topRule).toBe(true);
    expect(galaxy.surface.topRule).toBe(false);
    expect(bold.surface.chipStyle).toBe("solid");
    expect(galaxy.surface.chipStyle).toBe("outline");
    expect(bold.surface.labelUppercase).toBe(true);
    expect(galaxy.surface.labelUppercase).toBe(false);

    // Backdrop: editorial = grid + registration ticks; galaxy = starfield.
    expect(bold.backdrop.grid).toBe(true);
    expect(bold.backdrop.registrationTicks).toBe(true);
    expect(galaxy.backdrop.starfield).toBe(true);
    expect(galaxy.backdrop.grid).toBe(false);

    // Fonts actually differ (different typographic identity, not just color).
    expect(bold.fonts.display).not.toBe(galaxy.fonts.display);
  });
});

// The caption scrim is a CHROME token (the "outfit"): a language may draw a faint
// plate behind the caption. It is part of the language, not the layout — every
// language shares one caption band (zones live in @news/schema).
describe("makeTheme — caption scrim folds into the theme", () => {
  it("bold-editorial ⇒ NO caption scrim (classic look draws on the cream base)", () => {
    const t = makeTheme("#2F5FF0", "bold-editorial");
    expect(t.captionScrim).toBeUndefined();
  });

  it("galaxy ⇒ a faint dark caption scrim", () => {
    const t = makeTheme("#2F5FF0", "galaxy");
    expect(t.captionScrim).toBeDefined();
    expect(t.captionScrim!.opacity).toBeGreaterThan(0);
    expect(t.captionScrim!.tone).toBe("dark");
  });
});
