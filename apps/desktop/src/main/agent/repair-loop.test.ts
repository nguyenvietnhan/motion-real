import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { SafetyIssue } from "@news/pipeline";
import {
  clampAttempts,
  generateValidateRepair,
  MAX_ATTEMPTS,
  MIN_ATTEMPTS,
  type RepairLoopDeps,
  type SafetyReportView,
} from "./repair-loop.js";
import type { AgentHooks } from "./agent-worker.js";

/**
 * Feature: web-dashboard, Property 5: The generate-validate-repair loop respects
 * its budget. For any maxAttempts (clamped to 1–10) and any sequence of safety
 * reports, the loop performs at most maxAttempts draft renders, stops on the
 * first zero-hard-error report, counts a failed render toward the budget, and
 * returns `exhausted` if the budget is reached with hard errors remaining.
 * (Req 6.3, 6.4, 6.6, 6.7)
 */

type Attempt = { render: boolean; hardErrors: number };

function issues(n: number): SafetyIssue[] {
  return Array.from({ length: n }, () => ({
    check: "N14",
    severity: "error" as const,
    sceneId: "scene-01",
    message: "x",
  }));
}

const noopHooks: AgentHooks = { onProgress() {}, onSceneProduced() {}, onRepair() {} };

const attemptArb: fc.Arbitrary<Attempt> = fc.oneof(
  fc.constant<Attempt>({ render: false, hardErrors: 0 }),
  fc.integer({ min: 0, max: 3 }).map<Attempt>((h) => ({ render: true, hardErrors: h })),
);

describe("Property 5: repair-loop budget", () => {
  it("clampAttempts maps into [1,10] and defaults non-finite to 3", () => {
    fc.assert(
      fc.property(fc.integer({ min: -20, max: 40 }), (n) => {
        const c = clampAttempts(n);
        expect(c).toBeGreaterThanOrEqual(MIN_ATTEMPTS);
        expect(c).toBeLessThanOrEqual(MAX_ATTEMPTS);
      }),
      { numRuns: 200 },
    );
    expect(clampAttempts(Number.NaN)).toBe(3);
  });

  it("renders at most maxAttempts and matches a reference simulation", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: -3, max: 14 }),
        fc.array(attemptArb, { minLength: MAX_ATTEMPTS, maxLength: MAX_ATTEMPTS }),
        async (maxRaw, seq) => {
          const max = clampAttempts(maxRaw);
          let renders = 0;
          let idx = -1;
          const deps: RepairLoopDeps = {
            renderDraft: async () => {
              idx++;
              renders++;
              return { ok: seq[idx]!.render };
            },
            getSafetyReport: async (): Promise<SafetyReportView> => {
              const e = seq[idx]!;
              return { ok: e.hardErrors === 0, hardErrors: issues(e.hardErrors), warnings: [] };
            },
            reauthor: async () => {},
            hooks: noopHooks,
          };

          const outcome = await generateValidateRepair(deps, { maxAttempts: maxRaw });

          // Reference simulation.
          let attempts = 0;
          let remaining = 0;
          let passedAt: number | null = null;
          while (attempts < max) {
            attempts++;
            const e = seq[attempts - 1]!;
            if (!e.render) continue;
            if (e.hardErrors === 0) {
              passedAt = attempts;
              break;
            }
            remaining = e.hardErrors;
          }

          expect(renders).toBeLessThanOrEqual(max);
          if (passedAt !== null) {
            expect(outcome).toEqual({ kind: "passed", attempts: passedAt });
            expect(renders).toBe(passedAt);
          } else {
            expect(outcome).toEqual({ kind: "exhausted", attempts: max, remainingHardErrors: remaining });
            expect(renders).toBe(max);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("stops immediately on a first clean draft (one render)", async () => {
    let renders = 0;
    const deps: RepairLoopDeps = {
      renderDraft: async () => {
        renders++;
        return { ok: true };
      },
      getSafetyReport: async () => ({ ok: true, hardErrors: [], warnings: [] }),
      reauthor: async () => {},
      hooks: noopHooks,
    };
    const outcome = await generateValidateRepair(deps, { maxAttempts: 5 });
    expect(outcome).toEqual({ kind: "passed", attempts: 1 });
    expect(renders).toBe(1);
  });
});
