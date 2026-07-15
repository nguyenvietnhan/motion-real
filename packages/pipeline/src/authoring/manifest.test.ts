import { describe, expect, it } from "vitest";
import { VideoSpecSchema } from "@motionreal/schema";
import { manifestSceneFiles, manifestToVideoSpec, stampSceneIdsFromManifest, type Manifest } from "./manifest.js";

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

describe("stampSceneIdsFromManifest", () => {
  it("attaches sceneId from component file basename / path", () => {
    const m = manifest(["hook", "body"]);
    const out = stampSceneIdsFromManifest(m, [
      { check: "N4", severity: "error", path: "hook.tsx:12", message: "bad import" },
      { check: "N5", severity: "error", path: "/abs/authored/body.tsx", message: "Math.random" },
      { check: "N4", severity: "error", path: "unknown.tsx", message: "orphan" },
    ]);
    expect(out[0]?.sceneId).toBe("scene-01");
    expect(out[1]?.sceneId).toBe("scene-02");
    expect(out[2]?.sceneId).toBeUndefined();
  });

  it("preserves an existing sceneId", () => {
    const out = stampSceneIdsFromManifest(manifest(["hook"]), [
      { check: "N4", severity: "error", path: "other.tsx", sceneId: "scene-99", message: "x" },
    ]);
    expect(out[0]?.sceneId).toBe("scene-99");
  });
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

/**
 * `manifestToVideoSpec` + `clampTheme` golden table (audit P1-9). This is the
 * AI-output → render bridge: a manifest authored by whichever model the user
 * picked is converted here into the VideoSpec the safety/lock/render path runs
 * on. It is the most failure-prone seam in the system, so these pin the current
 * behavior (theme clamping, default fill) AND assert the result actually passes
 * the canonical `VideoSpecSchema` — so a future drift that produces an invalid
 * spec breaks a cheap test here instead of throwing a late ZodError at lock time
 * (after TTS has already been spent).
 */
describe("manifestToVideoSpec + clampTheme (AI-output → spec bridge)", () => {
  const oneScene = (overrides: Partial<Manifest["scenes"][number]> = {}): Manifest => ({
    title: "Tiêu đề",
    theme: { dominant: "#1E9CB0" },
    scenes: [{ id: "scene-01", component: "hook", narration: "n", headline: "h", ...overrides }],
  });

  it("passes a valid dominant hex straight through", () => {
    const spec = manifestToVideoSpec(oneScene());
    expect(spec.theme?.dominant).toBe("#1E9CB0");
  });

  it("falls back to the default teal for a malformed dominant hex", () => {
    const spec = manifestToVideoSpec({ ...oneScene(), theme: { dominant: "not-a-hex" } });
    expect(spec.theme?.dominant).toBe("#1E9CB0");
  });

  it("strips legacy mood so it never reaches VideoSpec", () => {
    const raw = { ...oneScene(), theme: { dominant: "#1E9CB0", mood: "calm" } as Manifest["theme"] };
    const spec = manifestToVideoSpec(raw as Manifest);
    expect(spec.theme).toEqual({ dominant: "#1E9CB0" });
  });

  it("emits no theme when the manifest omits a dominant", () => {
    const spec = manifestToVideoSpec({ title: "t", scenes: oneScene().scenes });
    expect(spec.theme).toBeUndefined();
  });

  it("fills sensible scene defaults (durationInSeconds, props)", () => {
    const spec = manifestToVideoSpec(oneScene());
    expect(spec.scenes[0]!.durationInSeconds).toBeGreaterThan(0);
    expect(spec.scenes[0]!.props).toEqual({});
  });

  it("produces a spec that passes the canonical VideoSpecSchema", () => {
    const spec = manifestToVideoSpec(oneScene());
    expect(VideoSpecSchema.safeParse(spec).success).toBe(true);
  });

  it("does not emit retired style identity fields", () => {
    const spec = manifestToVideoSpec(oneScene());
    expect(Object.keys(spec).sort()).toEqual(
      ["format", "language", "ratio", "scenes", "theme", "title", "version", "videoLanguage"].sort(),
    );
    expect(spec.theme ? Object.keys(spec.theme).sort() : []).toEqual(["dominant"]);
  });

  it("clamps an over-long title into a schema-valid spec", () => {
    const spec = manifestToVideoSpec({ ...oneScene(), title: "T".repeat(400) });
    expect(VideoSpecSchema.safeParse(spec).success).toBe(true);
  });

  it("persists the selected video language into both metadata fields", () => {
    const spec = manifestToVideoSpec({ ...oneScene(), videoLanguage: "en" });
    expect(spec.videoLanguage).toBe("en");
    expect(spec.language).toBe("en");
  });

  it("defaults missing video language to Vietnamese", () => {
    const spec = manifestToVideoSpec(oneScene());
    expect(spec.videoLanguage).toBe("vi");
    expect(spec.language).toBe("vi");
  });

  it.each([
    "https://cdn.example.com/a.png",
    "//cdn.example.com/a.png",
    "assets/a.svg",
  ])("rejects invalid image.ref before TTS/lock: %s", (ref) => {
    expect(() => manifestToVideoSpec(oneScene({ image: { ref } }))).toThrow();
  });
});
