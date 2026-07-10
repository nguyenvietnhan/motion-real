import type { ProjectStage } from "./types.js";

/** Writing sub-phase while AI crawls / filters / authors. */
export type WritingStagePhase = NonNullable<Extract<ProjectStage, { kind: "writing" }>["phase"]>;

/** Rendering sub-phase for draft / full / qa / prepare / edit. */
export type RenderingStagePhase = NonNullable<Extract<ProjectStage, { kind: "rendering" }>["phase"]>;

/**
 * Vietnamese status line for the rendering panel. Must stay total over every
 * known rendering phase; unknown/undefined falls through to the draft copy.
 */
export function renderingPhaseLabel(
  phase: RenderingStagePhase | undefined,
  options: { qaPass?: number; qaTotal?: number } = {},
): string {
  const resolved = phase ?? "draft";
  // Keep "(lần N/M)" as a single unit — no figure-space padding (it looked like
  // broken gaps and still reflowed when the status line wrapped).
  const qaSuffix =
    resolved === "qa" && options.qaPass && options.qaTotal
      ? ` (lần ${options.qaPass}/${options.qaTotal})`
      : "";
  switch (resolved) {
    case "edit":
      return "AI đang chỉnh sửa các cảnh theo yêu cầu…";
    case "qa":
      return `AI đang soát lỗi hình ảnh${qaSuffix}…`;
    case "prepare":
      return "Đang dựng bản nháp…";
    case "full":
      return "Đang dựng video bản đầy đủ (chất lượng cao)…";
    case "draft":
      return "Đang dựng giọng đọc + bản nháp…";
    default: {
      const _exhaustive: never = resolved;
      return _exhaustive;
    }
  }
}

/** Split rendering status into body + optional nowrap counter for clean wraps. */
export function renderingPhaseParts(
  phase: RenderingStagePhase | undefined,
  options: { qaPass?: number; qaTotal?: number } = {},
): { body: string; count?: string } {
  const resolved = phase ?? "draft";
  if (resolved === "qa" && options.qaPass && options.qaTotal) {
    return {
      body: "AI đang soát lỗi hình ảnh",
      count: `(lần ${options.qaPass}/${options.qaTotal})`,
    };
  }
  return { body: renderingPhaseLabel(phase, options) };
}

/** Whether the rendering progress bar should be indeterminate (no percent). */
export function renderingPhaseIndeterminate(
  phase: RenderingStagePhase | undefined,
  percent: number,
): boolean {
  const resolved = phase ?? "draft";
  return resolved === "edit" || resolved === "qa" || resolved === "prepare" || percent <= 0;
}

/**
 * Title + detail for the writing spinner card. Defaults to the author copy when
 * phase is absent (plain authoring with no crawl).
 */
export function writingPhaseCopy(phase: WritingStagePhase | undefined): { title: string; detail: string } {
  switch (phase) {
    case "crawl":
      return {
        title: "Đang đọc link và cào ảnh từ bài báo…",
        detail:
          "Nếu trang chặn đọc nội dung hoặc ảnh, app sẽ bỏ qua phần đó và tiếp tục dựng từ phần đọc được.",
      };
    case "image-filter":
      return {
        title: "AI đang chọn ảnh phù hợp từ bài báo…",
        detail: "Ảnh quảng cáo, logo hoặc ảnh không liên quan sẽ bị lọc trước khi bạn duyệt.",
      };
    case "author":
    case undefined:
      return {
        title: "AI đang viết kịch bản từ nội dung của bạn…",
        detail: "Quá trình này có thể mất vài phút. Ứng dụng sẽ tự tiếp tục khi hoàn tất.",
      };
    default: {
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}

/** Top-level workspace chrome title for each stage kind. */
export function workspaceStageTitle(kind: ProjectStage["kind"]): string {
  switch (kind) {
    case "writing":
      return "Đang viết kịch bản";
    case "script":
      return "Duyệt kịch bản";
    case "image-review":
      return "Duyệt ảnh";
    case "rendering":
      return "Đang dựng video";
    case "ready":
      return "Duyệt cảnh";
    case "published":
      return "Đã xuất bản";
    case "error":
      return "Gặp lỗi";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}
