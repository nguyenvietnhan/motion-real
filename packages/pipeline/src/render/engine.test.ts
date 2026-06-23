import { describe, expect, it } from "vitest";
import { normalizeRenderEngineMode, resolveVideoRenderer } from "./engine.js";

describe("render engine routing", () => {
  it("routes YouTube to HyperFrames and TikTok to Remotion in auto mode", () => {
    expect(resolveVideoRenderer("youtube", "auto")).toBe("hyperframes");
    expect(resolveVideoRenderer("tiktok", "auto")).toBe("remotion");
  });

  it("honors explicit renderer override", () => {
    expect(resolveVideoRenderer("youtube", "remotion")).toBe("remotion");
    expect(resolveVideoRenderer("tiktok", "hyperframes")).toBe("hyperframes");
  });

  it("normalizes invalid env values back to auto", () => {
    expect(normalizeRenderEngineMode("bad")).toBe("auto");
    expect(normalizeRenderEngineMode(" HYPERFRAMES ")).toBe("hyperframes");
  });
});

