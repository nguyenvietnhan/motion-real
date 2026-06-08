import type { SafetyIssue } from "@news/pipeline";
import type { AgentHooks, RepairLoopOptions, RepairOutcome } from "./agent-worker.js";
import type { ReauthorTarget } from "./custom-loop-worker.js";
import { toFriendlyFix } from "../redact/friendly.js";
import { classifyIssue } from "./error-classifier.js";

/**
 * The generate-validate-repair loop (desktop-author-mode, Req 3/4/7). Pure
 * orchestration over injected effects: render a draft → read the safety report →
 * if hard errors remain, CLASSIFY them — an Infra_Error stops the loop (the agent
 * can't fix it), Content_Errors are grouped per scene and re-authored before the
 * next render. Stops on the first zero-hard-error report (Property 4).
 */

export const DEFAULT_MAX_ATTEMPTS = 3;
export const MIN_ATTEMPTS = 1;
export const MAX_ATTEMPTS = 10;

/** Clamp the attempt budget into [1,10]; a non-finite value falls back to 3. */
export function clampAttempts(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_MAX_ATTEMPTS;
  return Math.min(MAX_ATTEMPTS, Math.max(MIN_ATTEMPTS, Math.floor(n)));
}

/** The hard-error subset split the loop reads after each draft. */
export type SafetyReportView = { ok: boolean; hardErrors: SafetyIssue[]; warnings: SafetyIssue[] };

export type RepairLoopDeps = {
  /** Render one draft; `ok:false` is a failed render (still counts toward budget). */
  renderDraft: () => Promise<{ ok: boolean }>;
  /** Read the safety report for the just-rendered draft. */
  getSafetyReport: () => Promise<SafetyReportView>;
  /** Re-author the flagged content scenes (with their issues) before the next attempt. */
  reauthor: (targets: ReauthorTarget[]) => Promise<void>;
  hooks: AgentHooks;
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
    attempts++;
    const render = await deps.renderDraft();
    deps.hooks.onProgress(attempts / max);

    if (!render.ok) {
      // A failed render consumes the attempt; retry while budget remains.
      continue;
    }

    const report = await deps.getSafetyReport();
    if (report.ok || report.hardErrors.length === 0) {
      return { kind: "passed", attempts };
    }

    // An infra error is not agent-fixable — stop without spending a reauthor.
    if (report.hardErrors.some((e) => classifyIssue(e) === "infra")) {
      return { kind: "infra", attempts };
    }

    remainingHardErrors = report.hardErrors.length;
    for (const issue of report.hardErrors) deps.hooks.onRepair(toFriendlyFix(issue));

    if (attempts < max) {
      const targets = contentTargets(report.hardErrors);
      if (targets.length === 0) break; // content errors with no scene to target
      await deps.reauthor(targets);
    }
  }

  return { kind: "exhausted", attempts, remainingHardErrors };
}
