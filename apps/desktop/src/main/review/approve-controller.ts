import type { SerializedPipelineError } from "@news/pipeline";
import type { FriendlyError } from "../../shared/types.js";
import { fullRenderAllowed } from "./approve-gate.js";
import { toFriendlyError } from "../redact/friendly.js";

/**
 * Approve → full-render wiring (web-dashboard Task 9.2, Req 9.1–9.7, 12.5).
 * Gated by a reviewed draft (draft-first); on a valid approve it drives the
 * engine `render_full` (which independently re-enforces the gate). A full-render
 * failure stops progress, retains the existing draft, and surfaces a friendly
 * retry — modelled here by the `render-failed` outcome carrying a `FriendlyError`
 * (`retry: "full"`). The pure gate itself is Property 9 (approve-gate.ts).
 */

export type ApproveOutcome =
  | { ok: true; outputPath: string }
  | { ok: false; reason: "draft-first" }
  | { ok: false; reason: "render-failed"; error: FriendlyError };

/** Drives the engine `render_full` tool (one registry); reports progress. */
export interface FullRenderBackend {
  renderFull(
    projectId: string,
    onProgress: (ratio: number) => void,
  ): Promise<{ ok: true; outputPath: string } | { ok: false; error: SerializedPipelineError }>;
}

export class ApproveController {
  constructor(private readonly backend: FullRenderBackend) {}

  async approveDraft(
    projectId: string,
    hasReviewedDraft: boolean,
    onProgress: (ratio: number) => void = () => {},
  ): Promise<ApproveOutcome> {
    // Draft-first: refuse a full render with no reviewed draft (Req 9.4/12.5).
    if (!fullRenderAllowed(hasReviewedDraft, false)) {
      return { ok: false, reason: "draft-first" };
    }
    const result = await this.backend.renderFull(projectId, onProgress);
    if (result.ok) {
      return { ok: true, outputPath: result.outputPath };
    }
    // Retain the draft; offer a retry of the full render (Req 9.7).
    return { ok: false, reason: "render-failed", error: toFriendlyError(result.error, { projectId, phase: "full" }) };
  }
}
