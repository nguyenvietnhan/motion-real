import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  runDoctor,
  defaultCheckTheme,
  defaultCheckFonts,
  type DoctorCheck,
  type DoctorDeps,
} from "./cli.js";

// Feature: tool-productization — doctor readiness checks (R6).

const PASS = (name: string): DoctorCheck => ({ name, ok: true, detail: "ok" });
const FAIL = (name: string): DoctorCheck => ({ name, ok: false, detail: "missing" });

/** The six check slots runDoctor composes, in order. */
const SLOTS = ["checkEnv", "checkFfmpeg", "checkBrowser", "checkRegistry", "checkTheme", "checkFonts"] as const;

describe("doctor — Property 16: reports every failure (never short-circuits)", () => {
  it("for any subset of failing checks, runDoctor runs all and lists exactly those failures", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }), async (oks) => {
        const deps: DoctorDeps = {};
        const expectedFailures: string[] = [];
        SLOTS.forEach((slot, i) => {
          const name = slot;
          const ok = oks[i]!;
          if (!ok) expectedFailures.push(name);
          const check = ok ? PASS(name) : FAIL(name);
          // ffmpeg + browser slots are async in the real API.
          (deps as Record<string, unknown>)[slot] =
            slot === "checkFfmpeg" || slot === "checkBrowser" ? async () => check : () => check;
        });

        const report = await runDoctor(deps);
        // Every check ran — the report always has all six, regardless of failures.
        expect(report.checks).toHaveLength(6);
        // overall ready iff no failures (R6.3)
        expect(report.ok).toBe(expectedFailures.length === 0);
        // Every failure is listed (R6.2/R6.4) — none swallowed by short-circuit.
        const reportedFailures = report.checks.filter((c) => !c.ok).map((c) => c.name).sort();
        expect(reportedFailures).toEqual(expectedFailures.sort());
      }),
      { numRuns: 100 },
    );
  });
});

describe("doctor — per-check defaults (R6.1, R6.2)", () => {
  it("theme-resolution check passes: the neutral theme resolves", () => {
    const check = defaultCheckTheme();
    expect(check.name).toBe("theme");
    expect(check.ok).toBe(true);
    expect(check.detail).toMatch(/neutral/);
  });

  it("font check passes: neutral render fonts cover the vietnamese subset", () => {
    const check = defaultCheckFonts();
    expect(check.name).toBe("fonts (vietnamese coverage)");
    expect(check.ok).toBe(true);
    expect(check.detail).toMatch(/vietnamese/i);
  });
});
