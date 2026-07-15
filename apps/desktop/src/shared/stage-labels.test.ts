import { describe, expect, it } from "vitest";
import {
  renderingPhaseIndeterminate,
  renderingPhaseLabel,
  renderingPhaseParts,
  workspaceStageTitle,
  writingPhaseCopy,
} from "./stage-labels.js";

describe("stage-labels", () => {
  it("covers rendering phase labels, parts, and indeterminate rules", () => {
    expect(renderingPhaseLabel("edit")).toBe("Đang sửa cảnh…");
    expect(renderingPhaseLabel("qa", { qaPass: 2, qaTotal: 5 })).toBe("Đang tinh chỉnh ảnh (2/5)…");
    expect(renderingPhaseLabel("prepare")).toBe("Đang chuẩn bị…");
    expect(renderingPhaseLabel("full")).toBe("Đang xuất bản…");
    expect(renderingPhaseLabel("draft")).toBe("Đang dựng nháp…");
    expect(renderingPhaseLabel(undefined)).toBe("Đang dựng nháp…");
    expect(renderingPhaseParts("qa", { qaPass: 1, qaTotal: 1 })).toEqual({
      body: "Đang tinh chỉnh ảnh",
      count: "(1/1)",
    });
    expect(renderingPhaseParts("draft")).toEqual({ body: "Đang dựng nháp…" });
    expect(renderingPhaseIndeterminate("edit", 50)).toBe(true);
    expect(renderingPhaseIndeterminate("qa", 50)).toBe(true);
    expect(renderingPhaseIndeterminate("prepare", 50)).toBe(true);
    expect(renderingPhaseIndeterminate("draft", 0)).toBe(true);
    expect(renderingPhaseIndeterminate("draft", 40)).toBe(false);
    expect(renderingPhaseIndeterminate("full", 80)).toBe(false);
  });

  it("covers writing phase copy and workspace stage titles", () => {
    expect(writingPhaseCopy("crawl")).toContain("ảnh");
    expect(writingPhaseCopy("image-filter")).toContain("ảnh");
    expect(writingPhaseCopy("author")).toContain("kịch bản");
    expect(writingPhaseCopy(undefined)).toContain("kịch bản");
    expect(workspaceStageTitle("writing")).toBe("Đang viết");
    expect(workspaceStageTitle("script")).toBe("Kịch bản");
    expect(workspaceStageTitle("image-review")).toBe("Duyệt ảnh");
    expect(workspaceStageTitle("rendering")).toBe("Đang dựng");
    expect(workspaceStageTitle("ready")).toBe("Duyệt");
    expect(workspaceStageTitle("draft-recovery")).toBe("Khôi phục");
    expect(workspaceStageTitle("published")).toBe("Đã xong");
    expect(workspaceStageTitle("error")).toBe("Lỗi");
  });
});

