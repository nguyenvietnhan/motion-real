import { describe, expect, it } from "vitest";
import { makeTheme, sceneBackground, withAlpha } from "./index.js";

describe("neutral theme", () => {
  it("accent is the project dominant hex", () => {
    expect(makeTheme("#2F5FF0").colors.accent).toBe("#2f5ff0");
    expect(makeTheme("#E8412E").colors.accent).toBe("#e8412e");
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
