import { describe, expect, it } from "vitest";
import { makeTheme, DEFAULT_DOMINANT, PRINT, NEUTRAL_THEME_ID, sceneBackground, withAlpha } from "./index.js";

describe("neutral theme", () => {
  const t = makeTheme(DEFAULT_DOMINANT);

  it("is dark neutral with render-safe fonts", () => {
    expect(t.id).toBe(NEUTRAL_THEME_ID);
    expect(t.dark).toBe(true);
    expect(t.fonts.display).toBe("Inter");
    expect(t.fonts.mono).toBe("Cascadia Mono");
  });

  it("radius sm < md < lg", () => {
    expect(t.radius.sm).toBeGreaterThan(0);
    expect(t.radius.md).toBeGreaterThan(t.radius.sm);
    expect(t.radius.lg).toBeGreaterThan(t.radius.md);
  });

  it("accent follows dominant hue", () => {
    expect(makeTheme("#2F5FF0").colors.accent).not.toBe(makeTheme("#E8412E").colors.accent);
  });

  it("exposes semantic PRINT accents", () => {
    expect(t.colors.red).toBe(PRINT.red);
    expect(t.colors.blue).toBe(PRINT.blue);
  });

  it("surface chrome tokens are set", () => {
    expect(t.surface.borderWidth).toBe(1);
    expect(t.surface.borderColor).toMatch(/^#/);
    expect(t.surface.panelFill).toMatch(/^#/);
  });

  it("caption divider paint is off by default", () => {
    expect(t.backdrop.divider).toBe(false);
  });
});

describe("helpers", () => {
  it("withAlpha builds rgba", () => {
    expect(withAlpha("#112233", 0.5)).toBe("rgba(17, 34, 51, 0.5)");
  });

  it("sceneBackground is a layered CSS gradient string", () => {
    const bg = sceneBackground(makeTheme());
    expect(bg).toContain("radial-gradient");
    expect(bg).toContain("linear-gradient");
  });
});
