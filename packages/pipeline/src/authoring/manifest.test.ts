import { describe, expect, it } from "vitest";
import { manifestSceneFiles, type Manifest } from "./manifest.js";

/**
 * `manifestSceneFiles` scoping self-tests. The render entry and the N10
 * typecheck must operate on exactly the files the manifest references — never on
 * a stale orphan `.tsx` an earlier authoring batch left behind after a reauthor
 * rewrote the manifest with new component ids. A stranded orphan that is still
 * admitted (it's valid code) must NOT be bundled or typechecked: it isn't part
 * of the video, so it can neither crash nor block the render.
 */

const manifest = (components: string[]): Manifest => ({
  scenes: components.map((component, i) => ({
    id: `scene-${String(i + 1).padStart(2, "0")}`,
    component,
    narration: "n",
    headline: "h",
  })),
});

describe("manifestSceneFiles (bundle/typecheck scoping)", () => {
  it("pairs each manifest scene with its component's file, in manifest order", () => {
    const map = new Map([
      ["hook", "/p/authored/hook.tsx"],
      ["body", "/p/authored/body.tsx"],
    ]);
    const out = manifestSceneFiles(manifest(["hook", "body"]), map);
    expect(out).toEqual([
      { sceneId: "scene-01", componentId: "hook", file: "/p/authored/hook.tsx" },
      { sceneId: "scene-02", componentId: "body", file: "/p/authored/body.tsx" },
    ]);
  });

  it("omits an admitted orphan file no manifest scene references", () => {
    // `orphan` is admitted (in the map) but not in the manifest → must be dropped.
    const map = new Map([
      ["hook", "/p/authored/hook.tsx"],
      ["orphan", "/p/authored/agent-capabilities.tsx"],
    ]);
    const out = manifestSceneFiles(manifest(["hook"]), map);
    expect(out.map((s) => s.file)).toEqual(["/p/authored/hook.tsx"]);
  });

  it("skips a manifest scene whose component has no admitted file (no crash)", () => {
    const map = new Map([["hook", "/p/authored/hook.tsx"]]);
    const out = manifestSceneFiles(manifest(["hook", "missing"]), map);
    expect(out.map((s) => s.componentId)).toEqual(["hook"]);
  });
});
