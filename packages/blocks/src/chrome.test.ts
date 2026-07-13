import { describe, expect, it } from "vitest";
import { makeTheme, onColor } from "@motionreal/theme";
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
 * Surface helpers map the neutral theme's `surface`/`radius`/`colors` tokens to
 * concrete CSS. These tests cover the pure mapping (no React render): dark base,
 * hairline border, soft radius/shadow, outline chips — values come from tokens,
 * not hard-codes.
 */
describe("surface-kit — neutral theme token mapping", () => {
  const accent = "#2F5FF0";
  const t = makeTheme(accent);

  it("hairline 1px border in the theme's border color (not a fixed hex)", () => {
    expect(surfaceBorder(t)).toBe(`1px solid ${t.surface.borderColor}`);
    expect(surfaceBorderWidth(t)).toBe(1);
  });

  it("softly rounded — sm/md/lg are all positive, increasing", () => {
    expect(surfaceRadius(t, "sm")).toBeGreaterThan(0);
    expect(surfaceRadius(t, "md")).toBeGreaterThan(surfaceRadius(t, "sm"));
    expect(surfaceRadius(t, "lg")).toBeGreaterThan(surfaceRadius(t, "md"));
  });

  it("soft shadow — a diffuse depth shadow, not a hard-offset drop", () => {
    const shadow = surfaceShadow(t, accent);
    expect(shadow).not.toBe("none");
    expect(shadow).not.toContain("10px 10px 0"); // not hard-offset
  });

  it("blockSurface composes border + radius + fill + shadow from tokens", () => {
    const s = blockSurface(t, { accent });
    expect(s.border).toBe(`1px solid ${t.surface.borderColor}`);
    expect(s.borderRadius as number).toBeGreaterThan(0); // rounded
    expect(s.background).toBe(t.surface.panelFill);
    // shadow:false suppresses the shadow.
    expect(blockSurface(t, { accent, shadow: false }).boxShadow).toBe("none");
  });

  it("neutral has no top-rule bar (accent is expressed by fill/border, not a print strip)", () => {
    expect(topRuleStyle(t, accent)).toBeNull();
  });

  it("chipStyle is an outline pill (translucent tint + accent border + accent text)", () => {
    const chip = chipStyle(t, accent, onColor);
    expect(chip.color).toBe(accent);
    expect(String(chip.border)).toContain("1px solid");
    expect(chip.borderRadius as number).toBeGreaterThan(0);
  });

  it("labelStyle keeps natural case (the neutral look does not shout uppercase)", () => {
    expect(labelStyle(t).textTransform).toBe("none");
  });
});
