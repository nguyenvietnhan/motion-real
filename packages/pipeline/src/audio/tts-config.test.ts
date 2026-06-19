import { describe, expect, it } from "vitest";
import { resolveVivibeCredentials } from "./tts.js";

describe("Vivibe credential resolution", () => {
  it("uses explicit in-memory credentials after process.env has been scrubbed", () => {
    expect(
      resolveVivibeCredentials(
        { apiKey: "  explicit-key  ", voiceId: "  explicit-voice  " },
        { apiKey: "", voiceId: undefined },
      ),
    ).toEqual({ apiKey: "explicit-key", voiceId: "explicit-voice" });
  });

  it("keeps the environment fallback for CLI/MCP processes that still use it", () => {
    expect(
      resolveVivibeCredentials({}, { apiKey: "env-key", voiceId: "env-voice" }),
    ).toEqual({ apiKey: "env-key", voiceId: "env-voice" });
  });
});
