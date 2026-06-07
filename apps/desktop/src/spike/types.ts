/**
 * POC_Spike data shapes (web-dashboard Task 2.3/2.4, design §First build risk,
 * Req 7). The spike runs the path-Y headless agent-runtime 10 consecutive times
 * with NO human input and records, per run, the three signals Req 7.1/7.2/7.6
 * demand. `decideAgentPath` (decide.ts) consumes these to pick Y vs X.
 */

/** Which Agent_Worker implementation the spike adopts. */
export type AgentPath = "Y" | "X";

/**
 * One headless attempt. A run "passes" iff all three signals hold: the contract
 * files loaded, the MCP tools were invoked, AND the produced video cleared every
 * hard grid check + the review gate. A load/tool-invocation failure is recorded
 * as a NON-passing run with its captured cause (Req 7.6).
 */
export type SpikeRun = {
  index: number;
  /** Did the runtime auto-load SKILL.md + AGENTS.md? (Req 7.1) */
  contractLoaded: boolean;
  /** Did the runtime invoke our MCP tools? (Req 7.2) */
  toolsInvoked: boolean;
  /** Did the produced video clear ALL hard grid checks + the review gate? (Req 7.6) */
  videoPassed: boolean;
  /** Captured cause when the run did not pass (load/tool/render/grid failure). */
  failureCause?: string;
};

/** A run passes only when all three required signals are true. */
export function runPassed(run: SpikeRun): boolean {
  return run.contractLoaded && run.toolsInvoked && run.videoPassed;
}

/** The committed spike artifact the implementation tasks read (Task 2.4). */
export type SpikeResult = {
  /** ISO timestamp the spike was recorded, or null if not yet executed. */
  recordedAt: string | null;
  /** All recorded runs (empty until the live spike has been executed). */
  runs: SpikeRun[];
  passed: number;
  total: number;
  /** The adopted path given the runs (≥8/10 ⇒ Y, else X). */
  decision: AgentPath;
  /** True once a real headless spike has actually been executed. */
  executed: boolean;
  notes?: string;
};
