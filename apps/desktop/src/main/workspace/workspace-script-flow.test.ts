import { describe, expect, it, vi } from "vitest";
import type { ScriptEdit, ScriptLine } from "../../shared/types.js";
import { applyScriptEditsToManifest, runScriptAuthoring, scriptGateModelFromLines } from "./workspace-script-flow.js";

type RunScriptAuthoringOptions = Parameters<typeof runScriptAuthoring>[0];

function scriptAuthoringOptions(overrides: Partial<RunScriptAuthoringOptions> = {}): RunScriptAuthoringOptions {
  const lines: ScriptLine[] = [{ sceneId: "scene-01", order: 1, headline: "Headline", narration: "Narration" }];

  return {
    projectId: "p1",
    input: { text: "Brief", urls: [] },
    worker: { author: vi.fn(async () => ({ kind: "authored" as const, sceneIds: ["scene-01"] })) },
    scriptGateEnabled: true,
    redact: (message) => message,
    loadScriptLines: vi.fn(async () => lines),
    setStage: vi.fn(),
    runRender: vi.fn(async () => {}),
    friendlyError: vi.fn(),
    logError: vi.fn(),
    ...overrides,
  };
}

describe("workspace script-flow helpers", () => {
  it("builds the script-gate model from script lines in order", () => {
    const lines: ScriptLine[] = [
      { sceneId: "scene-02", order: 2, headline: "Second", narration: "Narration 2" },
      { sceneId: "scene-01", order: 1, headline: "First", narration: "Narration 1" },
    ];

    expect(scriptGateModelFromLines("p1", true, lines)).toEqual({
      projectId: "p1",
      enabled: true,
      scenes: [
        { sceneId: "scene-02", order: 2, narration: "Narration 2", headline: "Second" },
        { sceneId: "scene-01", order: 1, narration: "Narration 1", headline: "First" },
      ],
    });
  });

  it("preserves project id and disabled flag with an empty scene list", () => {
    expect(scriptGateModelFromLines("p-disabled", false, [])).toEqual({
      projectId: "p-disabled",
      enabled: false,
      scenes: [],
    });
  });

  it("omits preview-only image paths from script-gate scenes", () => {
    const lines: ScriptLine[] = [
      {
        sceneId: "scene-01",
        order: 1,
        headline: "Headline",
        narration: "Narration",
        imagePath: "media://asset/scene-01.png",
      },
    ];

    expect(scriptGateModelFromLines("p1", true, lines)).toEqual({
      projectId: "p1",
      enabled: true,
      scenes: [{ sceneId: "scene-01", order: 1, narration: "Narration", headline: "Headline" }],
    });
  });

  it("rejects empty narration edits before mutating the manifest", () => {
    const manifest = {
      scenes: [
        { id: "scene-01", narration: "Keep me", headline: "First" },
        { id: "scene-02", narration: "Still here", headline: "Second" },
      ],
    };

    expect(applyScriptEditsToManifest(manifest, [{ sceneId: "scene-01", narration: "   " }])).toEqual({
      ok: false,
      reason: "empty-narration",
      sceneId: "scene-01",
    });
    expect(manifest.scenes).toEqual([
      { id: "scene-01", narration: "Keep me", headline: "First" },
      { id: "scene-02", narration: "Still here", headline: "Second" },
    ]);
  });

  it("applies valid edits to manifest scenes while preserving unrelated fields", () => {
    const manifest = {
      title: "Video",
      scenes: [
        { id: "scene-01", narration: "Old narration", headline: "Old", extra: "kept" },
        { id: "scene-02", narration: "Untouched", headline: "Second", extra: "also-kept" },
      ],
    };
    const edits: ScriptEdit[] = [
      { sceneId: "scene-01", narration: "New narration", headline: "New" },
      { sceneId: "missing", narration: "Ignored" },
    ];

    expect(applyScriptEditsToManifest(manifest, edits)).toEqual({ ok: true });
    expect(manifest).toEqual({
      title: "Video",
      scenes: [
        { id: "scene-01", narration: "New narration", headline: "New", extra: "kept" },
        { id: "scene-02", narration: "Untouched", headline: "Second", extra: "also-kept" },
      ],
    });
  });

  it("turns a no-source authoring outcome into a redacted create-retry error", async () => {
    const setStage = vi.fn();
    const friendlyError = vi.fn();
    const runRender = vi.fn(async () => {});
    const options = scriptAuthoringOptions({
      worker: { author: vi.fn(async () => ({ kind: "no-source" as const, message: "SECRET source" })) },
      redact: (message) => message.replace("SECRET", "[redacted]"),
      setStage,
      friendlyError,
      runRender,
    });

    await runScriptAuthoring(options);

    expect(setStage).toHaveBeenCalledWith({
      kind: "error",
      message: "[redacted] source",
      fixable: false,
      retry: "create",
    });
    expect(friendlyError).toHaveBeenCalledWith({
      projectId: "p1",
      message: "[redacted] source",
      retry: "create",
      fixable: false,
    });
    expect(runRender).not.toHaveBeenCalled();
  });

  it("sets a script stage with link warning when the script gate is enabled", async () => {
    const setStage = vi.fn();
    const runRender = vi.fn(async () => {});
    const lines: ScriptLine[] = [{ sceneId: "scene-01", order: 1, headline: "Headline", narration: "Narration" }];
    const options = scriptAuthoringOptions({
      input: { text: "Brief", urls: ["https://example.test/source"] },
      worker: {
        author: vi.fn(async () => ({
          kind: "authored" as const,
          sceneIds: ["scene-01"],
          unreadableUrls: ["https://example.test/source"],
        })),
      },
      loadScriptLines: vi.fn(async () => lines),
      setStage,
      runRender,
    });

    await runScriptAuthoring(options);

    expect(setStage).toHaveBeenCalledWith({
      kind: "script",
      lines,
      linkWarning: "Không đọc được 1/1 đường dẫn. Nội dung liên quan dựa trên hiểu biết của AI.",
    });
    expect(runRender).not.toHaveBeenCalled();
  });

  it("passes the link warning to render when the script gate is disabled", async () => {
    const loadScriptLines = vi.fn(async () => []);
    const runRender = vi.fn(async () => {});
    const options = scriptAuthoringOptions({
      input: { text: "Brief", urls: ["https://a.test", "https://b.test"] },
      worker: {
        author: vi.fn(async () => ({
          kind: "authored" as const,
          sceneIds: ["scene-01"],
          unreadableUrls: ["https://a.test", "https://b.test"],
        })),
      },
      scriptGateEnabled: false,
      loadScriptLines,
      runRender,
    });

    await runScriptAuthoring(options);

    expect(loadScriptLines).not.toHaveBeenCalled();
    expect(runRender).toHaveBeenCalledWith(
      "Không đọc được 2/2 đường dẫn. Nội dung liên quan dựa trên hiểu biết của AI.",
    );
  });

  it("turns thrown authoring errors into a generic create-retry error", async () => {
    const setStage = vi.fn();
    const friendlyError = vi.fn();
    const logError = vi.fn();
    const options = scriptAuthoringOptions({
      worker: {
        author: vi.fn(async () => {
          throw new Error("provider exploded");
        }),
      },
      setStage,
      friendlyError,
      logError,
    });

    await runScriptAuthoring(options);

    expect(logError).toHaveBeenCalledWith("[workspace] authoring failed for p1:", expect.any(Error));
    expect(setStage).toHaveBeenCalledWith({
      kind: "error",
      message: "Có lỗi khi viết kịch bản. Hãy thử lại.",
      fixable: false,
      retry: "create",
    });
    expect(friendlyError).toHaveBeenCalledWith({
      projectId: "p1",
      message: "Có lỗi khi viết kịch bản. Hãy thử lại.",
      retry: "create",
      fixable: false,
    });
  });
});
