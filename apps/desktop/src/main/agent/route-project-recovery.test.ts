import { describe, expect, it, vi } from "vitest";
import type { AgentProductionState, ProjectStage } from "../../shared/types.js";
import { routeProjectRecovery } from "./route-project-recovery.js";

function deps(stage: ProjectStage, productionState: AgentProductionState = "still_review") {
  return {
    draftForProject: vi.fn(async (): Promise<{ productionState: AgentProductionState } | null> => ({ productionState })),
    stage: vi.fn(async () => stage),
    resumeHarnessRender: vi.fn(async () => undefined),
    editHarness: vi.fn(async () => undefined),
    publish: vi.fn(), classic: vi.fn(),
  };
}

describe("project recovery ownership", () => {
  it.each(["retry", "fix", "approve"] as const)("leaves Classic %s unchanged", async (action) => {
    const d = deps({ kind: "script", lines: [] });
    d.draftForProject.mockResolvedValue(null);
    await routeProjectRecovery("classic", action, d);
    expect(d.classic).toHaveBeenCalledWith("classic", action);
    expect(d.resumeHarnessRender).not.toHaveBeenCalled();
    expect(d.editHarness).not.toHaveBeenCalled();
  });

  it.each(["retry", "fix"] as const)("%s on Harness draft infrastructure failure only rerenders", async (action) => {
    const d = deps({ kind: "error", message: "TTS unavailable", fixable: false, retry: "draft" });
    await routeProjectRecovery("p", action, d);
    expect(d.resumeHarnessRender).toHaveBeenCalledWith("p");
    expect(d.classic).not.toHaveBeenCalled();
    expect(d.editHarness).not.toHaveBeenCalled();
  });

  it.each(["draft", "full"] as const)("sends fixable %s errors back to Harness", async (retry) => {
    const d = deps({ kind: "error", message: "Scene bị lỗi", fixable: true, retry });
    await routeProjectRecovery("p", "fix", d);
    expect(d.editHarness).toHaveBeenCalledWith("p", expect.stringContaining("Scene bị lỗi"));
    expect(d.classic).not.toHaveBeenCalled();
    expect(d.publish).not.toHaveBeenCalled();
  });

  it("retries full infrastructure failure without rendering another draft", async () => {
    const d = deps({ kind: "error", message: "TTS unavailable", fixable: false, retry: "full" });
    await routeProjectRecovery("p", "retry", d);
    expect(d.publish).toHaveBeenCalledWith("p");
    expect(d.resumeHarnessRender).not.toHaveBeenCalled();
    expect(d.classic).not.toHaveBeenCalled();
  });

  it("refuses recovery before Harness image review has been accepted", async () => {
    const d = deps({ kind: "script", lines: [] }, "authoring");
    await expect(routeProjectRecovery("p", "approve", d)).rejects.toThrow("hoàn tất review ảnh");
    expect(d.classic).not.toHaveBeenCalled();
    expect(d.resumeHarnessRender).not.toHaveBeenCalled();
  });

  it.each([
    { kind: "rendering", phase: "draft", percent: 2 },
    { kind: "writing", phase: "author" },
    { kind: "published", outputPath: "video.mp4" },
    { kind: "ready", scenes: [] },
  ] satisfies ProjectStage[])("does not restart work in $kind", async (stage) => {
    const d = deps(stage);
    await routeProjectRecovery("p", "retry", d);
    expect(d.classic).not.toHaveBeenCalled();
    expect(d.resumeHarnessRender).not.toHaveBeenCalled();
    expect(d.editHarness).not.toHaveBeenCalled();
  });

  it("ownership lookup failure never falls back to Classic", async () => {
    const d = deps({ kind: "script", lines: [] });
    d.draftForProject.mockRejectedValue(new Error("metadata unavailable"));
    await expect(routeProjectRecovery("p", "retry", d)).rejects.toThrow("metadata unavailable");
    expect(d.classic).not.toHaveBeenCalled();
  });
});
