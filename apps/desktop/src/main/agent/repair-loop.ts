import type { SafetyIssue, SerializedPipelineError } from "@motionreal/pipeline";
import type { AgentHooks, RepairLoopOptions, RepairOutcome } from "./agent-worker.js";
import type { ReauthorTarget } from "./custom-loop-worker.js";
import {
  DEFAULT_MAX_REPAIR_ATTEMPTS,
  MAX_REPAIR_ATTEMPTS,
  MIN_REPAIR_ATTEMPTS,
  clampMaxRepairAttempts,
} from "../../shared/settings-model.js";
import { toFriendlyFix } from "../redact/friendly.js";
import { classifyIssue, classifyError } from "./error-classifier.js";

/**
 * The generate-validate-repair loop (desktop-author-mode, Req 3/4/7). Pure
 * orchestration over injected effects: render a draft → read the safety report →
 * if hard errors remain, CLASSIFY them — an Infra_Error stops the loop (the agent
 * can't fix it), Content_Errors are grouped per scene and re-authored before the
 * next render. Stops on the first zero-hard-error report (Property 4).
 */

export const DEFAULT_MAX_ATTEMPTS = DEFAULT_MAX_REPAIR_ATTEMPTS;
export const MIN_ATTEMPTS = MIN_REPAIR_ATTEMPTS;
export const MAX_ATTEMPTS = MAX_REPAIR_ATTEMPTS;

/** Clamp the attempt budget into [1,10]; a non-finite value falls back to 3. */
export function clampAttempts(n: number): number {
  return clampMaxRepairAttempts(n);
}

/** The hard-error subset split the loop reads after each draft. */
export type SafetyReportView = { ok: boolean; hardErrors: SafetyIssue[]; warnings: SafetyIssue[] };

/** A draft render result; a failure carries the engine error so it can be classified. */
export type RenderResult = { ok: true } | { ok: false; error?: SerializedPipelineError };

export type RepairLoopDeps = {
  /** Render one draft; on failure carries the engine error for infra/content routing. */
  renderDraft: () => Promise<RenderResult>;
  /** Read the safety report for the just-rendered draft. */
  getSafetyReport: () => Promise<SafetyReportView>;
  /** Re-author the flagged content scenes (with their issues) before the next attempt. */
  reauthor: (targets: ReauthorTarget[]) => Promise<void>;
  hooks: AgentHooks;
  /** User-cancel signal: when aborted the loop stops between attempts and returns `cancelled`. */
  signal?: AbortSignal;
};

/** Group content-class hard errors by scene into reauthor targets (carrying issues). */
export function contentTargets(hardErrors: SafetyIssue[]): ReauthorTarget[] {
  const byScene = new Map<string, SafetyIssue[]>();
  for (const e of hardErrors) {
    if (classifyIssue(e) !== "content" || !e.sceneId) continue;
    const list = byScene.get(e.sceneId) ?? [];
    list.push(e);
    byScene.set(e.sceneId, list);
  }
  return [...byScene.entries()].map(([sceneId, issues]) => ({ sceneId, issues }));
}

/**
 * Run the loop. At most `maxAttempts` draft renders; returns `passed` on the
 * first clean report, `infra` when an unfixable infra error appears (no reauthor
 * spent), otherwise `exhausted` with the remaining hard-error count.
 */
export async function generateValidateRepair(
  deps: RepairLoopDeps,
  opts: RepairLoopOptions,
): Promise<RepairOutcome> {
  const max = clampAttempts(opts.maxAttempts);
  let attempts = 0;
  let remainingHardErrors = 0;

  while (attempts < max) {
    // A user "Dừng render" stops the loop between attempts; the in-flight render
    // itself is aborted via the signal threaded into renderDraft (Remotion
    // cancelSignal). Report `cancelled` so the controller restores the prior
    // reviewable stage instead of treating the stop as a render failure.
    if (opts.signal?.aborted) return { kind: "cancelled", attempts };
    attempts++;
    const render = await deps.renderDraft();
    // NOTE: smooth render progress is driven by the renderer's real per-frame
    // callback (WorkspaceController.reportRenderProgress); we deliberately do NOT
    // emit a coarse attempts/max ratio here — it would clobber the live percent.

    // A user "Dừng render" DURING the render surfaces as a failed render (the
    // engine threw a RenderCancelledError, serialized to {ok:false}). Re-check
    // the signal the instant the render returns — BEFORE reading a (now stale)
    // safety report and BEFORE spending a reauthor AI call — so a mid-render
    // cancel stops promptly instead of wasting another full attempt. Without
    // this, the loop would read the previous attempt's report and fire a
    // pointless reauthor before the next iteration's top-of-loop check.
    if (opts.signal?.aborted) return { kind: "cancelled", attempts };

    // A failed render whose cause is infra (missing voice key, gateway, Chromium
    // "target closed") is not agent-fixable — stop as `infra`.
    if (!render.ok && render.error && classifyError(render.error) === "infra") {
      return { kind: "infra", attempts };
    }

    // Read the report in BOTH cases. On success it's this render's oracle report.
    // On a CONTENT-class failure the draft never finished, but a PRE-render
    // content gate (N10 authored-typecheck) persists its flagged scenes — each
    // carrying a sceneId — before failing. Reading it here is what lets the loop
    // reauthor the precise broken scene instead of re-rendering identical code
    // that crashes the same way (the exact "retry does nothing" bug).
    const report = await deps.getSafetyReport();

    // The ONLY pass is a successful render with a zero-hard-error report; a
    // failed-report read (ok:false, no errors) and any failed render are not.
    if (render.ok && report.ok) {
      return { kind: "passed", attempts };
    }

    // An infra error in the report is not agent-fixable — stop without a reauthor.
    if (report.hardErrors.some((e) => classifyIssue(e) === "infra")) {
      return { kind: "infra", attempts };
    }

    if (report.hardErrors.length > 0) {
      remainingHardErrors = report.hardErrors.length;
      for (const issue of report.hardErrors) deps.hooks.onRepair(toFriendlyFix(issue));
    }

    if (attempts < max) {
      const targets = contentTargets(report.hardErrors);
      if (targets.length > 0) {
        await deps.reauthor(targets);
        continue; // re-render the repaired scene(s) on the next attempt
      }
      // No scene to target. A rendered-but-flagged report with no targetable
      // scene can't be improved by another attempt — stop. A FAILED render with
      // nothing targetable (e.g. a runtime crash that persisted no scene) just
      // consumes the attempt and retries.
      if (render.ok) break;
    }
  }

  return { kind: "exhausted", attempts, remainingHardErrors };
}
