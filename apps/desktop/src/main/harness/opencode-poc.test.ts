import { describe, expect, it } from "vitest";
import { createVisionFixturePng, eventErrorMessages, findPermissionID, scrubPocError, validateProbeTarget } from "./opencode-poc.js";

describe("OpenCode POC trust boundaries", () => {
  it("only permits the one sandbox probe target", () => {
    expect(validateProbeTarget("agent-note.txt")).toBe("agent-note.txt");
    for (const invalid of ["../note.txt", "C:\\note.txt", "sub/note.txt", "agent-note.txt "]) {
      expect(() => validateProbeTarget(invalid)).toThrow();
    }
  });

  it("scrubs credentials and produces a PNG fixture", () => {
    expect(scrubPocError("Bearer top-secret-token-123456789012345678901234567890")).not.toContain("top-secret");
    const image = createVisionFixturePng();
    expect(image.subarray(1, 4).toString("ascii")).toBe("PNG");
  });

  it("keeps only error messages from SSE payloads", () => {
    expect(
      eventErrorMessages({
        properties: { error: { message: "Missing API key", requestBodyValues: { prompt: "must not be retained" } } },
        data: { message: "HTTP 401" },
      }),
    ).toEqual(["Missing API key", "HTTP 401"]);
  });

  it("uses only an OpenCode permission id from a permission event", () => {
    expect(findPermissionID({ type: "permission.asked", properties: { id: "msg_wrong", tool: { callID: "call_wrong" }, nested: { id: "per_right" } } })).toBe("per_right");
  });
});
