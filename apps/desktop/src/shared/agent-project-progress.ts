import { renderingPhaseLabel, workspaceStageTitle, writingPhaseCopy } from "./stage-labels.js";
import type { ProjectStage } from "./types.js";

export type AgentProjectProgress = {
  state: "authoring" | "rendering" | "scene_review" | "published" | "error";
  label: string;
  percent?: number;
  canCancel: boolean;
  reviewReady: boolean;
};

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
