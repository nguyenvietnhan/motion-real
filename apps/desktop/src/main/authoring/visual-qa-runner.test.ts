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
    expect(parseVisualDefects(reply, new Set(["scene-01", "scene-02", "scene-03"]))).toEqual([
      { sceneId: "scene-01", issue: "overlap" },
    ]);
  });

  it("returns [] and warns on invalid JSON body", () => {
    const logger = fakeLogger();
    expect(parseVisualDefects("```json\n{not-json}\n```", new Set(["scene-01"]), logger)).toEqual([]);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn.mock.calls[0]![0]).toMatchObject({ failureClass: "visual-qa-parse" });
    expect(logger.warn.mock.calls[0]![1]).toBe("visual-QA JSON parse failed; treating reply as no defects");
  });
});

describe("runVisualQa", () => {
  it("returns [] without model", async () => {
    const out = await runVisualQa({
      projectId: "p1",
      loadManifest: async () => ({ scenes: [{ id: "scene-01" }] }),
      reviewDir: "/r",
      readStillDataUrl: () => "data:image/png;base64,xx",
      chat: async () => "",
      logger: fakeLogger(),
    });
    expect(out).toEqual([]);
  });

  it("returns [] when no stills on disk", async () => {
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
    expect(out).toEqual([]);
    expect(chat).not.toHaveBeenCalled();
  });

  it("returns defects from a valid high-severity reply", async () => {
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
    expect(out).toEqual([{ sceneId: "scene-01", issue: "clip" }]);
  });

  it("returns [] and logs visual-qa-provider on chat throw", async () => {
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
    expect(out).toEqual([]);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn.mock.calls[0]![0]).toMatchObject({
      failureClass: "visual-qa-provider",
      projectId: "p1",
    });
    expect(logger.warn.mock.calls[0]![1]).toBe("[visual-qa] vision call failed; skipping QA");
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
