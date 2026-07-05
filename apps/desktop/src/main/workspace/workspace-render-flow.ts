import { AUTHORING_CONTRACT_REF, type PrepromptPayload } from "../agent/agent-worker.js";
import type { ProgressEvent, ProjectStage } from "../../shared/types.js";

export type VisualDefectInput = { sceneId: string; issue: string };
export type RenderingStage = Extract<ProjectStage, { kind: "rendering" }>;
export type RenderingStagePhase = RenderingStage["phase"];
export type RenderProgressPhase = ProgressEvent["phase"];

/** Refine intent for the one-shot creative bootstrap (first author only). */
export const CREATIVE_BOOTSTRAP_INTENT =
  "Nâng cảnh này theo 3 việc cụ thể, không chỉ làm đẹp mơ hồ: " +
  "(1) làm rõ một ý người xem cần nhận trong 1-2 giây đầu; " +
  "(2) thêm hoặc nhấn mạnh một visual anchor riêng cho beat này, bằng bố cục, SVG/CSS, số liệu thật, sơ đồ hoặc tương phản hình ảnh; " +
  "(3) nếu hợp với nội dung, sửa nhịp motion đúng loại: quick entrance/reveal/pop vào nhanh tự nhiên, " +
  "semantic progression dùng progress dài khi beat thật sự có quá trình, và continuous living motion như wave/pulse/signal dùng phase/period deterministic nhỏ sau khi entrance đã settle. " +
  "Giữ nguyên nội dung/ý + lời đọc của cảnh, không bịa thêm số liệu/ngày/nguồn, không đổi scene id/component id. " +
  "Đây là khuyến khích sáng tạo, KHÔNG bắt buộc mọi cảnh hay mọi phần tử phải chuyển động; cảnh tĩnh có chủ đích vẫn hợp lệ. " +
  "KHÔNG được biến cảnh thành title-card đơn giản chỉ có eyebrow/headline/text. " +
  "Nếu dùng motion, giữ nó mượt, có mục đích, deterministic và giới hạn bằng frame/spring/interpolate có clamp hoặc phase/period bounded. " +
  "KHÔNG kéo một reveal đơn giản ra hết cảnh, KHÔNG loop vô nghĩa, không layout shift lớn, không che chữ.";

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

export function renderProgressEventOf(projectId: string, ratio: number, phase: RenderProgressPhase): ProgressEvent {
  return { projectId, ratio, phase };
}
