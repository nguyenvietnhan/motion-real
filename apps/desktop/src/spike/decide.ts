import { type AgentPath, type SpikeResult, type SpikeRun, runPassed } from "./types.js";

/**
 * The adoption-decision rule (web-dashboard Task 2.4, Req 7.3/7.4).
 *
 * Pure and total: adopt path Y (the headless agent-runtime) iff AT LEAST 8 of
 * the runs passed; otherwise fall back to path X (the custom loop + Preprompt).
 * The threshold is on the COUNT of passing runs (`runPassed`), not the array
 * length, so the canonical 10-run spike maps exactly: 7 ⇒ X, 8 ⇒ Y, 10 ⇒ Y.
 */
export const ADOPT_Y_THRESHOLD = 8;

export function decideAgentPath(runs: SpikeRun[]): AgentPath {
  const passed = runs.filter(runPassed).length;
  return passed >= ADOPT_Y_THRESHOLD ? "Y" : "X";
}

/** Build the persisted `SpikeResult` artifact from a completed set of runs. */
export function summarizeSpike(runs: SpikeRun[], recordedAt: string, notes?: string): SpikeResult {
  const passed = runs.filter(runPassed).length;
  return {
    recordedAt,
    runs,
    passed,
    total: runs.length,
    decision: decideAgentPath(runs),
    executed: runs.length > 0,
    notes,
  };
}
