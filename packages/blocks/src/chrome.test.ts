import { describe, expect, it } from "vitest";
import { makeTheme, registerStylePack, getStylePack, onColor } from "@news/design";
import {
  surfaceBorder,
  surfaceBorderWidth,
  surfaceShadow,
  surfaceRadius,
  blockSurface,
  topRuleStyle,
  chipStyle,
  labelStyle,
} from "./chrome.js";

/**
 * The block SURFACE-KIT maps a resolved language's `surface`/`radius`/`colors`
 * tokens to concrete CSS, so ONE set of blocks renders EVERY design language.
 * These test the pure mapping (no React render needed): editorial (bold squared
 * print) and galaxy (rounded glowing dark) must produce genuinely different
 * surfaces from the same call, proving the look is token-driven, not hardcoded.
 */
describe("surface-kit — language-driven border/radius/shadow", () => {
  const accent = "#2F5FF0";

  it("bold-editorial ⇒ bold 4px ink border, squared, hard-offset shadow", () => {
    const t = makeTheme(accent, "bold-editorial");
    // Border color follows the language (its own borderColor token), not a fixed hex.
    expect(surfaceBorder(t)).toBe(`4px solid ${t.surface.borderColor}`);
    expect(surfaceBorderWidth(t)).toBe(4);
    expect(surfaceRadius(t, "md")).toBe(0); // squared
    expect(surfaceShadow(t, accent)).toContain("10px 10px 0"); // print drop
  });

  it("galaxy ⇒ hairline border, rounded, neon glow shadow", () => {
    const t = makeTheme(accent, "galaxy");
    expect(surfaceBorderWidth(t)).toBe(1);
    expect(surfaceRadius(t, "md")).toBeGreaterThan(0); // rounded
    expect(surfaceRadius(t, "sm")).toBeGreaterThan(0);
    const shadow = surfaceShadow(t, accent);
    expect(shadow).not.toContain("10px 10px 0"); // not the hard-offset print drop
    expect(shadow).toContain("24px"); // a soft neon glow + depth
  });

  it("blockSurface composes border + radius + fill + shadow from tokens", () => {
    const bold = makeTheme(accent, "bold-editorial");
    const galaxy = makeTheme(accent, "galaxy");
    const boldS = blockSurface(bold, { accent });
    const galaxyS = blockSurface(galaxy, { accent });
    // Editorial is squared; galaxy is rounded — the same call yields different geometry.
    expect(boldS.borderRadius).toBe(0);
    expect(galaxyS.borderRadius as number).toBeGreaterThan(0);
    // shadow:false suppresses the shadow regardless of language.
    expect(blockSurface(galaxy, { accent, shadow: false }).boxShadow).toBe("none");
  });

  it("topRuleStyle is present on editorial (solid bar) and absent on galaxy (glow expresses accent)", () => {
    const bold = makeTheme(accent, "bold-editorial");
    const galaxy = makeTheme(accent, "galaxy");
    expect(topRuleStyle(bold, accent)).not.toBeNull();
    expect(topRuleStyle(galaxy, accent)).toBeNull();
  });

  it("chipStyle is a solid fill on editorial, an outline pill on galaxy", () => {
    const bold = makeTheme(accent, "bold-editorial");
    const galaxy = makeTheme(accent, "galaxy");
    const boldChip = chipStyle(bold, accent, onColor);
    const galaxyChip = chipStyle(galaxy, accent, onColor);
    // Editorial: solid accent fill, readable text on it.
    expect(boldChip.background).toBe(accent);
    expect(boldChip.color).toBe(onColor(accent));
    // Galaxy: translucent tint + accent border + accent text (outline).
    expect(galaxyChip.color).toBe(accent);
    expect(String(galaxyChip.border)).toContain("1px solid");
    expect(galaxyChip.borderRadius as number).toBeGreaterThan(0);
  });

  it("labelStyle shouts uppercase on editorial, keeps natural case on galaxy", () => {
    expect(labelStyle(makeTheme(accent, "bold-editorial")).textTransform).toBe("uppercase");
    expect(labelStyle(makeTheme(accent, "galaxy")).textTransform).toBe("none");
  });

  it("a borderless language ⇒ no border, and blockSurface still composes", () => {
    // Register a derived language whose surface has no border + no shadow, to
    // prove the kit degrades cleanly (the Open/Closed extensibility seam).
    const base = getStylePack("galaxy")!;
    registerStylePack({
      ...base,
      id: "test-flat-lang",
      name: "Flat",
      description: "borderless test language",
      derive: (dominant: string) => {
        const d = base.derive(dominant);
        return { ...d, surface: { ...d.surface, borderWidth: 0, shadowStyle: "none" } };
      },
    });
    const t = makeTheme(accent, "test-flat-lang");
    expect(surfaceBorder(t)).toBe("none");
    expect(surfaceBorderWidth(t)).toBe(0);
    expect(surfaceShadow(t, accent)).toBe("none");
  });
});
