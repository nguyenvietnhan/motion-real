import { describe, expect, it } from "vitest";
import { canStartThumbnailRender, combineIntent, linkWarningOf, stageToFriendlyStatus } from "./workspace-helpers.js";

describe("workspace helpers", () => {
  it("baseline: records current combined edit-intent prompt shape", () => {
    const combined = combineIntent("to chu tieu de", "tong mau am");

    expect(combined).toHaveLength(143);
    expect(combined.split("\n\n")).toHaveLength(2);
  });

  it("maps workspace stages to friendly gallery statuses", () => {
    expect(stageToFriendlyStatus("ready")).toBe("draft-ready");
    expect(stageToFriendlyStatus("published")).toBe("done");
    expect(stageToFriendlyStatus("error")).toBe("error");

    expect(stageToFriendlyStatus("writing")).toBe("building");
    expect(stageToFriendlyStatus("image-review")).toBe("building");
    expect(stageToFriendlyStatus("script")).toBe("building");
    expect(stageToFriendlyStatus("rendering")).toBe("building");
  });

  it("allows thumbnail rendering only when the project is idle and the renderer seam exists", () => {
    expect(canStartThumbnailRender({ isInFlight: false, hasRenderer: true })).toBe(true);
    expect(canStartThumbnailRender({ isInFlight: true, hasRenderer: true })).toBe(false);
    expect(canStartThumbnailRender({ isInFlight: false, hasRenderer: false })).toBe(false);
  });

  it("combines per-scene and global edit intent without losing either part", () => {
    expect(combineIntent("to chu tieu de", "tong mau am")).toBe(
      "Yêu cầu riêng cho cảnh này (ưu tiên): to chu tieu de\n\nGhi chú chung cho cả video (áp dụng khi phù hợp, không ghi đè yêu cầu riêng): tong mau am",
    );
    expect(combineIntent("   ", "tong mau am")).toBe("Ghi chú chung cho cả video (áp dụng cho cảnh này): tong mau am");
    expect(combineIntent("to chu tieu de", "   ")).toBe("Yêu cầu riêng cho cảnh này (ưu tiên): to chu tieu de");
    expect(combineIntent("   ", "   ")).toBe("");
  });

  it("builds unreadable-link warnings only when at least one link failed", () => {
    expect(linkWarningOf(2, [])).toBeUndefined();
    expect(linkWarningOf(2, ["https://a.example", "https://b.example"])).toBe(
      "Không đọc được 2/2 đường dẫn. Nội dung liên quan dựa trên hiểu biết của AI.",
    );
  });
});
