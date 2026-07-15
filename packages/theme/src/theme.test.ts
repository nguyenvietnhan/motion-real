import { describe, expect, it } from "vitest";
import { makeTheme, DEFAULT_DOMINANT, NEUTRAL_THEME_ID, sceneBackground, withAlpha } from "./index.js";

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

  it("accent is the project dominant hex", () => {
    expect(makeTheme("#2F5FF0").colors.accent).toBe("#2f5ff0");
    expect(makeTheme("#E8412E").colors.accent).toBe("#e8412e");
  });

  it("surface border tokens are set", () => {
    expect(t.surface.borderWidth).toBe(1);
    expect(t.surface.borderColor).toMatch(/^#/);
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
