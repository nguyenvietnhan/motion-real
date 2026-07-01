import { describe, expect, it } from "vitest";
import { combineIntent, linkWarningOf, stageToFriendlyStatus } from "./workspace-helpers.js";

describe("workspace helpers", () => {
  it("maps workspace stages to friendly gallery statuses", () => {
    expect(stageToFriendlyStatus("ready")).toBe("draft-ready");
    expect(stageToFriendlyStatus("published")).toBe("done");
    expect(stageToFriendlyStatus("error")).toBe("error");

    expect(stageToFriendlyStatus("writing")).toBe("building");
    expect(stageToFriendlyStatus("image-review")).toBe("building");
    expect(stageToFriendlyStatus("script")).toBe("building");
    expect(stageToFriendlyStatus("rendering")).toBe("building");
  });

  it("combines per-scene and global edit intent without losing either part", () => {
    expect(combineIntent("to chu tieu de", "tong mau am")).toBe(
      "to chu tieu de\n\nGhi chú chung cho cả video: tong mau am",
    );
    expect(combineIntent("   ", "tong mau am")).toBe("Ghi chú chung cho cả video: tong mau am");
    expect(combineIntent("to chu tieu de", "   ")).toBe("to chu tieu de");
    expect(combineIntent("   ", "   ")).toBe("");
  });

  it("builds unreadable-link warnings only when at least one link failed", () => {
    expect(linkWarningOf(2, [])).toBeUndefined();
    expect(linkWarningOf(2, ["https://a.example", "https://b.example"])).toBe(
      "Không đọc được 2/2 đường dẫn. Nội dung liên quan dựa trên hiểu biết của AI.",
    );
  });
});
