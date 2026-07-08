import { describe, expect, it, vi } from "vitest";
import { logAuthoringFailure } from "./authoring-failure.js";

describe("logAuthoringFailure", () => {
  it("attaches failureClass while keeping the legacy message string", () => {
    const error = vi.fn();
    logAuthoringFailure(
      { error },
      { class: "admission", projectId: "p1", violationCounts: { N5: 1 } },
      "admission failed",
    );
    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0]![1]).toBe("admission failed");
    expect(error.mock.calls[0]![0]).toMatchObject({
      failureClass: "admission",
      projectId: "p1",
      violationCounts: { N5: 1 },
    });
  });

  it("can emit soft failures at warn level", () => {
    const error = vi.fn();
    const warn = vi.fn();
    logAuthoringFailure(
      { error, warn },
      { class: "image-filter-parse", projectId: "p1" },
      "image-filter JSON parse failed; using no preselection",
      "warn",
    );
    expect(warn).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
    expect(warn.mock.calls[0]![0]).toMatchObject({ failureClass: "image-filter-parse" });
  });
});
