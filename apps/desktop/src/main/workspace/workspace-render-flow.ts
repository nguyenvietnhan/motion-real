import { AUTHORING_CONTRACT_REF, type PrepromptPayload } from "../agent/agent-worker.js";
import type { ProgressEvent, ProjectStage } from "../../shared/types.js";

export type VisualDefectInput = { sceneId: string; issue: string };
export type RenderingStage = Extract<ProjectStage, { kind: "rendering" }>;
export type RenderingStagePhase = RenderingStage["phase"];
export type RenderProgressPhase = ProgressEvent["phase"];

/** Refine intent for the one-shot creative bootstrap (first author only). */
export const CREATIVE_BOOTSTRAP_INTENT =
  "Làm cảnh này TÁO BẠO và ĐẸP hơn hẳn — bố cục lệch chuẩn có chủ đích, điểm nhấn mạnh, " +
  "đồ hoạ SVG/CSS tự vẽ phong phú. Coi như bản CUỐI, đừng chơi an toàn. " +
  "Khi hợp với nội dung, hãy để hình ảnh có cảm giác ĐANG DIỄN TIẾN qua phần lớn thời lượng cảnh, " +
  "không chỉ xuất hiện ở vài frame đầu rồi đứng yên. Có thể hé lộ thông tin dần, vẽ tiếp đường/nét, " +
  "dịch chuyển điểm nhấn hoặc nối vài nhịp motion nhẹ — tự chọn cách phù hợp với ý tưởng. " +
  "Đây là khuyến khích sáng tạo, KHÔNG bắt buộc mọi cảnh hay mọi phần tử phải chuyển động; cảnh tĩnh có chủ đích vẫn hợp lệ. " +
  "Nếu dùng motion, giữ nó mượt, có mục đích, deterministic và giới hạn bằng interpolate có clamp hoặc spring; " +
  "KHÔNG dùng Math.sin(frame), frame % n, interpolate không clamp hay dao động/lặp vĩnh viễn. " +
  "Giữ nguyên nội dung/ý + lời đọc của cảnh.";

export function creativeBootstrapPreprompt(sceneIds: string[]): PrepromptPayload {
  return {
    contractRef: AUTHORING_CONTRACT_REF,
    affectedSceneIds: sceneIds,
    perSceneIntent: Object.fromEntries(sceneIds.map((id) => [id, CREATIVE_BOOTSTRAP_INTENT])),
    globalNotes: "",
  };
}

export function visionRepairIntent(issue: string): string {
  return (
    `Nhìn ảnh đã dựng và SỬA đúng lỗi bố cục: ${issue}\n` +
    "Sửa tối thiểu trên scene hiện tại: giữ lại/khôi phục nền, SVG/CSS, ảnh, list/số liệu, motion và visual anchor. " +
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

export function renderProgressEventOf(projectId: string, ratio: number, phase: RenderProgressPhase): ProgressEvent {
  return { projectId, ratio, phase };
}
