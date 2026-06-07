import type { SafetyIssue } from "@news/pipeline";
import type { AgentHooks, RepairLoopOptions, RepairOutcome } from "./agent-worker.js";
import { toFriendlyFix } from "../redact/friendly.js";

/**
 * The generate-validate-repair loop (web-dashboard Task 5.2, design §loop,
 * Req 6). Pure orchestration over injected effects so it is fully testable
 * without a live render: render a draft → read the safety report → if hard
 * errors remain and budget allows, re-author the flagged scenes and re-render;
 * stop on the first zero-hard-error report (Property 5).
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
  /** Render one draft; `ok:false` is a failed render (still counts toward budget, Req 6.6). */
  renderDraft: () => Promise<{ ok: boolean }>;
  /** Read the safety report for the just-rendered draft. */
  getSafetyReport: () => Promise<SafetyReportView>;
  /** Re-author the flagged scenes before the next attempt. */
  reauthor: (sceneIds: string[]) => Promise<void>;
  hooks: AgentHooks;
};

function flaggedSceneIds(hardErrors: SafetyIssue[]): string[] {
  return [...new Set(hardErrors.map((e) => e.sceneId).filter((id): id is string => Boolean(id)))];
}

/**
 * Run the loop. At most `maxAttempts` draft renders; returns `passed` on the
 * first report with zero hard errors, otherwise `exhausted` with the remaining
 * hard-error count. Each repaired error is surfaced via `onRepair` in plain
 * language (no N-codes) before the next render (Req 6.8).
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

    remainingHardErrors = report.hardErrors.length;
    for (const issue of report.hardErrors) deps.hooks.onRepair(toFriendlyFix(issue));

    if (attempts < max) {
      await deps.reauthor(flaggedSceneIds(report.hardErrors));
    }
  }

  return { kind: "exhausted", attempts, remainingHardErrors };
}
