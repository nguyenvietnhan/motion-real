import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  ensureContrast,
  makeTheme,
  relativeLuminance,
  sceneBackground,
  withAlpha,
} from "./index.js";

describe("neutral theme", () => {
  it("accent is the project dominant hex", () => {
    expect(makeTheme("#2F5FF0").colors.accent).toBe("#2f5ff0");
    expect(makeTheme("#E8412E").colors.accent).toBe("#e8412e");
  });

  it("captionHighlight stays readable on dark bg even when dominant is near-black", () => {
    const dark = makeTheme("#0a0a0a");
    expect(dark.colors.accent).toBe("#0a0a0a");
    expect(contrastRatio(dark.colors.captionHighlight, dark.colors.bg)).toBeGreaterThanOrEqual(4.5);
    expect(relativeLuminance(dark.colors.captionHighlight)).toBeGreaterThan(relativeLuminance(dark.colors.accent));

    const bright = makeTheme("#5B8CFF");
    expect(contrastRatio(bright.colors.captionHighlight, bright.colors.bg)).toBeGreaterThanOrEqual(4.5);
  });

  it("ensureContrast lightens dark ink on dark surfaces", () => {
    const fixed = ensureContrast("#111111", "#0E0F13", 4.5);
    expect(contrastRatio(fixed, "#0E0F13")).toBeGreaterThanOrEqual(4.5);
  });

  it("withAlpha builds rgba", () => {
    expect(withAlpha("#112233", 0.5)).toBe("rgba(17, 34, 51, 0.5)");
  });

  it("sceneBackground is a layered CSS gradient string", () => {
    const bg = sceneBackground(makeTheme());
    expect(bg).toContain("radial-gradient");
    expect(bg).toContain("linear-gradient");
  });
});
