import { AUTHORING_CONTRACT_REF, type PrepromptPayload } from "../agent/agent-worker.js";
import type { ProgressEvent, ProjectStage } from "../../shared/types.js";

export type VisualDefectInput = { sceneId: string; issue: string };
export type RenderingStage = Extract<ProjectStage, { kind: "rendering" }>;
export type RenderingStagePhase = RenderingStage["phase"];
export type RenderProgressPhase = ProgressEvent["phase"];

export function visionRepairIntent(issue: string): string {
  return (
    `Nhìn ảnh đã dựng và SỬA đúng lỗi bố cục: ${issue}\n` +
    "Quy trình: BẢO TOÀN -> VÁ ĐÚNG LỖI -> TỰ KIỂM. " +
    "Bảo toàn scene id/component id, nội dung, lời đọc, ảnh, nền, SVG/CSS, list/số liệu, motion và visual anchor đang có. " +
    "Sửa tối thiểu trên scene hiện tại: reposition/scale/spacing/font/color/chia nhóm phần tử để hết lỗi đã nêu; không mở rộng sang gu/thẩm mỹ nếu không liên quan lỗi bố cục. " +
    "Tự kiểm lại trước khi trả code: lỗi đã hết, không tạo lỗi mới, không mất dữ liệu/ảnh, không đổi ý cảnh. " +
    "KHÔNG được biến cảnh thành title-card đơn giản chỉ có eyebrow/headline/text."
  );
}

export function visionRepairPreprompt(flagged: VisualDefectInput[]): PrepromptPayload {
  return {
    contractRef: AUTHORING_CONTRACT_REF,
    affectedSceneIds: flagged.map((defect) => defect.sceneId),
    perSceneIntent: Object.fromEntries(flagged.map((defect) => [defect.sceneId, visionRepairIntent(defect.issue)])),
    globalNotes: "",
  };
}

export function renderPercentFromRatio(ratio: number): number {
  return Math.round(ratio * 100);
}

export function clampRenderRatio(ratio: number): number {
  return Math.max(0, Math.min(1, ratio));
}

export function renderingStageOf(
  phase: RenderingStagePhase,
  options: { ratio?: number; percent?: number; qaPass?: number; qaTotal?: number } = {},
): RenderingStage {
  const stage: RenderingStage = {
    kind: "rendering",
    percent: options.percent ?? renderPercentFromRatio(options.ratio ?? 0),
    phase,
  };
  if (options.qaPass !== undefined) stage.qaPass = options.qaPass;
  if (options.qaTotal !== undefined) stage.qaTotal = options.qaTotal;
  return stage;
}
