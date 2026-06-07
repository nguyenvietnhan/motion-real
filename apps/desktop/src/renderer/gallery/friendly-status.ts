import type { FriendlyStatus, ProjectState } from "../../shared/types.js";

/**
 * Friendly-status mapping (web-dashboard Task 4.13, design §friendly-status,
 * Req 10.2/10.3/10.4). TOTAL by construction: every engine `ProjectState` AND
 * any unknown string maps to exactly one of four user-facing statuses, with an
 * unmapped/unknown value defaulting to `building`. No internal technical state
 * name is ever returned (Property 10).
 */

export const FRIENDLY_LABELS: Record<FriendlyStatus, string> = {
  building: "Đang dựng…",
  "draft-ready": "Nháp sẵn sàng để duyệt",
  done: "Hoàn tất",
  error: "Gặp lỗi — thử lại",
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
      // planning, planned, and any unmapped/unknown state (Req 10.3).
      return "building";
  }
}

export function friendlyLabel(state: ProjectState | string): string {
  return FRIENDLY_LABELS[toFriendlyStatus(state)];
}
