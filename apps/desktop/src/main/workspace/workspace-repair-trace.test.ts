import { describe, expect, it } from "vitest";
import { WorkspaceRepairTrace } from "./workspace-repair-trace.js";

describe("WorkspaceRepairTrace", () => {
  it("does not label resolved until the final draft passes", () => {
    const trace = new WorkspaceRepairTrace();
    trace.noteRepair({ sceneId: "scene-01", message: "đã chỉnh" });
    expect(trace.finalize("exhausted").map((e) => e.type)).toEqual([
      "repair.attempted",
      "repair.unresolved",
    ]);
  });

  it("records reverted, not applied, after rollback", () => {
    const trace = new WorkspaceRepairTrace();
    trace.noteRepair({ sceneId: "scene-02", message: "x" });
    expect(trace.finalize("reverted").map((e) => e.type)).toEqual([
      "repair.attempted",
      "repair.reverted",
    ]);
  });

  it("records resolved only on passed", () => {
    const trace = new WorkspaceRepairTrace();
    trace.noteRepair({ message: "x" });
    expect(trace.finalize("passed").map((e) => e.type)).toEqual([
      "repair.attempted",
      "repair.resolved",
    ]);
  });

  it("returns no events when no repair hook fired", () => {
    expect(new WorkspaceRepairTrace().finalize("passed")).toEqual([]);
  });

  it("drops invalid scene ids", () => {
    const trace = new WorkspaceRepairTrace();
    trace.noteRepair({ sceneId: "../hack", message: "x" });
    const events = trace.finalize("passed");
    expect(events[0]).toEqual({ type: "repair.attempted" });
  });
});
