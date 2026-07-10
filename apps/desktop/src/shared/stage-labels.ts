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
  const qaSuffix =
    resolved === "qa" && options.qaPass && options.qaTotal
      ? ` (${options.qaPass}/${options.qaTotal})`
      : "";
  switch (resolved) {
    case "edit":
      return "Đang chỉnh cảnh…";
    case "qa":
      return `Đang tinh chỉnh ảnh${qaSuffix}…`;
    case "prepare":
      return "Đang chuẩn bị…";
    case "full":
      return "Đang xuất bản…";
    case "draft":
      return "Đang dựng nháp…";
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
      body: "Đang tinh chỉnh ảnh",
      count: `(${options.qaPass}/${options.qaTotal})`,
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
        title: "Đang lấy ảnh…",
        detail: "Có thể bỏ qua phần link không đọc được.",
      };
    case "image-filter":
      return {
        title: "Đang chọn ảnh…",
        detail: "Lọc ảnh không phù hợp trước khi duyệt.",
      };
    case "author":
    case undefined:
      return {
        title: "Đang viết kịch bản…",
        detail: "Có thể mất vài phút.",
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
      return "Đang viết";
    case "script":
      return "Kịch bản";
    case "image-review":
      return "Duyệt ảnh";
    case "rendering":
      return "Đang dựng";
    case "ready":
      return "Duyệt";
    case "draft-recovery":
      return "Khôi phục";
    case "published":
      return "Đã xong";
    case "error":
      return "Lỗi";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}
