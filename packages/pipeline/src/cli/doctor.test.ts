import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runDoctor,
  defaultCheckN10Typecheck,
  defaultCheckTheme,
  defaultCheckFonts,
  type DoctorCheck,
  type DoctorDeps,
} from "./cli.js";

// Feature: tool-productization — doctor readiness checks (R6).

const PASS = (name: string): DoctorCheck => ({ name, ok: true, detail: "ok" });
const FAIL = (name: string): DoctorCheck => ({ name, ok: false, detail: "missing" });
const WARN = (name: string): DoctorCheck => ({ name, ok: false, severity: "warning", detail: "warning" });
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..", "..");

/** The seven check slots runDoctor composes, in order. */
const SLOTS = ["checkEnv", "checkFfmpeg", "checkBrowser", "checkRegistry", "checkN10Typecheck", "checkTheme", "checkFonts"] as const;

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
        // Every check ran — the report always has all seven, regardless of failures.
        expect(report.checks).toHaveLength(7);
        // overall ready iff no failures (R6.3)
        expect(report.ok).toBe(expectedFailures.length === 0);
        // Every failure is listed (R6.2/R6.4) — none swallowed by short-circuit.
        const reportedFailures = report.checks.filter((c) => !c.ok).map((c) => c.name).sort();
        expect(reportedFailures).toEqual(expectedFailures.sort());
      }),
      { numRuns: 100 },
    );
  });

  it("keeps warning checks diagnostic-only", async () => {
    const report = await runDoctor({
      checkEnv: () => PASS("checkEnv"),
      checkFfmpeg: async () => PASS("checkFfmpeg"),
      checkBrowser: async () => PASS("checkBrowser"),
      checkRegistry: () => PASS("checkRegistry"),
      checkN10Typecheck: () => WARN("checkN10Typecheck"),
      checkTheme: () => PASS("checkTheme"),
      checkFonts: () => PASS("checkFonts"),
    });

    expect(report.ok).toBe(true);
    expect(report.checks).toContainEqual(WARN("checkN10Typecheck"));
  });
});

describe("doctor — per-check defaults (R6.1, R6.2)", () => {
  it("N10 authored typecheck layout passes when the workspace source/type paths resolve", () => {
    const check = defaultCheckN10Typecheck(root);
    expect(check.name).toBe("N10 authored typecheck layout");
    expect(check.ok).toBe(true);
    expect(check.detail).toMatch(/required source\/type paths resolved/);
  });

  it("N10 authored typecheck layout reports a warning when source paths are missing", () => {
    const check = defaultCheckN10Typecheck(resolve(here, "no-such-workspace"));
    expect(check.name).toBe("N10 authored typecheck layout");
    expect(check.ok).toBe(false);
    expect(check.severity).toBe("warning");
    expect(check.detail).toMatch(/missing .*required source\/type path/);
  });

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
