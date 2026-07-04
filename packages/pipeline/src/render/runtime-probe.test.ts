import { describe, expect, it, vi } from "vitest";
import type { LockedVideoSpec } from "@motionreal/schema";

const mocks = vi.hoisted(() => ({
  renderSceneRuntimeProbe: vi.fn(),
}));

vi.mock("./renderer.js", () => ({
  renderSceneRuntimeProbe: mocks.renderSceneRuntimeProbe,
}));

import { checkSceneRuntimeErrors } from "./runtime-probe.js";

describe("checkSceneRuntimeErrors", () => {
  it("maps strict render failures to N31 scene-targeted safety issues", async () => {
    const spec = { scenes: [] } as unknown as LockedVideoSpec;
    mocks.renderSceneRuntimeProbe.mockResolvedValue([
      {
        sceneId: "scene-03",
        frame: 255,
        message: "inputRange must be strictly monotonically increasing",
      },
    ]);

    const report = await checkSceneRuntimeErrors(spec, { projectRoot: "project-root" });

    expect(report.ok).toBe(false);
    expect(report.ranTiers).toEqual(["render"]);
    expect(report.issues).toEqual([
      {
        check: "N31",
        severity: "error",
        sceneId: "scene-03",
        path: "frame:255",
        message: expect.stringContaining("inputRange"),
      },
    ]);
    expect(mocks.renderSceneRuntimeProbe).toHaveBeenCalledWith(spec, { projectRoot: "project-root" });
  });
});
