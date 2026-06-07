import type { PipelineStage, SerializedPipelineError, SafetyIssue } from "@news/pipeline";
import type { FriendlyError, FriendlyFix } from "../../shared/types.js";

/**
 * The main-process redaction boundary (web-dashboard Task 4.17, design §Error
 * Handling). This is the ONLY place engine failures become user-facing, and the
 * ONLY error/fix shape allowed to cross IPC. Messages are built from a fixed
 * Vietnamese plain-language catalog keyed by stage/issue — engine text is NEVER
 * echoed — and the result is additionally swept for L0 tokens (N1–N30 codes,
 * `.tsx`, MCP, JSON braces, stack frames) so none can leak (Property 6,
 * Req 6.8/11.5/11.6/12.2).
 */

const GENERIC = "Đã xảy ra sự cố. Vui lòng thử lại.";

/** Defense-in-depth: strip any L0 internal token from a final message. */
export function stripL0Tokens(text: string): string {
  const cleaned = text
    .replace(/\bN(?:[1-9]|[12]\d|30)\b/g, "") // N1..N30 grid codes
    .replace(/[\w./\\-]+\.tsx\b/gi, "") // authored .tsx source files
    .replace(/\bMCP\b/gi, "") // MCP references
    .replace(/\bat\s+[^\n]+:\d+:\d+/g, "") // stack frames "at fn (file:line:col)"
    .replace(/[{}[\]]/g, "") // manifest JSON braces
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned;
}

const STAGE_MESSAGE: Record<PipelineStage, string> = {
  ingest: "Không lấy được nội dung từ nguồn bạn cung cấp. Hãy kiểm tra lại đường dẫn hoặc thử nguồn khác.",
  admission: "Một cảnh chưa hợp lệ nên hệ thống đang dựng lại.",
  "static-grid": "Một vài cảnh cần chỉnh lại bố cục trước khi dựng.",
  "build-gate": "Video chưa sẵn sàng để dựng, hệ thống đang điều chỉnh lại.",
  determinism: "Đang ổn định lại hình ảnh cho video.",
  render: "Quá trình dựng video gặp trục trặc. Hãy thử lại.",
  "render-oracle": "Một vài cảnh cần chỉnh lại sau khi dựng.",
  review: "Bản nháp cần được xem lại trước khi hoàn tất.",
  tts: "Cấu hình giọng đọc chưa đầy đủ. Hãy kiểm tra lại phần Giọng đọc trong Cài đặt.",
  config: "Có một thiết lập chưa hoàn chỉnh. Hãy kiểm tra lại Cài đặt.",
};

const STAGE_RETRY: Record<PipelineStage, FriendlyError["retry"]> = {
  ingest: "create",
  admission: "draft",
  "static-grid": "draft",
  "build-gate": "draft",
  determinism: "draft",
  render: "draft",
  "render-oracle": "draft",
  review: "draft",
  tts: undefined,
  config: undefined,
};

export type FriendlyErrorOptions = { projectId?: string; phase?: "draft" | "full" };

/** Translate a serialized engine error into the user-facing `FriendlyError`. */
export function toFriendlyError(
  error: SerializedPipelineError,
  opts: FriendlyErrorOptions = {},
): FriendlyError {
  const base = STAGE_MESSAGE[error.stage] ?? GENERIC;
  const message = stripL0Tokens(base) || GENERIC;
  const retry =
    error.stage === "render" && opts.phase === "full" ? "full" : STAGE_RETRY[error.stage];
  return {
    ...(opts.projectId !== undefined ? { projectId: opts.projectId } : {}),
    message,
    ...(retry !== undefined ? { retry } : {}),
  };
}

/** "scene-07" → "Cảnh 7"; anything unrecognized yields no label. */
function sceneLabel(sceneId: string | undefined): string | undefined {
  if (!sceneId) return undefined;
  const m = /(\d+)/.exec(sceneId);
  if (!m) return undefined;
  return `Cảnh ${Number(m[1])}`;
}

/** Plain-language phrasing per known grid check; the check id never appears. */
const CHECK_FIX_PHRASE: Record<string, string> = {
  N14: "bị tràn xuống vùng phụ đề nên đã được thu lại",
  N17: "bị cắt chữ nên đã được rút gọn",
  N18: "có chữ khó đọc nên đã tăng độ tương phản",
  N19: "có khoảng lặng nên đã được căn lại nhịp",
  N20: "có nhịp chưa hợp lý nên đã được điều chỉnh",
  N21: "có chuyển cảnh giật nên đã được làm mượt",
  N30: "hơi nhiều chi tiết nên đã được giãn bớt",
};

/** Translate a safety issue into a plain-language auto-fix description. */
export function toFriendlyFix(issue: SafetyIssue): FriendlyFix {
  const label = sceneLabel(issue.sceneId);
  const detail = CHECK_FIX_PHRASE[issue.check] ?? "đã được chỉnh lại";
  const raw = label ? `${label} ${detail}.` : `Một cảnh ${detail}.`;
  const message = stripL0Tokens(raw) || GENERIC;
  return { ...(issue.sceneId !== undefined ? { sceneId: issue.sceneId } : {}), message };
}
