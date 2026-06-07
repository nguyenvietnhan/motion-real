import { describe, expect, it } from "vitest";
import { makeTheme, registerStylePack, getStylePack, PRINT } from "@news/design";
import { chromeBorder, chromeBorderWidth, chromeShadow } from "./chrome.js";

/**
 * Tasks 2.11/2.12: blocks derive border/shadow from the theme's chrome tokens,
 * so a style pack actually changes the rendered look. These test the pure
 * mapping (no React render needed).
 */
describe("chrome helpers — pack-driven border/shadow", () => {
  const accent = "#2F5FF0";

  it("bold-editorial ⇒ bold 4px border + hard-offset shadow", () => {
    const t = makeTheme(accent, "bold-editorial");
    expect(chromeBorder(t)).toBe(`4px solid ${PRINT.ink}`);
    expect(chromeBorderWidth(t)).toBe(4);
    expect(chromeShadow(t, accent)).toContain("10px 10px 0");
  });

  it("clean-premium ⇒ hairline 1px border + soft diffuse shadow", () => {
    const t = makeTheme(accent, "clean-premium");
    expect(chromeBorder(t)).toBe(`1px solid ${PRINT.ink}`);
    expect(chromeBorderWidth(t)).toBe(1);
    const shadow = chromeShadow(t, accent);
    expect(shadow).not.toContain("10px 10px 0"); // not the hard-offset look
    expect(shadow).toMatch(/^0 /); // a soft, centered diffuse shadow
  });

  it("a 'none' chrome pack ⇒ no border and no shadow", () => {
    registerStylePack({
      id: "test-flat-pack",
      name: "Flat",
      description: "borderless test pack",
      chrome: {
        ...getStylePack("clean-premium")!.chrome,
        border: { width: 0, style: "none" },
        shadow: "none",
      },
    });
    const t = makeTheme(accent, "test-flat-pack");
    expect(chromeBorder(t)).toBe("none");
    expect(chromeBorderWidth(t)).toBe(0);
    expect(chromeShadow(t, accent)).toBe("none");
  });
});
