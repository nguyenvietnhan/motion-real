import { describe, expect, it } from "vitest";
import { isHealthyMediaFile, recoveryDecision } from "./workspace-recovery.js";

describe("recoveryDecision", () => {
  it("prefers healthy full output as published even if metadata unreadable", () => {
    expect(
      recoveryDecision({
        full: "healthy",
        draft: "missing",
        manifest: "unreadable",
      }),
    ).toEqual({ kind: "published" });
  });

  it("returns ready for healthy draft + nonempty manifest without stills", () => {
    expect(
      recoveryDecision({
        full: "missing",
        draft: "healthy",
        manifest: { sceneCount: 3, hasAnyStill: false },
      }),
    ).toEqual({ kind: "ready" });
  });

  it("returns draft-recovery for healthy draft without readable manifest", () => {
    expect(
      recoveryDecision({
        full: "missing",
        draft: "healthy",
        manifest: "unreadable",
      }),
    ).toEqual({ kind: "draft-recovery" });
  });

  it("returns ready for stills without draft when manifest is readable", () => {
    expect(
      recoveryDecision({
        full: "missing",
        draft: "missing",
        manifest: { sceneCount: 2, hasAnyStill: true },
      }),
    ).toEqual({ kind: "ready" });
  });

  it("returns script when manifest is readable but no draft and no stills", () => {
    expect(
      recoveryDecision({
        full: "missing",
        draft: "invalid",
        manifest: { sceneCount: 4, hasAnyStill: false },
      }),
    ).toEqual({ kind: "script" });
  });

  it("returns empty error for scaffold without coherent artifacts", () => {
    expect(
      recoveryDecision({
        full: "missing",
        draft: "missing",
        manifest: { sceneCount: 0, hasAnyStill: false },
      }),
    ).toEqual({ kind: "error", reason: "empty" });
  });
});

describe("isHealthyMediaFile", () => {
  it("rejects missing, empty, and non-file", () => {
    expect(isHealthyMediaFile(null)).toBe("missing");
    expect(isHealthyMediaFile({ isFile: true, size: 0 })).toBe("invalid");
    expect(isHealthyMediaFile({ isFile: false, size: 100 })).toBe("invalid");
    expect(isHealthyMediaFile({ isFile: true, size: 1024 })).toBe("healthy");
  });
});
