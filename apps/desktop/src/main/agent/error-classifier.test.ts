import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { PipelineStage, SafetyIssue, SerializedPipelineError, Severity } from "@news/pipeline";
import { classifyError, classifyIssue, CONTENT_CHECKS } from "./error-classifier.js";

/**
 * Property + self-tests for the error classifier (desktop-author-mode, Req 4).
 */

const ALL_CHECKS = ["N1", "N3", "N4", "N5", "N9", "N10", "N12", "N14", "N16", "N17", "N18", "N19", "N20", "N21", "N22", "N24", "N25", "N28", "N30"];
const ALL_STAGES: PipelineStage[] = ["ingest", "admission", "static-grid", "build-gate", "determinism", "render", "render-oracle", "review", "tts", "config"];
const severityArb = fc.constantFrom<Severity>("error", "warning");

const issueArb: fc.Arbitrary<SafetyIssue> = fc.record({
  check: fc.constantFrom(...ALL_CHECKS),
  severity: severityArb,
  message: fc.string(),
  path: fc.option(fc.string(), { nil: undefined }),
  sceneId: fc.option(fc.string(), { nil: undefined }),
});

const errorArb: fc.Arbitrary<SerializedPipelineError> = fc.record({
  message: fc.string(),
  stage: fc.constantFrom(...ALL_STAGES),
  cause: fc.string(),
  check: fc.option(fc.constantFrom(...ALL_CHECKS), { nil: undefined }),
  sceneId: fc.option(fc.string(), { nil: undefined }),
  remediation: fc.option(fc.string(), { nil: undefined }),
  severity: severityArb,
});

describe("Property 3: error classification total & stable", () => {
  // Feature: desktop-author-mode, Property 3: error classification total & stable
  it("classifyIssue is total and follows CONTENT_CHECKS membership; idempotent", () => {
    fc.assert(
      fc.property(issueArb, (issue) => {
        const out = classifyIssue(issue);
        expect(out === "infra" || out === "content").toBe(true);
        expect(out).toBe(CONTENT_CHECKS.has(issue.check) ? "content" : "infra");
        expect(classifyIssue(issue)).toBe(out); // idempotent
      }),
      { numRuns: 300 },
    );
  });

  it("classifyError is total; config/tts always infra; infra cause tokens always infra", () => {
    fc.assert(
      fc.property(errorArb, (e) => {
        const out = classifyError(e);
        expect(out === "infra" || out === "content").toBe(true);
        if (e.stage === "config" || e.stage === "tts") expect(out).toBe("infra");
        expect(classifyError(e)).toBe(out); // idempotent
      }),
      { numRuns: 300 },
    );
  });

  it("any cause carrying an infra signature classifies as infra regardless of content stage", () => {
    fc.assert(
      fc.property(fc.constantFrom("target closed", "ECONNREFUSED", "gateway timeout", "fetch failed"), fc.constantFrom(...ALL_STAGES), (token, stage) => {
        const e: SerializedPipelineError = { message: "", stage, cause: `boom: ${token}`, severity: "error" };
        expect(classifyError(e)).toBe("infra");
      }),
      { numRuns: 100 },
    );
  });

  // --- non-vacuous self-tests (one per branch) ---
  it("self-test: N14 issue → content", () => {
    expect(classifyIssue({ check: "N14", severity: "error", message: "overflow" })).toBe("content");
  });
  it("self-test: Chromium target-closed → infra", () => {
    expect(classifyError({ message: "", stage: "render", cause: "Page.bringToFront: Target closed", severity: "error" })).toBe("infra");
  });
  it("self-test: config stage → infra", () => {
    expect(classifyError({ message: "", stage: "config", cause: "missing key", severity: "error" })).toBe("infra");
  });
  it("self-test: render-stage bundle compile error → content", () => {
    expect(classifyError({ message: "", stage: "render", cause: "Transform failed in authored/hook.tsx", severity: "error" })).toBe("content");
  });

  // --- runtime crashes inside authored React code → content (the {text}[] bug) ---
  it("self-test: Minified React error #31 (object as child) → content, not infra", () => {
    // The exact failure: a model passed {text}[] where a block wanted string[],
    // so React tried to render an object as a child and threw at frame render.
    const cause =
      "Minified React error #31; visit https://react.dev/errors/31?args[]=object%20with%20keys%20%7Btext%7D for the full message";
    expect(classifyError({ message: "", stage: "render", cause, severity: "error" })).toBe("content");
  });
  it("self-test: runtime null-deref in a scene → content", () => {
    expect(
      classifyError({ message: "", stage: "render", cause: "Cannot read properties of undefined (reading 'map')", severity: "error" }),
    ).toBe("content");
  });
  it("self-test: a real Chromium target-closed still wins over the runtime matcher → infra", () => {
    // INFRA_CAUSE is checked first, so an environment crash is never mis-read as
    // a fixable content error even if other text is present.
    expect(
      classifyError({ message: "", stage: "render", cause: "Target closed while rendering; is not a function", severity: "error" }),
    ).toBe("infra");
  });
  it("self-test: N10 typecheck failure tagged build-gate → content", () => {
    expect(
      classifyError({ message: "", stage: "build-gate", cause: "authored scene typecheck reported 1 error(s)", check: "N10", severity: "error" }),
    ).toBe("content");
  });
});
