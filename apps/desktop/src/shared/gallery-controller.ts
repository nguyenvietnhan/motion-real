import type { ProjectSummary } from "@news/pipeline";
import type { ProjectCardVM } from "./types.js";
import { toFriendlyStatus } from "./friendly-status.js";

/**
 * Gallery view-model builder (web-dashboard Task 9.3, design §gallery, Req 10).
 * Pure: turns engine `ProjectSummary[]` into `ProjectCardVM[]` newest-first,
 * each with a title, a thumbnail path or placeholder (null), a friendly status,
 * and a `ngày D tháng M năm YYYY` creation date (Property 11). The empty-state
 * is only reported AFTER a load completes (Req 10.8).
 */

export type GalleryLoad = "loading" | "empty" | "populated";

/** Format an ISO timestamp as `ngày D tháng M năm YYYY` (UTC, no leading zeros). */
export function formatVietnameseDate(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `ngày ${d.getUTCDate()} tháng ${d.getUTCMonth() + 1} năm ${d.getUTCFullYear()}`;
}

function titleOf(summary: ProjectSummary): string {
  const prompt = summary.brief?.prompt?.trim();
  return prompt && prompt.length > 0 ? prompt : summary.projectId;
}

function thumbnailOf(summary: ProjectSummary): string | null {
  // The first review keyframe is the natural thumbnail once a render exists;
  // otherwise null ⇒ the UI shows a placeholder (Req 10.6).
  return summary.hasRender ? `${summary.root}/review/scene-01.png` : null;
}

export function toCards(summaries: ProjectSummary[]): ProjectCardVM[] {
  return summaries
    .map((summary) => ({
      summary,
      createdAt: summary.brief?.createdAt ?? summary.brief?.updatedAt ?? "",
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(({ summary }) => ({
      projectId: summary.projectId,
      title: titleOf(summary),
      thumbnailPath: thumbnailOf(summary),
      status: toFriendlyStatus(summary.brief?.state ?? "planning"),
      createdAtLabel: formatVietnameseDate(summary.brief?.createdAt ?? summary.brief?.updatedAt),
    }));
}

/** Empty-state is reported ONLY after the load finishes (Req 10.8). */
export function galleryLoadState(loaded: boolean, cardCount: number): GalleryLoad {
  if (!loaded) return "loading";
  return cardCount === 0 ? "empty" : "populated";
}
