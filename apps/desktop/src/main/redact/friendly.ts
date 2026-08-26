import type { PipelineStage, SerializedPipelineError, SafetyIssue } from "@motionreal/pipeline";
import type { FriendlyError, FriendlyFix } from "../../shared/types.js";

/**
 * Main-process redaction boundary for user-facing errors.
 * This is the ONLY place engine failures become user-facing, and the ONLY
 * error/fix shape allowed to cross IPC. Messages come from a fixed Vietnamese
 * plain-language catalog keyed by stage/issue — engine text is NEVER echoed —
 * and the result is swept for L0 tokens (N1–N31 codes, `.tsx`, MCP, JSON
 * braces, stack frames) so none can leak.
 */

const GENERIC = "Đã xảy ra sự cố. Vui lòng thử lại.";

const VOICE_FAILURE_MESSAGE: Record<NonNullable<SerializedPipelineError["voiceFailure"]>["code"], string> = {
  not_configured: "Chưa cấu hình giọng đọc. Hãy lưu API key và Voice ID trong Cài đặt.",
  invalid_api_key: "API key giọng đọc không hợp lệ. Hãy cập nhật key trong Cài đặt rồi kiểm tra lại giọng.",
  insufficient_credits: "Tài khoản giọng đọc đã hết credit. Hãy nạp thêm credit hoặc chọn nhà cung cấp khác.",
  plan_required: "Gói hiện tại không hỗ trợ giọng hoặc model đã chọn. Hãy đổi giọng, nâng gói hoặc chọn nhà cung cấp khác.",
  rate_limited: "Nhà cung cấp giọng đang giới hạn lượt gọi. Hãy chờ một lúc rồi thử lại.",
  voice_not_found: "Không tìm thấy Voice ID đã chọn. Hãy cập nhật Voice ID trong Cài đặt rồi kiểm tra lại giọng.",
  invalid_request: "Thiết lập giọng đọc chưa được nhà cung cấp chấp nhận. Hãy kiểm tra Voice ID và model.",
  provider_unavailable: "Dịch vụ giọng đọc đang tạm thời không khả dụng. Hãy thử lại sau.",
  unknown: "Nhà cung cấp giọng đọc gặp sự cố chưa xác định. Hãy kiểm tra giọng trong Cài đặt rồi thử lại.",
};

/** Defense-in-depth: strip any L0 internal token from a final message. */
export function stripL0Tokens(text: string): string {
  // One cleaning pass. Structural separators are removed FIRST (as spaces) so a
  // later pass can never glue two fragments into a fresh token (e.g. "N{3" must
  // not become "N3"). The whole chain is then applied to a fixpoint so any token
  // exposed by a removal is caught on the next pass.
  const strip = (s: string): string =>
    s
      .replace(/[{}[\]]/g, " ") // manifest JSON braces → space (no gluing)
      .replace(/\bN(?:[1-9]|[12]\d|3[01])\b/g, " ") // N1..N31 grid codes
      .replace(/[\w./\\-]*\.tsx\b/gi, " ") // authored .tsx source files (incl. a bare ".tsx")
      .replace(/\bMCP\b/gi, " ") // MCP references
      .replace(/\bat\s+[^\n]+:\d+:\d+/g, " "); // stack frames "at fn (file:line:col)"

  let prev = text;
  let next = strip(prev);
  for (let i = 0; i < 4 && next !== prev; i++) {
    prev = next;
    next = strip(prev);
  }
  return next.replace(/\s{2,}/g, " ").trim();
}

// Each message follows ONE rule: state what happened, then what the user does
// next. It never implies the system is still working on its own (the run has
// STOPPED and is waiting for the user), and it never names a specific button —
// the actual button ("Sửa bằng AI" vs "Thử lại") is chosen separately from the
// `fixable` flag, so the copy says the button-neutral "dùng nút bên dưới" to
// avoid a copy↔button mismatch. Stages with no button (tts/config) point to the
// exact place to fix instead.
const STAGE_MESSAGE: Record<PipelineStage, string> = {
  ingest: "Không lấy được nội dung từ nguồn bạn cung cấp. Hãy kiểm tra lại đường dẫn hoặc thử nguồn khác.",
  admission: "Một cảnh chưa hợp lệ nên chưa dựng được. Hãy dùng nút bên dưới để tiếp tục.",
  "static-grid": "Một vài cảnh cần chỉnh lại bố cục trước khi dựng. Hãy dùng nút bên dưới để tiếp tục.",
  "build-gate": "Video chưa qua được bước kiểm tra trước khi dựng. Hãy dùng nút bên dưới để tiếp tục.",
  determinism: "Hình ảnh video chưa ổn định giữa các lần dựng. Hãy dùng nút bên dưới để tiếp tục.",
  "render-lock": "Dự án này đang được dựng ở một tiến trình khác. Hãy đợi lần dựng đó kết thúc rồi thử lại.",
  render: "Quá trình dựng video gặp trục trặc. Hãy dùng nút bên dưới để thử lại.",
  "render-oracle": "Một vài cảnh cần chỉnh lại sau khi dựng. Hãy dùng nút bên dưới để tiếp tục.",
  review: "Bản nháp cần được xem lại trước khi hoàn tất. Hãy dùng nút bên dưới để tiếp tục.",
  tts: "Cấu hình giọng đọc chưa đầy đủ. Hãy kiểm tra lại phần Giọng đọc trong Cài đặt.",
  config: "Có một thiết lập chưa hoàn chỉnh. Hãy kiểm tra lại Cài đặt.",
};

const STAGE_RETRY: Record<PipelineStage, FriendlyError["retry"]> = {
  ingest: "create",
  admission: "draft",
  "static-grid": "draft",
  "build-gate": "draft",
  determinism: "draft",
  "render-lock": "draft",
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
  const base = error.voiceFailure
    ? VOICE_FAILURE_MESSAGE[error.voiceFailure.code]
    : STAGE_MESSAGE[error.stage] ?? GENERIC;
  const message = stripL0Tokens(base) || GENERIC;
  const retry =
    error.stage === "render" && opts.phase === "full" ? "full" : STAGE_RETRY[error.stage];
  return {
    ...(opts.projectId !== undefined ? { projectId: opts.projectId } : {}),
    message,
    ...(retry !== undefined ? { retry } : {}),
    ...(error.voiceFailure ? { voiceFailure: error.voiceFailure } : {}),
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
  N31: "bị lỗi khi dựng nên đã được viết lại",
};

/** Translate a safety issue into a plain-language auto-fix description. */
export function toFriendlyFix(issue: SafetyIssue): FriendlyFix {
  const label = sceneLabel(issue.sceneId);
  const detail = CHECK_FIX_PHRASE[issue.check] ?? "đã được chỉnh lại";
  const raw = label ? `${label} ${detail}.` : `Một cảnh ${detail}.`;
  const message = stripL0Tokens(raw) || GENERIC;
  return { ...(issue.sceneId !== undefined ? { sceneId: issue.sceneId } : {}), message };
}
