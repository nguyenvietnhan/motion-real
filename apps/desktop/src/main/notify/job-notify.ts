import type { FriendlyStatus } from "../../shared/types.js";

/**
 * Unattended throughput: tell the user when a long job ends without watching
 * the window. Pure decision + copy helpers live here; Electron Notification is
 * wired in index.ts so WorkspaceController stays free of Electron types.
 */

export type JobNotifyKind = "done" | "error";

export type JobNotifyPayload = {
  kind: JobNotifyKind;
  title: string;
  body: string;
};

/**
 * Fire only on edge into a terminal gallery status (done / error) **during a
 * live job**. `previous === undefined` means first stage seed / disk recovery
 * (e.g. reopening a finished project) — never notify for that.
 * Re-emitting the same terminal status must not spam toasts.
 */
export function jobNotifyKindFromStatusTransition(
  previous: FriendlyStatus | undefined,
  next: FriendlyStatus,
): JobNotifyKind | null {
  if (previous === undefined) return null;
  if (next === "done" && previous !== "done") return "done";
  if (next === "error" && previous !== "error") return "error";
  return null;
}

/** Compact OS notification copy (Vietnamese product UI). */
export function jobNotifyPayload(input: {
  kind: JobNotifyKind;
  projectId: string;
  /** Optional friendly error line (already redacted at the workspace boundary). */
  message?: string;
  /** Optional display title from manifest when done. */
  title?: string;
}): JobNotifyPayload {
  const idHint = shortProjectHint(input.projectId);
  if (input.kind === "done") {
    const name = input.title?.trim();
    return {
      kind: "done",
      title: "Video đã xong",
      body: name && name.length > 0 ? name : `Dự án ${idHint} đã xuất bản xong.`,
    };
  }
  const detail = input.message?.trim();
  return {
    kind: "error",
    title: "Dựng video gặp lỗi",
    body: detail && detail.length > 0 ? detail : `Dự án ${idHint} chưa dựng xong. Mở app để thử lại.`,
  };
}

/** Short id for body text — full UUIDs are noisy in toast banners. */
export function shortProjectHint(projectId: string): string {
  const t = projectId.trim();
  if (t.length <= 12) return t;
  return `${t.slice(0, 8)}…`;
}
