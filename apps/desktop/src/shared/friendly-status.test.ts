import { describe, expect, it } from "vitest";
import { FRIENDLY_LABELS, FRIENDLY_SHORT_LABELS, FRIENDLY_STATUSES, toFriendlyStatus } from "./friendly-status.js";
import type { ProjectState } from "./types.js";

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

describe("friendly-status mapping", () => {
  it("maps each known state and unknown → building", () => {
    for (const s of ALL_STATES) expect(toFriendlyStatus(s)).toBe(KNOWN[s]);
    expect(toFriendlyStatus("???")).toBe("building");
    expect(toFriendlyStatus("")).toBe("building");
  });

  it("keeps UI labels for draft-ready", () => {
    expect(FRIENDLY_STATUSES).toContain("draft-ready");
    expect(FRIENDLY_SHORT_LABELS["draft-ready"]).toBe("Duyệt");
    expect(FRIENDLY_LABELS["draft-ready"]).toBe("Sẵn sàng duyệt");
  });
});
