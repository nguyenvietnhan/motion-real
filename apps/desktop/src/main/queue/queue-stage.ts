import type { ProjectStage } from "../../shared/types.js";
import type { VoiceProviderFailure } from "@motionreal/pipeline";

export type QueueStageClass =
  | { action: "continue" }
  | { action: "published" }
  | { action: "failed"; message: string; voiceFailure?: VoiceProviderFailure };

/** Fixed VI copy when unattended queue hits a human review gate. */
export const QUEUE_HUMAN_WAIT_MESSAGE =
  "Hàng đợi dừng: video cần duyệt tay (script/ảnh/draft). Bật skip_edit và tắt script gate + duyệt ảnh trong Cài đặt để treo máy.";

/**
 * Classify a workspace stage for the serial queue waiter.
 * Human-blocking stages fail immediately so the chain does not poll forever.
 */
export function classifyQueueWaitStage(stage: ProjectStage): QueueStageClass {
  if (stage.kind === "published") return { action: "published" };
  if (stage.kind === "error") {
    return {
      action: "failed",
      message: (stage.message && stage.message.trim()) || "Lỗi sản xuất.",
      ...(stage.voiceFailure ? { voiceFailure: stage.voiceFailure } : {}),
    };
  }
  if (
    stage.kind === "script" ||
    stage.kind === "image-review" ||
    stage.kind === "ready" ||
    stage.kind === "draft-recovery"
  ) {
    return { action: "failed", message: QUEUE_HUMAN_WAIT_MESSAGE };
  }
  // writing | rendering — still in progress
  return { action: "continue" };
}
