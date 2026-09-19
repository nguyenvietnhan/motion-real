import type { FriendlyStatus, ProjectStage } from "../../shared/types.js";

/** Missing generated artifacts are a normal pre-render state, not corruption. */
export function isMissingFileError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

/** Map a live workspace stage to the gallery's friendly status. */
export function stageToFriendlyStatus(kind: ProjectStage["kind"]): FriendlyStatus {
  switch (kind) {
    case "ready":
    case "draft-recovery":
      return "draft-ready";
    case "published":
      return "done";
    case "error":
      return "error";
    default:
      return "building"; // writing | image-review | script | rendering
  }
}

/**
 * Combine a per-scene edit instruction with the video-wide note into one intent
 * the AI receives for that scene. Either part may be empty; a scene targeted by
 * a global-note-only edit carries just the note.
 */
export function combineIntent(perScene: string, globalNotes: string): string {
  const parts: string[] = [];
  const scene = perScene.trim();
  const global = globalNotes.trim();
  if (scene) parts.push(`Yêu cầu riêng cho cảnh này (ưu tiên): ${scene}`);
  if (global) {
    parts.push(scene
      ? `Ghi chú chung cho cả video (áp dụng khi phù hợp, không ghi đè yêu cầu riêng): ${global}`
      : `Ghi chú chung cho cả video (áp dụng cho cảnh này): ${global}`);
  }
  return parts.join("\n\n");
}

/**
 * Build a non-blocking warning when one or more brief links couldn't be read.
 * The content then leans on the model's own knowledge, so the user should
 * verify before approving. Returns undefined when every link was read.
 */
export function linkWarningOf(totalUrls: number, unreadableUrls: string[]): string | undefined {
  if (unreadableUrls.length === 0) return undefined;
  return `Không đọc được ${unreadableUrls.length}/${totalUrls} đường dẫn. Nội dung liên quan dựa trên hiểu biết của AI.`;
}
