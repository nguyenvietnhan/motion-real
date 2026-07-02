import { describe, expect, it } from "vitest";
import {
  CREATIVE_BOOTSTRAP_INTENT,
  creativeBootstrapPreprompt,
  visionRepairIntent,
  visionRepairPreprompt,
} from "./workspace-render-flow.js";

describe("workspace render-flow helpers", () => {
  it("keeps the creative bootstrap intent guard phrases", () => {
    expect(CREATIVE_BOOTSTRAP_INTENT).toMatch(/ĐANG DIỄN TIẾN qua phần lớn thời lượng/);
    expect(CREATIVE_BOOTSTRAP_INTENT).toMatch(/khuyến khích sáng tạo, KHÔNG bắt buộc/);
    expect(CREATIVE_BOOTSTRAP_INTENT).toMatch(/cảnh tĩnh có chủ đích vẫn hợp lệ/);
    expect(CREATIVE_BOOTSTRAP_INTENT).toMatch(/interpolate có clamp hoặc spring/);
    expect(CREATIVE_BOOTSTRAP_INTENT).toMatch(/KHÔNG dùng Math\.sin\(frame\)/);
    expect(CREATIVE_BOOTSTRAP_INTENT).not.toMatch(/ANIMATION PHẢI|NHIỀU PHA|chuyển động LIÊN TỤC|mạch đập|nhịp thở chậm/);
  });

  it("maps every scene to the creative bootstrap intent", () => {
    expect(creativeBootstrapPreprompt(["scene-01", "scene-02"])).toEqual({
      contractRef: "SKILL.md+AGENTS.md",
      affectedSceneIds: ["scene-01", "scene-02"],
      perSceneIntent: {
        "scene-01": CREATIVE_BOOTSTRAP_INTENT,
        "scene-02": CREATIVE_BOOTSTRAP_INTENT,
      },
      globalNotes: "",
    });
  });

  it("keeps the vision repair minimal-fix and title-card guard language", () => {
    const intent = visionRepairIntent("chữ đè lên nhau");

    expect(intent).toContain("Nhìn ảnh đã dựng và SỬA đúng lỗi bố cục: chữ đè lên nhau");
    expect(intent).toMatch(/Sửa tối thiểu/);
    expect(intent).toMatch(/giữ lại\/khôi phục nền/);
    expect(intent).toMatch(/visual anchor/);
    expect(intent).toMatch(/KHÔNG được biến cảnh thành title-card/);
  });

  it("maps flagged visual defects by scene id", () => {
    expect(
      visionRepairPreprompt([
        { sceneId: "scene-02", issue: "ảnh lệch khỏi khung" },
        { sceneId: "scene-01", issue: "headline bị che" },
      ]),
    ).toEqual({
      contractRef: "SKILL.md+AGENTS.md",
      affectedSceneIds: ["scene-02", "scene-01"],
      perSceneIntent: {
        "scene-02": visionRepairIntent("ảnh lệch khỏi khung"),
        "scene-01": visionRepairIntent("headline bị che"),
      },
      globalNotes: "",
    });
  });
});
