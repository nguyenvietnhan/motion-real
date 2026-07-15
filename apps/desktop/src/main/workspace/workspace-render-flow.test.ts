import { describe, expect, it } from "vitest";
import { AUTHORING_CONTRACT_REF } from "../agent/agent-worker.js";
import {
  CREATIVE_BOOTSTRAP_INTENT,
  clampRenderRatio,
  creativeBootstrapPreprompt,
  renderPercentFromRatio,
  renderingStageOf,
  visionRepairIntent,
  visionRepairPreprompt,
} from "./workspace-render-flow.js";

const BOOTSTRAP_REQUIRED = [
  /3 việc cụ thể/,
  /visual anchor riêng/,
  /không chỉ làm đẹp mơ hồ/,
  /quick entrance\/reveal\/pop/,
  /semantic progression/,
  /continuous living motion/,
  /phase\/period deterministic/,
  /không bịa thêm số liệu/,
  /không đổi scene id\/component id/,
  /khuyến khích sáng tạo, KHÔNG bắt buộc/,
  /cảnh tĩnh có chủ đích vẫn hợp lệ/,
  /KHÔNG được biến cảnh thành title-card/,
  /frame\/spring\/interpolate có clamp hoặc phase\/period bounded/,
  /KHÔNG kéo một reveal đơn giản ra hết cảnh/,
];

const BOOTSTRAP_FORBIDDEN = [
  /ĐANG DIỄN TIẾN qua phần lớn thời lượng/,
  /KHÔNG dùng Math\.sin\(frame\)/,
  /ANIMATION PHẢI|NHIỀU PHA|chuyển động LIÊN TỤC|mạch đập|nhịp thở chậm/,
];

describe("workspace render-flow helpers", () => {
  it("keeps the creative bootstrap intent guard phrases", () => {
    for (const p of BOOTSTRAP_REQUIRED) expect(CREATIVE_BOOTSTRAP_INTENT).toMatch(p);
    for (const p of BOOTSTRAP_FORBIDDEN) expect(CREATIVE_BOOTSTRAP_INTENT).not.toMatch(p);
  });

  it("maps every scene to the creative bootstrap intent", () => {
    expect(creativeBootstrapPreprompt(["scene-01", "scene-02"])).toEqual({
      contractRef: AUTHORING_CONTRACT_REF,
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
    expect(intent).toMatch(/BẢO TOÀN/);
    expect(intent).toMatch(/VÁ ĐÚNG LỖI/);
    expect(intent).toMatch(/TỰ KIỂM/);
    expect(intent).toMatch(/Sửa tối thiểu/);
    expect(intent).toMatch(/visual anchor/);
    expect(intent).toMatch(/không mở rộng sang gu\/thẩm mỹ/);
    expect(intent).toMatch(/KHÔNG được biến cảnh thành title-card/);
  });

  it("maps flagged visual defects by scene id", () => {
    expect(
      visionRepairPreprompt([
        { sceneId: "scene-02", issue: "ảnh lệch khỏi khung" },
        { sceneId: "scene-01", issue: "headline bị che" },
      ]),
    ).toEqual({
      contractRef: AUTHORING_CONTRACT_REF,
      affectedSceneIds: ["scene-02", "scene-01"],
      perSceneIntent: {
        "scene-02": visionRepairIntent("ảnh lệch khỏi khung"),
        "scene-01": visionRepairIntent("headline bị che"),
      },
      globalNotes: "",
    });
  });

  it("maps render-hook ratios to rounded percents without clamping", () => {
    expect(renderPercentFromRatio(0)).toBe(0);
    expect(renderPercentFromRatio(0.424)).toBe(42);
    expect(renderPercentFromRatio(0.425)).toBe(43);
    expect(renderPercentFromRatio(1.2)).toBe(120);
    expect(renderPercentFromRatio(-0.2)).toBe(-20);
  });

  it("clamps forwarded real-render ratios before stage mapping", () => {
    expect(clampRenderRatio(-0.25)).toBe(0);
    expect(clampRenderRatio(0.5)).toBe(0.5);
    expect(clampRenderRatio(1.25)).toBe(1);
  });

  it("builds rendering stages with phase and optional QA pass metadata", () => {
    expect(renderingStageOf("draft", { ratio: 0.425 })).toEqual({ kind: "rendering", percent: 43, phase: "draft" });
    expect(renderingStageOf("qa", { percent: 0, qaPass: 1, qaTotal: 2 })).toEqual({
      kind: "rendering",
      percent: 0,
      phase: "qa",
      qaPass: 1,
      qaTotal: 2,
    });
  });
});
