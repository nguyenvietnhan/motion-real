import { renderingPhaseLabel, workspaceStageTitle, writingPhaseCopy } from "./stage-labels.js";
import type { AgentProductionState, ProjectStage } from "./types.js";

export type AgentProjectProgress = {
  state: "authoring" | "rendering" | "scene_review" | "published" | "error";
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
export function agentProjectProgress(stage: ProjectStage): AgentProjectProgress {
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
