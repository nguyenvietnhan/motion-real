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

  it("covers provider chat-throw anchors used by author/batch/reauthor/image-filter", () => {
    const error = vi.fn();
    const warn = vi.fn();
    const cases: Array<{ class: Parameters<typeof logAuthoringFailure>[1]["class"]; message: string; level?: "error" | "warn" }> = [
      { class: "author-reply-provider", message: "AI call failed" },
      { class: "author-batch-provider", message: "AI authoring batch call failed" },
      { class: "reauthor-provider", message: "[reauthor] AI call failed" },
      { class: "missing-tsx-recovery", message: "author-reply missing TSX recovery call failed" },
      { class: "image-filter-provider", message: "[image-filter] vision call failed; no pre-selection", level: "warn" },
      { class: "visual-qa-provider", message: "[visual-qa] vision call failed; skipping QA", level: "warn" },
    ];
    for (const row of cases) {
      error.mockClear();
      warn.mockClear();
      logAuthoringFailure({ error, warn }, { class: row.class, projectId: "p1" }, row.message, row.level ?? "error");
      const call = (row.level === "warn" ? warn : error).mock.calls[0]!;
      expect(call[1]).toBe(row.message);
      expect(call[0]).toMatchObject({ failureClass: row.class, projectId: "p1" });
    }
  });
});
