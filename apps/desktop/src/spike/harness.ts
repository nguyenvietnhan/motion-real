import { type SpikeResult, type SpikeRun } from "./types.js";
import { summarizeSpike } from "./decide.js";

/**
 * The headless POC_Spike harness (web-dashboard Task 2.3, Req 7.1/7.2/7.6).
 *
 * It runs the path-Y agent-runtime `count` times (default 10) with NO human
 * input and records each attempt. The runtime itself is injected as a
 * `SpikeRuntime` seam so the harness is structured + unit-testable here; the
 * REAL adapter (embedding OpenCode/Cline pointed at the bundled Model_Gateway,
 * auto-loading SKILL.md/AGENTS.md, discovering the MCP tools) is wired in when
 * the runtime is embedded. A thrown error inside a run is captured as a
 * NON-passing run with its cause rather than aborting the whole spike (Req 7.6).
 */
export interface SpikeRuntime {
  /** Execute ONE fully-headless authoring run and report its three signals. */
  runOnce(index: number): Promise<Omit<SpikeRun, "index">>;
}

export type SpikeHarnessOptions = { count?: number; now?: () => string };

export async function runSpike(
  runtime: SpikeRuntime,
  opts: SpikeHarnessOptions = {},
): Promise<SpikeResult> {
  const count = opts.count ?? 10;
  const now = opts.now ?? (() => new Date().toISOString());
  const runs: SpikeRun[] = [];

  for (let index = 0; index < count; index++) {
    try {
      const signals = await runtime.runOnce(index);
      runs.push({ index, ...signals });
    } catch (error) {
      runs.push({
        index,
        contractLoaded: false,
        toolsInvoked: false,
        videoPassed: false,
        failureCause: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return summarizeSpike(runs, now());
}
