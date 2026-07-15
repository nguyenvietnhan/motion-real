import { describe, expect, it } from "vitest";
import { makeTheme } from "@motionreal/theme";
import { surfaceBorder, surfaceRadius } from "./chrome.js";

describe("surface helpers", () => {
  const t = makeTheme("#2F5FF0");

  it("hairline border from theme tokens", () => {
    expect(surfaceBorder(t)).toBe(`1px solid ${t.surface.borderColor}`);
  });

  it("sm/md/lg radius increase", () => {
    expect(surfaceRadius(t, "sm")).toBeGreaterThan(0);
    expect(surfaceRadius(t, "md")).toBeGreaterThan(surfaceRadius(t, "sm"));
    expect(surfaceRadius(t, "lg")).toBeGreaterThan(surfaceRadius(t, "md"));
  });
});
