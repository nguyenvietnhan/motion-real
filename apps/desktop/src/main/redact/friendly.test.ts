import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { PipelineStage, SerializedPipelineError, SafetyIssue, Severity } from "@motionreal/pipeline";
import { stripL0Tokens, toFriendlyError, toFriendlyFix } from "./friendly.js";

/**
 * Feature: web-dashboard, Property 6: No engine internals leak into user-facing
 * messages. For any engine error or safety issue (incl. N1–N30 codes, manifest
 * JSON, .tsx source, MCP references, stack traces), the FriendlyError/FriendlyFix
 * has a non-empty plain-language message and contains none of those L0 tokens.
 * (Req 6.8, 11.5, 11.6, 12.2)
 */

const STAGES: PipelineStage[] = [
  "ingest",
  "admission",
  "static-grid",
  "build-gate",
  "determinism",
  "render",
  "render-oracle",
  "review",
  "tts",
  "config",
];

const SEVERITIES: Severity[] = ["error", "warning"];

/** Arbitrary text peppered with L0 tokens that must never survive redaction. */
const leakyText = fc
  .tuple(
    fc.string({ maxLength: 20 }),
    fc.constantFrom("N1", "N9", "N14", "N30", "alone.tsx", "MCP", "{json:1}", "at fn (a.ts:1:2)"),
    fc.string({ maxLength: 20 }),
  )
  .map(([a, token, b]) => `${a} ${token} ${b}`);

const L0_OFFENDERS = [/\bN(?:[1-9]|[12]\d|30)\b/, /\.tsx\b/i, /\bMCP\b/i, /[{}[\]]/, /at\s+\S+:\d+:\d+/];

function assertClean(message: string): void {
  expect(message.trim().length).toBeGreaterThan(0);
  for (const re of L0_OFFENDERS) expect(re.test(message)).toBe(false);
}

const errorArb: fc.Arbitrary<SerializedPipelineError> = fc.record(
  {
    message: leakyText,
    stage: fc.constantFrom(...STAGES),
    cause: leakyText,
    check: fc.option(fc.constantFrom("N1", "N9", "N14", "N18", "N29", "N30"), { nil: undefined }),
    sceneId: fc.option(
      fc.integer({ min: 1, max: 30 }).map((n) => `scene-${String(n).padStart(2, "0")}`),
      { nil: undefined },
    ),
    remediation: fc.option(leakyText, { nil: undefined }),
    severity: fc.constantFrom(...SEVERITIES),
  },
  { requiredKeys: ["message", "stage", "cause", "severity"] },
);

const issueArb: fc.Arbitrary<SafetyIssue> = fc.record(
  {
    check: fc.constantFrom("N1", "N9", "N14", "N17", "N18", "N19", "N20", "N21", "N30"),
    severity: fc.constantFrom(...SEVERITIES),
    sceneId: fc.option(
      fc.integer({ min: 1, max: 30 }).map((n) => `scene-${String(n).padStart(2, "0")}`),
      { nil: undefined },
    ),
    path: fc.option(fc.constantFrom("alone.tsx", "props.headline"), { nil: undefined }),
    message: leakyText,
  },
  { requiredKeys: ["check", "severity", "message"] },
);

describe("Property 6: no engine internals leak", () => {
  it("toFriendlyError produces a clean, non-empty message", () => {
    fc.assert(
      fc.property(errorArb, fc.option(fc.constantFrom<"draft" | "full">("draft", "full"), { nil: undefined }), (err, phase) => {
        const friendly = toFriendlyError(err, phase ? { phase } : {});
        assertClean(friendly.message);
      }),
      { numRuns: 300 },
    );
  });

  it("toFriendlyFix produces a clean, non-empty message", () => {
    fc.assert(
      fc.property(issueArb, (issue) => {
        assertClean(toFriendlyFix(issue).message);
      }),
      { numRuns: 300 },
    );
  });

  it("stripL0Tokens removes every L0 token from arbitrary leaky text", () => {
    fc.assert(
      fc.property(fc.array(leakyText, { minLength: 1, maxLength: 6 }), (parts) => {
        const cleaned = stripL0Tokens(parts.join(" "));
        for (const re of L0_OFFENDERS) expect(re.test(cleaned)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });
});
