import type { SafetyIssue, SerializedPipelineError, PipelineStage } from "@news/pipeline";

/**
 * Error classification (desktop-author-mode, Req 4). Splits a failure into:
 *   - "content": a defect IN the AI-authored scene code (admission N4/N5,
 *     oracle N14/N17/N18…, authored layout) → the agent can self-repair it.
 *   - "infra": an environment/runtime failure (missing voice config, gateway/
 *     network, Chromium "target closed") → the agent CANNOT fix it; surface to
 *     the user instead of wasting reauthor attempts.
 *
 * Pure + total: every input maps to exactly one class. Default is "infra" (the
 * safe choice — never spend an agent attempt on something it can't fix).
 */

export type ErrorClass = "infra" | "content";

/** Grid checks whose failures stem from the authored scene code (agent-fixable). */
export const CONTENT_CHECKS: ReadonlySet<string> = new Set([
  "N3", // per-component props (example/props vs schema)
  "N4", // import whitelist / required exports / load failure
  "N5", // banned APIs
  "N10", // typecheck (when a caller runs it)
  "N14", // content-zone / caption clearance
  "N17", // truncation
  "N18", // contrast / font
  "N19", // dead-air
  "N20", // pacing
  "N21", // transition / flicker
  "N22", // audio-sync
  "N30", // content density
]);

/** Pipeline stages whose failures are authored-content defects. */
const CONTENT_STAGES: ReadonlySet<PipelineStage> = new Set<PipelineStage>([
  "admission",
  "static-grid",
  "build-gate",
  "determinism",
  "render-oracle",
]);

/** Infra signatures in a render-stage cause (Chromium/network/gateway). */
const INFRA_CAUSE = /target closed|ECONN|ENOTFOUND|ETIMEDOUT|socket hang up|gateway|fetch failed/i;

/** Render-stage causes that indicate the AI code broke the bundle (content). */
const BUNDLE_CONTENT_CAUSE = /transform failed|could not resolve|unexpected|syntaxerror|authored[\\/]/i;

/** Classify a single safety issue by its grid check id. */
export function classifyIssue(issue: SafetyIssue): ErrorClass {
  return CONTENT_CHECKS.has(issue.check) ? "content" : "infra";
}

/** Classify a serialized pipeline error by stage + check + cause signatures. */
export function classifyError(e: SerializedPipelineError): ErrorClass {
  // 1) Clearly infra: missing config/voice, gateway/network, Chromium target-closed.
  if (e.stage === "config" || e.stage === "tts") return "infra";
  if (INFRA_CAUSE.test(e.cause)) return "infra";
  // 2) Content by grid check.
  if (e.check && CONTENT_CHECKS.has(e.check)) return "content";
  // 3) Render-stage bundle/compile failure from authored code → content.
  if (e.stage === "render" && BUNDLE_CONTENT_CAUSE.test(e.cause)) return "content";
  // 4) Content by stage.
  if (CONTENT_STAGES.has(e.stage)) return "content";
  // 5) Default: infra (never waste an agent attempt on the unfixable).
  return "infra";
}
