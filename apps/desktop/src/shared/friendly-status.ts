import type { FriendlyStatus, ProjectState } from "./types.js";

/**
 * Friendly-status mapping. TOTAL by construction: every engine `ProjectState`
 * AND any unknown string maps to exactly one of four user-facing statuses, with
 * an unmapped/unknown value defaulting to `building`. No internal technical
 * state name is ever returned.
 */

/** Full labels for cards / pills. */
export const FRIENDLY_LABELS: Record<FriendlyStatus, string> = {
  building: "Đang dựng…",
  "draft-ready": "Sẵn sàng duyệt",
  done: "Xong",
  error: "Lỗi",
};

/** Compact labels for dense chrome (gallery filter, toolbars). */
export const FRIENDLY_SHORT_LABELS: Record<FriendlyStatus, string> = {
  building: "Đang dựng",
  "draft-ready": "Duyệt",
  done: "Xong",
  error: "Lỗi",
};

/** All four friendly statuses, for total-coverage assertions. */
export const FRIENDLY_STATUSES: readonly FriendlyStatus[] = [
  "building",
  "draft-ready",
  "done",
  "error",
];

export function toFriendlyStatus(state: ProjectState | string): FriendlyStatus {
  switch (state) {
    case "scaffolded":
    case "tts":
    case "locking":
    case "rendering":
      return "building";
    case "reviewing":
      return "draft-ready";
    case "done":
      return "done";
    case "failed":
      return "error";
    default:
      // planning, planned, and any unmapped/unknown state.
      return "building";
  }
}
