import { describe, expect, it } from "vitest";
import { ADOPT_Y_THRESHOLD, decideAgentPath, summarizeSpike } from "./decide.js";
import { runSpike, type SpikeRuntime } from "./harness.js";
import { type SpikeRun } from "./types.js";

/**
 * Feature: web-dashboard, Task 2.5 — the adoption-decision rule boundary
 * (Req 7.3/7.4). A passing run requires all three signals; the threshold is
 * exactly ≥8 passing of 10 ⇒ Y, otherwise X.
 */

function pass(index: number): SpikeRun {
  return { index, contractLoaded: true, toolsInvoked: true, videoPassed: true };
}
function fail(index: number, cause = "render failed"): SpikeRun {
  return { index, contractLoaded: true, toolsInvoked: true, videoPassed: false, failureCause: cause };
}

/** First `n` of 10 runs pass, the rest fail. */
function runsWith(passing: number): SpikeRun[] {
  return Array.from({ length: 10 }, (_v, i) => (i < passing ? pass(i) : fail(i)));
}

describe("decideAgentPath — ≥8/10 boundary", () => {
  it("adopts X below 8 passing and Y at/above 8", () => {
    expect(decideAgentPath(runsWith(7))).toBe("X");
    expect(decideAgentPath(runsWith(8))).toBe("Y");
    expect(decideAgentPath(runsWith(10))).toBe("Y");
    expect(ADOPT_Y_THRESHOLD).toBe(8);
  });

  it("covers the full 0..10 sweep monotonically", () => {
    for (let n = 0; n <= 10; n++) {
      expect(decideAgentPath(runsWith(n))).toBe(n >= 8 ? "Y" : "X");
    }
  });

  it("counts only runs where ALL three signals hold as passing", () => {
    // 8 runs each missing exactly one required signal ⇒ 0 passing ⇒ X.
    const partial: SpikeRun[] = [
      { index: 0, contractLoaded: false, toolsInvoked: true, videoPassed: true },
      { index: 1, contractLoaded: true, toolsInvoked: false, videoPassed: true },
      { index: 2, contractLoaded: true, toolsInvoked: true, videoPassed: false },
      ...Array.from({ length: 5 }, (_v, i) => fail(i + 3)),
    ];
    expect(decideAgentPath(partial)).toBe("X");
  });

  it("summarizeSpike records the passing count, total, and decision", () => {
    const result = summarizeSpike(runsWith(8), "2026-06-07T00:00:00.000Z");
    expect(result).toMatchObject({ passed: 8, total: 10, decision: "Y", executed: true });
  });
});

describe("runSpike harness", () => {
  it("runs the runtime `count` times and records each attempt", async () => {
    let calls = 0;
    const runtime: SpikeRuntime = {
      runOnce: async () => {
        calls++;
        return { contractLoaded: true, toolsInvoked: true, videoPassed: calls <= 8 };
      },
    };
    const result = await runSpike(runtime, { count: 10, now: () => "2026-06-07T00:00:00.000Z" });
    expect(result.total).toBe(10);
    expect(result.passed).toBe(8);
    expect(result.decision).toBe("Y");
    expect(result.runs.map((r) => r.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("captures a thrown run as a non-passing attempt with its cause (Req 7.6)", async () => {
    const runtime: SpikeRuntime = {
      runOnce: async (i) => {
        if (i === 2) throw new Error("runtime could not load AGENTS.md");
        return { contractLoaded: true, toolsInvoked: true, videoPassed: true };
      },
    };
    const result = await runSpike(runtime, { count: 3, now: () => "t" });
    expect(result.total).toBe(3);
    expect(result.passed).toBe(2);
    const failedRun = result.runs.find((r) => r.index === 2);
    expect(failedRun?.videoPassed).toBe(false);
    expect(failedRun?.failureCause).toMatch(/AGENTS\.md/);
  });
});
