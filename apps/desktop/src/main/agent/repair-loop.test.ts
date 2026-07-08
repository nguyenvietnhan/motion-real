import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { SafetyIssue } from "@motionreal/pipeline";
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
 * Property 5: The generate-validate-repair loop respects
 * its budget. For any maxAttempts (clamped to 1–10) and any sequence of safety
 * reports, the loop performs at most maxAttempts draft renders, stops on the
 * first zero-hard-error report, counts a failed render toward the budget, and
 * returns `exhausted` if the budget is reached with hard errors remaining.
 *
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

  it("an already-aborted signal stops before the first render (cancelled, attempts:0)", async () => {
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
    const outcome = await generateValidateRepair(deps, { maxAttempts: 5, signal: AbortSignal.abort() });
    expect(outcome).toEqual({ kind: "cancelled", attempts: 0 });
    expect(renders).toBe(0);
  });

  it("a signal aborted mid-loop stops before the next attempt (cancelled, no further render)", async () => {
    const ctrl = new AbortController();
    let renders = 0;
    let reports = 0;
    let reauthors = 0;
    const deps: RepairLoopDeps = {
      renderDraft: async () => {
        renders++;
        // A user "Dừng render" lands DURING the render: the engine throws a
        // RenderCancelledError, serialized to a failed render. Simulate that by
        // aborting then returning {ok:false}. The report below keeps a hard error
        // so the loop WOULD otherwise read it and reauthor before the next attempt.
        ctrl.abort();
        return { ok: false };
      },
      getSafetyReport: async () => {
        reports++;
        return { ok: false, hardErrors: issues(1), warnings: [] };
      },
      reauthor: async () => {
        reauthors++;
      },
      hooks: noopHooks,
    };
    const outcome = await generateValidateRepair(deps, { maxAttempts: 5, signal: ctrl.signal });
    expect(outcome).toEqual({ kind: "cancelled", attempts: 1 });
    expect(renders).toBe(1);
    // The regression this guards: a mid-render cancel must stop the INSTANT the
    // render returns — never reading the (now stale) safety report nor spending a
    // reauthor AI call before the next iteration's top-of-loop check. Both were
    // wasted on every cancel before the fix (the user saw a delayed/no-op stop).
    expect(reports).toBe(0);
    expect(reauthors).toBe(0);
  });
});

describe("Property 4: repair budget and routing", () => {
  // Property 4: repair budget and routing
  const infraIssue = (sceneId?: string): SafetyIssue => ({ check: "N13", severity: "error", message: "infra", ...(sceneId ? { sceneId } : {}) });
  const contentIssue = (sceneId: string): SafetyIssue => ({ check: "N14", severity: "error", sceneId, message: "content" });
  const n10SpringIssue = (sceneId: string): SafetyIssue => ({
    check: "N10",
    severity: "error",
    sceneId,
    message: "TS2353: Object literal may only specify known properties, and 'tension' does not exist in type 'Partial<SpringConfig>'.",
  });
  const n31Issue = (sceneId: string): SafetyIssue => ({ check: "N31", severity: "error", sceneId, message: "runtime fallback" });

  it("an infra hard error stops with kind 'infra' and never calls reauthor", async () => {
    let reauthored = 0;
    const deps: RepairLoopDeps = {
      renderDraft: async () => ({ ok: true }),
      getSafetyReport: async () => ({ ok: false, hardErrors: [contentIssue("scene-01"), infraIssue()], warnings: [] }),
      reauthor: async () => {
        reauthored++;
      },
      hooks: noopHooks,
    };
    const outcome = await generateValidateRepair(deps, { maxAttempts: 5 });
    expect(outcome).toEqual({ kind: "infra", attempts: 1 });
    expect(reauthored).toBe(0);
  });

  it("only content scenes (with their issues) are passed to reauthor", async () => {
    let renders = 0;
    let received: { sceneId: string; issues?: SafetyIssue[] }[] | null = null;
    const deps: RepairLoopDeps = {
      renderDraft: async () => {
        renders++;
        return { ok: true };
      },
      getSafetyReport: async () =>
        renders === 1
          ? { ok: false, hardErrors: [contentIssue("scene-01"), contentIssue("scene-03")], warnings: [] }
          : { ok: true, hardErrors: [], warnings: [] },
      reauthor: async (targets) => {
        received = targets;
      },
      hooks: noopHooks,
    };
    const outcome = await generateValidateRepair(deps, { maxAttempts: 3 });
    expect(outcome).toEqual({ kind: "passed", attempts: 2 });
    expect(received!.map((t) => t.sceneId).sort()).toEqual(["scene-01", "scene-03"]);
    expect(received!.every((t) => (t.issues ?? []).length > 0)).toBe(true);
  });

  it("N31 runtime fallback issues are targetable content defects", async () => {
    let renders = 0;
    let received: { sceneId: string; issues?: SafetyIssue[] }[] | null = null;
    const deps: RepairLoopDeps = {
      renderDraft: async () => {
        renders++;
        return { ok: true };
      },
      getSafetyReport: async () =>
        renders === 1
          ? { ok: false, hardErrors: [n31Issue("scene-04")], warnings: [] }
          : { ok: true, hardErrors: [], warnings: [] },
      reauthor: async (targets) => {
        received = targets;
      },
      hooks: noopHooks,
    };
    const outcome = await generateValidateRepair(deps, { maxAttempts: 3 });
    expect(outcome).toEqual({ kind: "passed", attempts: 2 });
    expect(received).toEqual([{ sceneId: "scene-04", issues: [n31Issue("scene-04")] }]);
  });

  it("N10 spring-config typecheck failures are targetable content defects", async () => {
    let renders = 0;
    let received: { sceneId: string; issues?: SafetyIssue[] }[] | null = null;
    const issue = n10SpringIssue("scene-09");
    const deps: RepairLoopDeps = {
      renderDraft: async () => {
        renders++;
        return renders === 1
          ? {
              ok: false,
              error: {
                message: "",
                stage: "build-gate",
                cause: "authored scene typecheck reported 1 error(s)",
                check: "N10",
                sceneId: "scene-09",
                severity: "error",
              },
            }
          : { ok: true };
      },
      getSafetyReport: async () =>
        renders === 1
          ? { ok: false, hardErrors: [issue], warnings: [] }
          : { ok: true, hardErrors: [], warnings: [] },
      reauthor: async (targets) => {
        received = targets;
      },
      hooks: noopHooks,
    };

    const outcome = await generateValidateRepair(deps, { maxAttempts: 3 });

    expect(outcome).toEqual({ kind: "passed", attempts: 2 });
    expect(received).toEqual([{ sceneId: "scene-09", issues: [issue] }]);
  });

  it("content errors with no scene to target ⇒ exhausted without looping forever", async () => {
    let reauthored = 0;
    const deps: RepairLoopDeps = {
      renderDraft: async () => ({ ok: true }),
      getSafetyReport: async () => ({ ok: false, hardErrors: [{ check: "N14", severity: "error", message: "no scene id" }], warnings: [] }),
      reauthor: async () => {
        reauthored++;
      },
      hooks: noopHooks,
    };
    const outcome = await generateValidateRepair(deps, { maxAttempts: 4 });
    expect(outcome.kind).toBe("exhausted");
    expect(reauthored).toBe(0);
  });

  it("a FAILED render whose cause is infra ⇒ kind 'infra' (not exhausted), no reauthor", async () => {
    let reauthored = 0;
    const deps: RepairLoopDeps = {
      renderDraft: async () => ({ ok: false, error: { message: "", stage: "tts", cause: "missing VIETNAMESE_API_KEY", severity: "error" } }),
      getSafetyReport: async () => ({ ok: true, hardErrors: [], warnings: [] }),
      reauthor: async () => {
        reauthored++;
      },
      hooks: noopHooks,
    };
    const outcome = await generateValidateRepair(deps, { maxAttempts: 5 });
    expect(outcome).toEqual({ kind: "infra", attempts: 1 });
    expect(reauthored).toBe(0);
  });

  it("a FAILED render with no/unknown error ⇒ consumes the attempt (exhausted)", async () => {
    const deps: RepairLoopDeps = {
      renderDraft: async () => ({ ok: false }),
      getSafetyReport: async () => ({ ok: true, hardErrors: [], warnings: [] }),
      reauthor: async () => {},
      hooks: noopHooks,
    };
    const outcome = await generateValidateRepair(deps, { maxAttempts: 2 });
    expect(outcome).toEqual({ kind: "exhausted", attempts: 2, remainingHardErrors: 0 });
  });

  it("a report read failure (ok:false, no errors) is NOT a false pass", async () => {
    const deps: RepairLoopDeps = {
      renderDraft: async () => ({ ok: true }),
      getSafetyReport: async () => ({ ok: false, hardErrors: [], warnings: [] }),
      reauthor: async () => {},
      hooks: noopHooks,
    };
    const outcome = await generateValidateRepair(deps, { maxAttempts: 2 });
    expect(outcome.kind).not.toBe("passed");
  });

  it("a CONTENT-class FAILED render reauthors the scene its persisted report names, then passes", async () => {
    // The N10 / runtime-crash case: the draft never finishes (render fails), but
    // a pre-render content gate persisted a scene-targeted report. The loop must
    // read it, reauthor that scene, and succeed on the next attempt — instead of
    // re-rendering the identical broken code (the "retry does nothing" bug).
    let renders = 0;
    let reauthored: string[] | null = null;
    const deps: RepairLoopDeps = {
      renderDraft: async () => {
        renders++;
        // First attempt: a content-class crash (React #31). After the reauthor, it renders.
        return renders === 1
          ? { ok: false, error: { message: "", stage: "render", cause: "authored scene runtime probe failed", check: "N31", severity: "error" } }
          : { ok: true };
      },
      getSafetyReport: async () =>
        renders === 1
          ? { ok: false, hardErrors: [n31Issue("scene-05")], warnings: [] }
          : { ok: true, hardErrors: [], warnings: [] },
      reauthor: async (targets) => {
        reauthored = targets.map((t) => t.sceneId);
      },
      hooks: noopHooks,
    };
    const outcome = await generateValidateRepair(deps, { maxAttempts: 3 });
    expect(outcome).toEqual({ kind: "passed", attempts: 2 });
    expect(reauthored).toEqual(["scene-05"]);
  });

  it("a CONTENT-class FAILED render with NO targetable scene just consumes attempts (no infinite loop)", async () => {
    // A runtime crash that persisted no scene id (or no report) can't be routed —
    // it must consume the attempt and retry, then exhaust, never spin forever.
    let renders = 0;
    let reauthored = 0;
    const deps: RepairLoopDeps = {
      renderDraft: async () => {
        renders++;
        return { ok: false, error: { message: "", stage: "render", cause: "Minified React error #31", severity: "error" } };
      },
      getSafetyReport: async () => ({ ok: false, hardErrors: [], warnings: [] }),
      reauthor: async () => {
        reauthored++;
      },
      hooks: noopHooks,
    };
    const outcome = await generateValidateRepair(deps, { maxAttempts: 3 });
    expect(outcome.kind).toBe("exhausted");
    expect(renders).toBe(3);
    expect(reauthored).toBe(0);
  });
});
