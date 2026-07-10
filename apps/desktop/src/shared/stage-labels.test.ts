import { describe, expect, it } from "vitest";
import {
  renderingPhaseIndeterminate,
  renderingPhaseLabel,
  renderingPhaseParts,
  workspaceStageTitle,
  writingPhaseCopy,
} from "./stage-labels.js";

describe("stage-labels", () => {
  it("covers every rendering phase with stable Vietnamese copy", () => {
    expect(renderingPhaseLabel("edit")).toBe("AI đang chỉnh sửa các cảnh theo yêu cầu…");
    expect(renderingPhaseLabel("qa", { qaPass: 2, qaTotal: 5 })).toBe(
      "AI đang soát lỗi hình ảnh (lần 2/5)…",
    );
    expect(renderingPhaseLabel("qa", { qaPass: 10, qaTotal: 20 })).toBe(
      "AI đang soát lỗi hình ảnh (lần 10/20)…",
    );
    expect(renderingPhaseLabel("prepare")).toBe("Đang dựng bản nháp…");
    expect(renderingPhaseLabel("full")).toBe("Đang dựng video bản đầy đủ (chất lượng cao)…");
    expect(renderingPhaseLabel("draft")).toBe("Đang dựng giọng đọc + bản nháp…");
    expect(renderingPhaseLabel(undefined)).toBe("Đang dựng giọng đọc + bản nháp…");
  });

  it("splits QA count so the UI can keep (lần N/M) nowrap", () => {
    expect(renderingPhaseParts("qa", { qaPass: 1, qaTotal: 1 })).toEqual({
      body: "AI đang soát lỗi hình ảnh",
      count: "(lần 1/1)",
    });
    expect(renderingPhaseParts("draft")).toEqual({
      body: "Đang dựng giọng đọc + bản nháp…",
    });
  });

  it("marks edit/qa/prepare and zero-percent as indeterminate", () => {
    expect(renderingPhaseIndeterminate("edit", 50)).toBe(true);
    expect(renderingPhaseIndeterminate("qa", 50)).toBe(true);
    expect(renderingPhaseIndeterminate("prepare", 50)).toBe(true);
    expect(renderingPhaseIndeterminate("draft", 0)).toBe(true);
    expect(renderingPhaseIndeterminate("draft", 40)).toBe(false);
    expect(renderingPhaseIndeterminate("full", 80)).toBe(false);
  });

  it("covers every writing phase copy", () => {
    expect(writingPhaseCopy("crawl").title).toContain("cào ảnh");
    expect(writingPhaseCopy("image-filter").title).toContain("chọn ảnh");
    expect(writingPhaseCopy("author").title).toContain("kịch bản");
    expect(writingPhaseCopy(undefined).title).toContain("kịch bản");
  });

  it("covers every workspace stage chrome title", () => {
    expect(workspaceStageTitle("writing")).toBe("Đang viết kịch bản");
    expect(workspaceStageTitle("script")).toBe("Duyệt kịch bản");
    expect(workspaceStageTitle("image-review")).toBe("Duyệt ảnh");
    expect(workspaceStageTitle("rendering")).toBe("Đang dựng video");
    expect(workspaceStageTitle("ready")).toBe("Duyệt cảnh");
    expect(workspaceStageTitle("published")).toBe("Đã xuất bản");
    expect(workspaceStageTitle("error")).toBe("Gặp lỗi");
  });
});
