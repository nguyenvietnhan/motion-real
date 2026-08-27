import { describe, expect, it, vi } from "vitest";
import { routeSceneEdits } from "./route-scene-edits.js";

function deps(draft: { id: string } | null) {
  return {
    draftForProject: vi.fn(async () => draft),
    activate: vi.fn(async (id: string) => ({ id })),
    beginHarness: vi.fn(),
    requestHarness: vi.fn(async () => undefined),
    restoreHarnessReview: vi.fn(async () => undefined),
    submitClassic: vi.fn(),
  };
}

describe("routeSceneEdits", () => {
  it("keeps Classic projects on the existing edit flow", async () => {
    const d = deps(null);
    await routeSceneEdits("classic", [{ sceneId: "scene-01", text: "To chữ" }], "", d);
    expect(d.submitClassic).toHaveBeenCalledOnce();
    expect(d.requestHarness).not.toHaveBeenCalled();
  });

  it("routes Harness projects only to their Harness session", async () => {
    const d = deps({ id: "agent-1" });
    const edits = [{ sceneId: "scene-01", text: "Bỏ khung" }];
    await routeSceneEdits("harness", edits, "Giữ tối giản", d);
    expect(d.activate).toHaveBeenCalledWith("agent-1");
    expect(d.beginHarness).toHaveBeenCalledWith("harness");
    expect(d.requestHarness).toHaveBeenCalledWith("agent-1", "harness", edits, "Giữ tối giản");
    expect(d.submitClassic).not.toHaveBeenCalled();
  });

  it("restores human review when Harness rejects the request", async () => {
    const d = deps({ id: "agent-1" });
    d.requestHarness.mockRejectedValueOnce(new Error("invalid edit"));
    await expect(routeSceneEdits("harness", [], "", d)).rejects.toThrow("invalid edit");
    expect(d.restoreHarnessReview).toHaveBeenCalledWith("harness");
    expect(d.submitClassic).not.toHaveBeenCalled();
  });
});
