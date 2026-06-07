import type { ApproveResult } from "../../shared/types.js";

/**
 * Draft-first approve / full-render gate (web-dashboard Task 9.2 pure core,
 * design §approve, Req 9.1/9.2/9.4/12.5). The dashboard mirror of the engine's
 * own draft-first refusal: Approve is enabled IFF a reviewed Draft exists, and a
 * full render with no reviewed draft and no explicit force-full is refused
 * (`draft-first`) leaving the project unchanged (Property 9). The orchestrator
 * still independently refuses — this gate is the UI enabler, not the authority.
 */

/** Approve is enabled only once a reviewed Draft exists for the open project. */
export function approveEnabled(hasReviewedDraft: boolean): boolean {
  return hasReviewedDraft;
}

/** A full render may proceed iff a reviewed draft exists OR force-full is set. */
export function fullRenderAllowed(hasReviewedDraft: boolean, forceFull: boolean): boolean {
  return hasReviewedDraft || forceFull;
}

/**
 * Decide an `approveDraft` request. Returns the refusal view-model when no
 * reviewed draft exists (and no force-full); otherwise signals the caller may
 * drive `render_full`. `outputPath` is filled by the caller after the engine run.
 */
export function evaluateApprove(
  hasReviewedDraft: boolean,
  forceFull = false,
): { proceed: true } | (ApproveResult & { ok: false }) {
  if (!fullRenderAllowed(hasReviewedDraft, forceFull)) {
    return { ok: false, reason: "draft-first" };
  }
  return { proceed: true };
}
