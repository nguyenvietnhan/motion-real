import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { FRIENDLY_LABELS, FRIENDLY_SHORT_LABELS, FRIENDLY_STATUSES, toFriendlyStatus } from "./friendly-status.js";
import type { ProjectState } from "./types.js";

/**
 * Property 10: Friendly-status mapping is total and
 * leaks no internal state name. For every ProjectState plus arbitrary unknown
 * strings, toFriendlyStatus returns one of the four friendly statuses, maps any
 * unknown value to "building", and never returns an internal state name.
 *
 */

const ALL_STATES: ProjectState[] = [
  "planning",
  "planned",
  "scaffolded",
  "tts",
  "locking",
  "rendering",
  "reviewing",
  "done",
  "failed",
];

const KNOWN: Record<ProjectState, string> = {
  planning: "building",
  planned: "building",
  scaffolded: "building",
  tts: "building",
  locking: "building",
  rendering: "building",
  reviewing: "draft-ready",
  done: "done",
  failed: "error",
};

describe("friendly-status labels", () => {
  it("exposes full and short labels for every friendly status", () => {
    for (const status of FRIENDLY_STATUSES) {
      expect(FRIENDLY_LABELS[status].length).toBeGreaterThan(0);
      expect(FRIENDLY_SHORT_LABELS[status].length).toBeGreaterThan(0);
    }
    expect(FRIENDLY_SHORT_LABELS["draft-ready"]).toBe("Duyệt");
    expect(FRIENDLY_LABELS["draft-ready"]).toBe("Sẵn sàng duyệt");
  });
});

describe("Property 10: friendly-status mapping", () => {
  it("is total and never returns an internal-only state name", () => {
    // "done" is intentionally shared between ProjectState and FriendlyStatus
    // (design maps done→done), so the leak we guard against is the internal
    // state names that are NOT also a friendly status.
    const internalOnly = (ALL_STATES as string[]).filter(
      (s) => !(FRIENDLY_STATUSES as readonly string[]).includes(s),
    );
    fc.assert(
      fc.property(fc.oneof(fc.constantFrom(...ALL_STATES), fc.string()), (state) => {
        const out = toFriendlyStatus(state);
        expect(FRIENDLY_STATUSES).toContain(out);
        expect(internalOnly).not.toContain(out);
      }),
      { numRuns: 300 },
    );
  });

  it("maps each known state correctly and unknown ⇒ building", () => {
    for (const s of ALL_STATES) expect(toFriendlyStatus(s)).toBe(KNOWN[s]);
    fc.assert(
      fc.property(
        fc.string().filter((s) => !(ALL_STATES as string[]).includes(s)),
        (unknown) => {
          expect(toFriendlyStatus(unknown)).toBe("building");
        },
      ),
      { numRuns: 200 },
    );
  });
});
