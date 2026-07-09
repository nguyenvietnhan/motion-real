import { describe, expect, it, vi } from "vitest";
import {
  parseVisualDefects,
  restoreAuthoredScenes,
  runVisualQa,
  snapshotAuthoredScenes,
} from "./visual-qa-runner.js";

function fakeLogger() {
  return {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe("parseVisualDefects", () => {
  it("keeps high-severity known scenes and filters low/hallucinated", () => {
    const reply = JSON.stringify({
      issues: [
        { sceneId: "scene-01", issue: "overlap", severity: "high" },
        { sceneId: "scene-01", issue: "duplicate", severity: "high" },
        { sceneId: "scene-02", issue: "maybe", severity: "low" },
        { sceneId: "scene-99", issue: "ghost", severity: "high" },
        { sceneId: "scene-03", issue: "  ", severity: "high" },
      ],
    });
    expect(parseVisualDefects(reply, new Set(["scene-01", "scene-02", "scene-03"]))).toEqual({
      kind: "checked",
      defects: [{ sceneId: "scene-01", issue: "overlap" }],
      checkedSceneIds: ["scene-01", "scene-02", "scene-03"],
    });
  });

  it("valid empty issue list is a checked clean pass", () => {
    expect(parseVisualDefects(JSON.stringify({ issues: [] }), new Set(["scene-01"]))).toEqual({
      kind: "checked",
      defects: [],
      checkedSceneIds: ["scene-01"],
    });
  });

  it("returns skipped/invalid-response and warns on invalid JSON body", () => {
    const logger = fakeLogger();
    expect(parseVisualDefects("```json\n{not-json}\n```", new Set(["scene-01"]), logger)).toEqual({
      kind: "skipped",
      reason: "invalid-response",
      requestedSceneIds: ["scene-01"],
    });
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn.mock.calls[0]![0]).toMatchObject({ failureClass: "visual-qa-parse" });
  });

  it("returns skipped/invalid-response when issues is missing or wrong shape", () => {
    expect(parseVisualDefects(JSON.stringify({}), new Set(["scene-01"]))).toEqual({
      kind: "skipped",
      reason: "invalid-response",
      requestedSceneIds: ["scene-01"],
    });
    expect(parseVisualDefects(JSON.stringify({ issues: "nope" }), new Set(["scene-01"]))).toEqual({
      kind: "skipped",
      reason: "invalid-response",
      requestedSceneIds: ["scene-01"],
    });
  });
});

describe("runVisualQa", () => {
  it("no model -> skipped/no-model and no chat call", async () => {
    const chat = vi.fn();
    const out = await runVisualQa({
      projectId: "p1",
      loadManifest: async () => ({ scenes: [{ id: "scene-01" }] }),
      reviewDir: "/r",
      readStillDataUrl: () => "data:image/png;base64,xx",
      chat,
      logger: fakeLogger(),
    });
    expect(out).toEqual({ kind: "skipped", reason: "no-model", requestedSceneIds: [] });
    expect(chat).not.toHaveBeenCalled();
  });

  it("no stills -> skipped/no-stills and no chat call", async () => {
    const chat = vi.fn();
    const out = await runVisualQa({
      model: "m",
      projectId: "p1",
      loadManifest: async () => ({ scenes: [{ id: "scene-01" }] }),
      reviewDir: "/r",
      readStillDataUrl: () => undefined,
      chat,
      logger: fakeLogger(),
    });
    expect(out).toEqual({ kind: "skipped", reason: "no-stills", requestedSceneIds: ["scene-01"] });
    expect(chat).not.toHaveBeenCalled();
  });

  it("manifest unavailable -> skipped/manifest-unavailable", async () => {
    const out = await runVisualQa({
      model: "m",
      projectId: "p1",
      loadManifest: async () => null,
      reviewDir: "/r",
      readStillDataUrl: () => "data:image/png;base64,xx",
      chat: async () => "",
      logger: fakeLogger(),
    });
    expect(out).toEqual({ kind: "skipped", reason: "manifest-unavailable", requestedSceneIds: [] });
  });

  it("returns checked defects from a valid high-severity reply", async () => {
    const out = await runVisualQa({
      model: "m",
      projectId: "p1",
      loadManifest: async () => ({ scenes: [{ id: "scene-01" }, { id: "scene-02" }] }),
      reviewDir: "/r",
      readStillDataUrl: (p) => (p.includes("scene-01") ? "data:image/png;base64,xx" : undefined),
      chat: async () =>
        JSON.stringify({
          issues: [{ sceneId: "scene-01", issue: "clip", severity: "high" }],
        }),
      logger: fakeLogger(),
    });
    expect(out).toEqual({
      kind: "checked",
      defects: [{ sceneId: "scene-01", issue: "clip" }],
      // Known scene ids from the scope (with or without stills on disk).
      checkedSceneIds: ["scene-01", "scene-02"],
    });
  });

  it("provider throw -> skipped/provider-error with existing failure log", async () => {
    const logger = fakeLogger();
    const out = await runVisualQa({
      model: "m",
      projectId: "p1",
      loadManifest: async () => ({ scenes: [{ id: "scene-01" }] }),
      reviewDir: "/r",
      readStillDataUrl: () => "data:image/png;base64,xx",
      chat: async () => {
        throw new Error("boom");
      },
      logger,
    });
    expect(out).toEqual({
      kind: "skipped",
      reason: "provider-error",
      requestedSceneIds: ["scene-01"],
    });
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn.mock.calls[0]![0]).toMatchObject({
      failureClass: "visual-qa-provider",
      projectId: "p1",
    });
    expect(logger.warn.mock.calls[0]![1]).toBe("[visual-qa] vision call failed; skipping QA");
  });

  it("malformed reply -> skipped/invalid-response", async () => {
    const out = await runVisualQa({
      model: "m",
      projectId: "p1",
      loadManifest: async () => ({ scenes: [{ id: "scene-01" }] }),
      reviewDir: "/r",
      readStillDataUrl: () => "data:image/png;base64,xx",
      chat: async () => "not json at all",
      logger: fakeLogger(),
    });
    expect(out).toEqual({
      kind: "skipped",
      reason: "invalid-response",
      requestedSceneIds: ["scene-01"],
    });
  });
});

describe("snapshotAuthoredScenes / restoreAuthoredScenes", () => {
  it("skips missing scene files on snapshot", async () => {
    const snap = await snapshotAuthoredScenes({
      projectId: "p1",
      sceneIds: ["scene-01"],
      loadManifest: async () => ({ scenes: [] }),
      resolveSceneFile: async () => null,
      readText: async () => "code",
      logger: fakeLogger(),
    });
    expect(snap).toEqual([]);
  });

  it("restores writes and admits when path resolves", async () => {
    const writeText = vi.fn(async () => undefined);
    const admitOne = vi.fn(async () => ({ id: "alpha" }) as never);
    const unregisterComponent = vi.fn();
    await restoreAuthoredScenes({
      projectId: "p1",
      snapshot: [{ sceneId: "scene-01", code: "// restored" }],
      loadManifest: async () => ({ scenes: [{ id: "scene-01", component: "alpha" }] }),
      resolveSceneFile: async () => ({ componentId: "alpha", path: "/p/alpha.tsx" }),
      writeText,
      unregisterComponent,
      admitOne,
      logger: fakeLogger(),
    });
    expect(writeText).toHaveBeenCalledWith("/p/alpha.tsx", "// restored");
    expect(unregisterComponent).toHaveBeenCalledWith("alpha");
    expect(admitOne).toHaveBeenCalledWith("/p/alpha.tsx");
  });
});
