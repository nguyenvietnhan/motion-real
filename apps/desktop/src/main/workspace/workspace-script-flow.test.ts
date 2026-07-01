import { describe, expect, it } from "vitest";
import type { ScriptEdit, ScriptLine } from "../../shared/types.js";
import { applyScriptEditsToManifest, scriptGateModelFromLines } from "./workspace-script-flow.js";

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
});
