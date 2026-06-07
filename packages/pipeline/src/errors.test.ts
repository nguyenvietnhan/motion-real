import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { PipelineError, isPipelineError, serializeError, type PipelineStage } from "./errors.js";

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

const arbInit = fc.record(
  {
    stage: fc.constantFrom(...STAGES),
    cause: fc.string({ minLength: 1, maxLength: 80 }),
    check: fc.option(fc.constantFrom("N9", "N14", "N18", "N30"), { nil: undefined }),
    sceneId: fc.option(fc.string({ minLength: 1, maxLength: 12 }), { nil: undefined }),
    remediation: fc.option(fc.string({ minLength: 1, maxLength: 80 }), { nil: undefined }),
    severity: fc.option(fc.constantFrom("error" as const, "warning" as const), { nil: undefined }),
  },
  { requiredKeys: ["stage", "cause"] },
);

// Feature: tool-productization, Property 18: Structured error fidelity across surfaces
describe("PipelineError — Property 18: structured error fidelity", () => {
  it("toSerialized preserves stage/cause/check/sceneId/severity/remediation", () => {
    fc.assert(
      fc.property(arbInit, (init) => {
        const err = new PipelineError(init);
        const s = err.toSerialized();

        expect(s.stage).toBe(init.stage);
        expect(s.cause).toBe(init.cause);
        expect(s.severity).toBe(init.severity ?? "error"); // defaults to error
        expect(s.check).toBe(init.check);
        expect(s.sceneId).toBe(init.sceneId);
        expect(s.remediation).toBe(init.remediation);
        // The message names the stage and cause; tags appear only when set.
        expect(s.message).toContain(`[${init.stage}]`);
        expect(s.message).toContain(init.cause);
        if (init.check) expect(s.message).toContain(init.check);
        if (init.sceneId) expect(s.message).toContain(init.sceneId);
      }),
      { numRuns: 200 },
    );
  });

  it("a serialized error round-trips through JSON unchanged (transport-safe)", () => {
    fc.assert(
      fc.property(arbInit, (init) => {
        const s = new PipelineError(init).toSerialized();
        expect(JSON.parse(JSON.stringify(s))).toEqual(s);
      }),
      { numRuns: 100 },
    );
  });
});

describe("PipelineError — basics", () => {
  it("is an Error, defaults severity to error, and is recognized by the guard", () => {
    const err = new PipelineError({ stage: "ingest", cause: "boom" });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("PipelineError");
    expect(err.severity).toBe("error");
    expect(isPipelineError(err)).toBe(true);
    expect(isPipelineError(new Error("plain"))).toBe(false);
  });

  it("serializeError wraps a raw error at the fallback stage and passes through a PipelineError", () => {
    const wrapped = serializeError(new Error("raw failure"), "render");
    expect(wrapped.stage).toBe("render");
    expect(wrapped.cause).toBe("raw failure");
    expect(wrapped.severity).toBe("error");

    const pe = new PipelineError({ stage: "tts", cause: "missing voice id", remediation: "set VIETNAMESE_VOICEID" });
    expect(serializeError(pe)).toEqual(pe.toSerialized());
  });
});
