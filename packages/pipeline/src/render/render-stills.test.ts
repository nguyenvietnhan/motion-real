import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { VideoSpec } from "@motionreal/schema";

/**
 * `renderProjectStills` self-tests (freeform-engine D1). The authoring admission
 * path is a pure AST admission, while Remotion would download/launch Chromium —
 * so we mock the authoring module (admission + manifest reads) and the renderer's
 * `renderSceneStills`. What we actually assert is the WIRING: admit gates the
 * render, the no-TTS lock is used, and `sceneIds` flows through to the stills.
 */

const mocks = vi.hoisted(() => ({
  admitProjectScenes: vi.fn(),
  loadManifest: vi.fn(),
  loadManifestAsSpec: vi.fn(),
  manifestSceneFiles: vi.fn(),
  generateAuthoredEntry: vi.fn(),
  checkSceneRuntimeErrors: vi.fn(),
  renderSceneStills: vi.fn(),
}));

vi.mock("../authoring/manifest.js", () => ({
  admitProjectScenes: mocks.admitProjectScenes,
  loadManifest: mocks.loadManifest,
  loadManifestAsSpec: mocks.loadManifestAsSpec,
  manifestSceneFiles: mocks.manifestSceneFiles,
}));

vi.mock("../authoring/authored-entry.js", () => ({
  generateAuthoredEntry: mocks.generateAuthoredEntry,
}));

vi.mock("./runtime-probe.js", () => ({
  checkSceneRuntimeErrors: mocks.checkSceneRuntimeErrors,
}));

vi.mock("./renderer.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./renderer.js")>();
  return { ...actual, renderSceneStills: mocks.renderSceneStills };
});

import { renderProjectStills } from "./render-stills.js";
import { projectPaths } from "../store/store.js";

let tempRoot: string;
let prevHome: string | undefined;

const SPEC: VideoSpec = {
  version: 1,
  title: "Stills test",
  format: "tiktok",
  ratio: "9:16",
  language: "vi",
  scenes: [
    { id: "scene-01", component: "a-scene", durationInSeconds: 8, headline: "Một", narration: "Câu một dài đủ.", props: {} },
    { id: "scene-02", component: "b-scene", durationInSeconds: 8, headline: "Hai", narration: "Câu hai dài đủ.", props: {} },
  ],
};

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "news-stills-"));
  prevHome = process.env.VIDEO_TOOL_HOME;
  process.env.VIDEO_TOOL_HOME = tempRoot;

  mocks.admitProjectScenes.mockResolvedValue({
    ok: true,
    componentIds: ["a-scene", "b-scene"],
    files: ["/proj/authored/a-scene.tsx", "/proj/authored/b-scene.tsx"],
  });
  mocks.loadManifest.mockResolvedValue({ scenes: [{ id: "scene-01", component: "a-scene" }, { id: "scene-02", component: "b-scene" }] });
  mocks.loadManifestAsSpec.mockResolvedValue(SPEC);
  mocks.manifestSceneFiles.mockReturnValue([
    { sceneId: "scene-01", componentId: "a-scene", file: "/proj/authored/a-scene.tsx" },
    { sceneId: "scene-02", componentId: "b-scene", file: "/proj/authored/b-scene.tsx" },
  ]);
  mocks.generateAuthoredEntry.mockResolvedValue("/proj/authored/_entry.stills.tsx");
  mocks.checkSceneRuntimeErrors.mockResolvedValue({ ok: true, issues: [], ranTiers: ["render"] });
  mocks.renderSceneStills.mockImplementation(async (_spec, outDir, opts) => {
    const ids = opts?.sceneIds ?? ["scene-01", "scene-02"];
    opts?.onTiming?.({
      name: `${opts?.timingScope ?? "stills"}.renderStill`,
      ms: 12.34,
      meta: { sceneId: ids[0] },
    });
    return ids.map((id: string) => join(resolve(outDir), `${id}.png`));
  });
});

afterEach(async () => {
  vi.clearAllMocks();
  if (prevHome === undefined) delete process.env.VIDEO_TOOL_HOME;
  else process.env.VIDEO_TOOL_HOME = prevHome;
  await rm(tempRoot, { recursive: true, force: true });
});

describe("renderProjectStills", () => {
  it("admits scenes, locks WITHOUT TTS, and renders one still per scene", async () => {
    const res = await renderProjectStills("proj-1");

    expect(mocks.admitProjectScenes).toHaveBeenCalledWith("proj-1");
    expect(mocks.generateAuthoredEntry).toHaveBeenCalledTimes(1);
    expect(mocks.checkSceneRuntimeErrors).toHaveBeenCalledTimes(1);
    // The no-TTS lock + still render ran; result lists both scene stills.
    expect(mocks.renderSceneStills).toHaveBeenCalledTimes(1);
    expect(mocks.checkSceneRuntimeErrors.mock.invocationCallOrder[0]).toBeLessThan(mocks.renderSceneStills.mock.invocationCallOrder[0]!);
    const reviewDir = projectPaths("proj-1").reviewDir;
    expect(res.stills).toEqual([join(resolve(reviewDir), "scene-01.png"), join(resolve(reviewDir), "scene-02.png")]);
  });

  it("never synthesizes audio — the no-TTS lock carries no narration src", async () => {
    await renderProjectStills("proj-1");
    // lockSpec was called with tts=null inside, so the entry's lock has no narrationSrc;
    // we assert indirectly: renderSceneStills got a locked spec with empty audio.
    const [lockedArg] = mocks.renderSceneStills.mock.calls[0]!;
    expect(lockedArg.audio?.narrationSrc).toBeUndefined();
    expect(lockedArg.captions).toEqual([]);
  });

  it("passes sceneIds through so a subset re-renders just those stills", async () => {
    const res = await renderProjectStills("proj-1", { sceneIds: ["scene-02"] });
    const [, probeOpts] = mocks.checkSceneRuntimeErrors.mock.calls[0]!;
    expect(probeOpts.sceneIds).toEqual(["scene-02"]);
    const [, , opts] = mocks.renderSceneStills.mock.calls[0]!;
    expect(opts.sceneIds).toEqual(["scene-02"]);
    const reviewDir = projectPaths("proj-1").reviewDir;
    expect(res.stills).toEqual([join(resolve(reviewDir), "scene-02.png")]);
  });

  it("records timing events for the stills pipeline and Remotion still render", async () => {
    const timings: Array<{ name: string; ms: number; meta?: Record<string, unknown> }> = [];
    await renderProjectStills("proj-1", { sceneIds: ["scene-02"], onTiming: (timing) => timings.push(timing) });

    expect(timings.map((timing) => timing.name)).toEqual(
      expect.arrayContaining([
        "stills.stage.authoring.admission",
        "stills.stage.authoring.load_manifest",
        "stills.stage.authoring.resolve_scene_files",
        "stills.stage.authoring.resolve_spec",
        "stills.stage.lock",
        "stills.stage.authored_entry",
        "stills.stage.scene_runtime_probe",
        "stills.renderStill",
        "stills.stage.render_scene_stills",
      ]),
    );
    expect(timings.every((timing) => typeof timing.ms === "number")).toBe(true);

    const events = (await readFile(projectPaths("proj-1").events, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    const timingEvents = events.filter((event) => event.type === "render.timing");
    expect(timingEvents.map((event) => event.name)).toEqual(expect.arrayContaining(timings.map((timing) => timing.name)));
  });

  it("is format-agnostic: a 16:9 (YouTube) spec renders stills the same way as 9:16 (freeform-engine L6)", async () => {
    // L6: the stills path is ONE code path for both formats — it reads the spec's
    // own `format` via loadManifestAsSpec (the composition sizes itself off it), so
    // a YouTube project produces review PNGs exactly like a TikTok one. No separate
    // "thumbnail vs video" pipeline; both go through renderProjectStills → review/.
    mocks.loadManifestAsSpec.mockResolvedValueOnce({ ...SPEC, format: "youtube", ratio: "16:9" });
    const res = await renderProjectStills("proj-1");
    expect(mocks.renderSceneStills).toHaveBeenCalledTimes(1);
    const reviewDir = projectPaths("proj-1").reviewDir;
    expect(res.stills).toEqual([join(resolve(reviewDir), "scene-01.png"), join(resolve(reviewDir), "scene-02.png")]);
  });

  it("throws a PipelineError (not a silent pass) when admission rejects a scene", async () => {
    mocks.admitProjectScenes.mockResolvedValueOnce({
      ok: false,
      violations: [{ check: "N4", severity: "error", path: "authored/bad.tsx", message: "banned import" }],
    });
    await expect(renderProjectStills("proj-1")).rejects.toThrow(/admission rejected/i);
    expect(mocks.checkSceneRuntimeErrors).not.toHaveBeenCalled();
    expect(mocks.renderSceneStills).not.toHaveBeenCalled();
  });

  it("throws a scene-targeted N31 PipelineError when the strict stills probe fails", async () => {
    mocks.checkSceneRuntimeErrors.mockResolvedValueOnce({
      ok: false,
      ranTiers: ["render"],
      issues: [
        {
          check: "N31",
          severity: "error",
          sceneId: "scene-02",
          path: "frame:120",
          message: "Authored scene crashed during strict runtime probe.",
        },
      ],
    });

    await expect(renderProjectStills("proj-1", { sceneIds: ["scene-02"], runtimeProbeFractions: [0] })).rejects.toMatchObject({
      stage: "render",
      check: "N31",
      sceneId: "scene-02",
    });
    expect(mocks.renderSceneStills).not.toHaveBeenCalled();

    const report = JSON.parse(await readFile(projectPaths("proj-1").safetyReport, "utf8"));
    expect(report.issues).toEqual([
      expect.objectContaining({ check: "N31", sceneId: "scene-02", severity: "error" }),
    ]);
  });

  it("can disable the strict stills probe as an explicit rollback", async () => {
    const res = await renderProjectStills("proj-1", { strictStillsRuntimeProbe: false });
    expect(mocks.checkSceneRuntimeErrors).not.toHaveBeenCalled();
    expect(mocks.renderSceneStills).toHaveBeenCalledTimes(1);
    expect(res.stills).toHaveLength(2);
  });
});
