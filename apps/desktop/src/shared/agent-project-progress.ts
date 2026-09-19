import { renderingPhaseLabel, workspaceStageTitle, writingPhaseCopy } from "./stage-labels.js";
import type { AgentProductionState, ProjectStage } from "./types.js";

export type AgentProjectProgress = {
  state: "authoring" | "rendering" | "scene_review" | "published" | "error" | "paused";
  label: string;
  percent?: number;
  canCancel: boolean;
  reviewReady: boolean;
};

/** Native chat owns discovery; activity is needed only while MotionReal shows automated work. */
export function shouldPollAgentActivities(state: AgentProductionState, nativeChatVisible: boolean): boolean {
  return !nativeChatVisible
    && (state === "collecting_assets"
      || state === "preparing_brief"
      || state === "authoring"
      || state === "visual_refine");
}

/** Events are primary. The timer is only a recovery fallback for active work. */
export function shouldPollProjectStage(progress: AgentProjectProgress | null): boolean {
  return progress?.canCancel === true;
}

/** Project stage is authoritative after Agent has linked a MotionReal project. */
export function agentProjectProgress(
  stage: ProjectStage,
  agentState?: AgentProductionState,
): AgentProjectProgress {
  if (agentState === "paused") {
    return { state: "paused", label: "Đã tạm dừng", canCancel: false, reviewReady: false };
  }

  if (agentState === "error") {
    return { state: "error", label: stage.kind === "error" ? stage.message : "Cần xử lý lỗi", canCancel: false, reviewReady: false };
  }

  if (agentState === "authoring" || agentState === "visual_refine") {
    switch (stage.kind) {
      case "writing":
        return { state: "authoring", label: writingPhaseCopy(stage.phase), canCancel: true, reviewReady: false };
      case "rendering": {
        const label = stage.phase === "prepare"
          ? (agentState === "visual_refine" ? "Đang chuẩn bị ảnh soát lỗi…" : "Đang chuẩn bị ảnh xem trước…")
          : renderingPhaseLabel(stage.phase, { qaPass: stage.qaPass, qaTotal: stage.qaTotal });
        return {
          state: "authoring",
          label,
          percent: Math.max(0, Math.min(100, stage.percent)),
          canCancel: true,
          reviewReady: false,
        };
      }
      case "error":
        return { state: "error", label: stage.message, canCancel: false, reviewReady: false };
      case "ready":
      case "published":
      case "draft-recovery":
      case "image-review":
      case "script":
      default:
        // Do not surface an old ready/published artifact from an earlier iteration while authoring/refine is active.
        return {
          state: "authoring",
          label: agentState === "visual_refine" ? "Đang soát lỗi hình ảnh (Harness)" : "Đang viết scene (Harness)",
          canCancel: true,
          reviewReady: false,
        };
    }
  }

  switch (stage.kind) {
    case "writing":
      return { state: "authoring", label: writingPhaseCopy(stage.phase), canCancel: true, reviewReady: false };
    case "image-review":
    case "script":
      return { state: "scene_review", label: workspaceStageTitle(stage.kind), canCancel: false, reviewReady: true };
    case "rendering": {
      return {
        state: "rendering",
        label: renderingPhaseLabel(stage.phase, { qaPass: stage.qaPass, qaTotal: stage.qaTotal }),
        percent: Math.max(0, Math.min(100, stage.percent)),
        canCancel: true,
        reviewReady: false,
      };
    }
    case "ready":
      return { state: "scene_review", label: stage.draftPath ? "Bản nháp sẵn sàng" : "Chờ bạn duyệt từng cảnh", canCancel: false, reviewReady: true };
    case "draft-recovery":
      return { state: "scene_review", label: "Bản nháp cần khôi phục", canCancel: false, reviewReady: true };
    case "published":
      return { state: "published", label: "Video đã hoàn tất", canCancel: false, reviewReady: true };
    case "error":
      return { state: "error", label: stage.message, canCancel: false, reviewReady: true };
    default: {
      const _exhaustive: never = stage;
      return _exhaustive;
    }
  }
}
