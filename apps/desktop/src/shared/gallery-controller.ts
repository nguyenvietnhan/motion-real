import type { ProjectSummary } from "@motionreal/pipeline";
import type { ProjectCardVM } from "./types.js";
import { toFriendlyStatus } from "./friendly-status.js";

/**
 * Gallery view-model builder (web-dashboard Task 9.3, design §gallery, Req 10).
 * Pure: turns engine `ProjectSummary[]` into `ProjectCardVM[]` newest-first,
 * each with a title, an aspect-aware thumbnail path or placeholder (null), a
 * friendly status, and a compact `DD/MM/YYYY` creation date (Property 11). The empty-state
 * is only reported AFTER a load completes (Req 10.8).
 */

export type GalleryLoad = "loading" | "empty" | "populated" | "error";

/**
 * Format an ISO timestamp as a compact `DD/MM/YYYY` in the viewer's LOCAL time.
 * The createdAt is stored as UTC; a project authored at 03:33 on the 13th in
 * UTC+7 is 20:33 on the 12th in UTC, so a UTC format would show the WRONG
 * calendar day to the user. The date the user cares about is their own wall-clock
 * day, so format in local time.
 */
export function formatShortDate(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

function titleOf(summary: ProjectSummary): string {
  // Prefer the AI-authored display title (from manifest.json) so a card reads
  // "Gemma 3 chạy trên máy nhà" rather than the long link/prompt the user typed.
  // Falls back to the raw prompt for a scaffolded-but-unauthored project, then to
  // the id as a last resort so a card is never blank.
  const title = summary.title?.trim();
  if (title && title.length > 0) return title;
  const prompt = summary.brief?.prompt?.trim();
  return prompt && prompt.length > 0 ? prompt : summary.projectId;
}

function thumbnailOf(summary: ProjectSummary): string | null {
  // The first review keyframe is the natural thumbnail once a render exists;
  // otherwise null ⇒ the UI shows a placeholder (Req 10.6).
  return summary.hasRender ? `${summary.root}/review/scene-01.png` : null;
}

function formatOf(summary: ProjectSummary): ProjectCardVM["format"] {
  // `ProjectBrief.ratio` is still typed as TikTok-only in the current pipeline,
  // but older/future project folders can already carry a landscape ratio. Read it
  // defensively so the gallery card is ready for YouTube renders without adding a
  // visible format badge or changing the rest of the card contract.
  const ratio = (summary.brief as { ratio?: unknown } | undefined)?.ratio;
  return ratio === "16:9" ? "youtube" : "tiktok";
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
      format: formatOf(summary),
      status: toFriendlyStatus(summary.brief?.state ?? "planning"),
      createdAtLabel: formatShortDate(summary.brief?.createdAt ?? summary.brief?.updatedAt),
    }));
}

/** Empty-state is reported ONLY after the load finishes (Req 10.8). */
export function galleryLoadState(loaded: boolean, cardCount: number): GalleryLoad {
  if (!loaded) return "loading";
  return cardCount === 0 ? "empty" : "populated";
}

/** Default page size for the projects gallery (I1/O3): a 3×4 grid. */
export const PROJECTS_PER_PAGE = 12;

export type Paged<T> = {
  /** The items on the clamped page. */
  items: T[];
  /** The 1-based page actually shown (clamped into [1, totalPages]). */
  page: number;
  /** Total number of pages (≥1 even when empty, so the footer always reads "1/1"). */
  totalPages: number;
  /** Total item count across all pages. */
  total: number;
};

/**
 * Slice a list into a clamped 1-based page (I1/O3). Pagination is done in the
 * renderer over the already-loaded cards — the store must read every brief to
 * sort newest-first anyway, so a backend `(page,pageSize)` query would add no
 * perf benefit while forcing page/total state through the 1.5s gallery poll
 * (causing flicker). `page` is clamped into range so a delete that empties the
 * last page falls back to the new last page instead of showing nothing.
 */
export function paginate<T>(all: readonly T[], page: number, pageSize = PROJECTS_PER_PAGE): Paged<T> {
  const total = all.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const clamped = Math.min(Math.max(1, Math.floor(page) || 1), totalPages);
  const start = (clamped - 1) * pageSize;
  return { items: all.slice(start, start + pageSize), page: clamped, totalPages, total };
}
