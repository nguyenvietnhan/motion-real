import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { LockedVideoSpec } from "@motionreal/schema";

const mocks = vi.hoisted(() => ({
  bundle: vi.fn(),
  ensureBrowser: vi.fn(),
  selectComposition: vi.fn(),
  renderMedia: vi.fn(),
  renderStill: vi.fn(),
}));

vi.mock("@remotion/bundler", () => ({
  bundle: mocks.bundle,
}));

vi.mock("@remotion/renderer", () => ({
  ensureBrowser: mocks.ensureBrowser,
  selectComposition: mocks.selectComposition,
  renderMedia: mocks.renderMedia,
  renderStill: mocks.renderStill,
}));

import { __resetBundleCache, renderSceneRuntimeProbe, renderSceneStills, renderVideo } from "./renderer.js";

let tempRoot: string;

beforeEach(async () => {
  __resetBundleCache();
  tempRoot = await mkdtemp(join(tmpdir(), "news-renderer-"));
  mocks.bundle.mockResolvedValue("http://localhost:3000/bundle");
  mocks.ensureBrowser.mockResolvedValue({ type: "local-puppeteer-browser", path: "chrome" });
  mocks.selectComposition.mockImplementation(async ({ id, inputProps }) => ({
    id,
    width: 1080,
    height: 1920,
    fps: inputProps.spec.fps,
    durationInFrames: inputProps.spec.durationInFrames,
    defaultProps: {},
    props: inputProps,
  }));
  mocks.renderMedia.mockImplementation(async ({ onProgress }) => {
    onProgress?.({
      renderedFrames: 12,
      encodedFrames: 0,
      encodedDoneIn: null,
      renderedDoneIn: null,
      renderEstimatedTime: 0,
      progress: 0.42,
      stitchStage: "encoding",
    });
    return { buffer: null, slowestFrames: [], contentType: "video/mp4" };
  });
  mocks.renderStill.mockResolvedValue({ buffer: null, contentType: "image/png" });
});

afterEach(async () => {
  vi.clearAllMocks();
  await rm(tempRoot, { recursive: true, force: true });
});

function lockedSpec(): LockedVideoSpec {
  return {
    version: 1,
    title: "Renderer test",
    format: "tiktok",
    duration: 60,
    ratio: "9:16",
    language: "vi",
    fps: 30,
    durationInFrames: 120,
    scenes: [
      {
        id: "scene-01",
        component: "hero-announcement",
        durationInSeconds: 3,
        headline: "Mở đầu",
        narration: "Một câu đọc thử cho cảnh mở đầu.",
        props: { badgeText: "Test", highlight: "Renderer" },
        startFrame: 0,
        durationInFrames: 90,
      },
      {
        id: "scene-02",
        component: "final-cta",
        durationInSeconds: 1,
        headline: "Kết",
        narration: "Một câu kết ngắn.",
        props: { ctaText: "Kết luận", subText: "Render ổn định" },
        startFrame: 90,
        durationInFrames: 30,
      },
    ],
    audio: {},
    captions: [],
  };
}

describe("renderVideo", () => {
  it("uses the Node Remotion path with locked spec input props and h264 output", async () => {
    const spec = lockedSpec();
    const projectRoot = join(tempRoot, "projects", "demo-12345678");
    const outPath = join(projectRoot, "renders", "demo-12345678.mp4");
    const onProgress = vi.fn();
    const timings: Array<{ name: string; ms: number }> = [];

    const result = await renderVideo({ spec, outPath, concurrency: 2, onProgress, onTiming: (timing) => timings.push(timing) });

    expect(result).toEqual({ outPath: resolve(outPath), durationInFrames: 120, fps: 30 });
    expect(existsSync(dirname(outPath))).toBe(true);
    expect(mocks.ensureBrowser.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.bundle.mock.invocationCallOrder[0]!,
    );
    expect(mocks.bundle).toHaveBeenCalledWith(
      expect.objectContaining({
        publicDir: resolve(projectRoot),
        webpackOverride: expect.any(Function),
      }),
    );
    expect(mocks.selectComposition).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "MotionRealVideo",
        inputProps: { spec },
        serveUrl: "http://localhost:3000/bundle",
      }),
    );
    expect(mocks.renderMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        codec: "h264",
        outputLocation: resolve(outPath),
        inputProps: { spec },
        concurrency: 2,
        overwrite: true,
      }),
    );
    expect(onProgress).toHaveBeenCalledWith(0.42);
    expect(timings.map((timing) => timing.name)).toEqual(
      expect.arrayContaining(["video.ensureBrowser", "video.bundle", "video.selectComposition", "video.renderMedia"]),
    );
    expect(timings.every((timing) => typeof timing.ms === "number")).toBe(true);
  });

  it("requires a public/project root when local narration audio is present", async () => {
    const spec = { ...lockedSpec(), audio: { narrationSrc: "audio/narration.mixed.wav" } };
    await expect(renderVideo({ spec, outPath: join(tempRoot, "loose.mp4") })).rejects.toThrow(/projectRoot/);
    expect(mocks.ensureBrowser).not.toHaveBeenCalled();
  });
});

describe("renderSceneStills", () => {
  it("renders one PNG at each scene midpoint", async () => {
    const spec = lockedSpec();
    const outDir = join(tempRoot, "projects", "demo-12345678", "review");
    const timings: Array<{ name: string; meta?: Record<string, unknown> }> = [];

    const outputs = await renderSceneStills(spec, outDir, { onTiming: (timing) => timings.push(timing) });

    expect(outputs).toEqual([join(resolve(outDir), "scene-01.png"), join(resolve(outDir), "scene-02.png")]);
    expect(mocks.renderStill).toHaveBeenCalledTimes(2);
    expect(mocks.renderStill.mock.calls.map(([options]) => options.frame)).toEqual([45, 105]);
    expect(mocks.renderStill.mock.calls.map(([options]) => options.imageFormat)).toEqual(["png", "png"]);
    expect(timings.filter((timing) => timing.name === "stills.renderStill").map((timing) => timing.meta?.sceneId)).toEqual([
      "scene-01",
      "scene-02",
    ]);
  });

  it("renders only the requested sceneIds (subset), keeping the full-timeline frame math", async () => {
    // sceneIds scopes the PNG writes to a subset (the scenes a refine pass touched);
    // the composition still lays out the whole video, so the midpoint frame is
    // unchanged (scene-02 midpoint is still 105, not recomputed as if it were alone).
    const spec = lockedSpec();
    const outDir = join(tempRoot, "projects", "demo-12345678", "review");

    const outputs = await renderSceneStills(spec, outDir, { sceneIds: ["scene-02"] });

    expect(outputs).toEqual([join(resolve(outDir), "scene-02.png")]);
    expect(mocks.renderStill).toHaveBeenCalledTimes(1);
    expect(mocks.renderStill.mock.calls[0]![0].frame).toBe(105);
  });

  it("renders an extra late still per scene inside the clean speech window (N14 late pass)", async () => {
    // n=2 → T = transitionFrames(30) = 15.
    // scene-01: start 0, dur 90, headT 0 (first), tailT 15 → speech window [0, 75)
    // midpoint 45; late = 0 + round(0.82*75) = 61 (0.82 is 0.8199…, so 61.49→61)
    // scene-02: start 90, dur 30, headT 15, tailT 0 (last) → speech window [105, 15)
    // midpoint 105; late = 105 + round(0.82*15) = 117
    const spec = lockedSpec();
    const outDir = join(tempRoot, "projects", "demo-12345678", "review");

    const outputs = await renderSceneStills(spec, outDir, { extraFractions: [0.82] });

    // The returned list stays midpoints-only so oracle frame accounting is stable.
    expect(outputs).toEqual([join(resolve(outDir), "scene-01.png"), join(resolve(outDir), "scene-02.png")]);

    // Two stills per scene: midpoint then the late sample, in order.
    expect(mocks.renderStill).toHaveBeenCalledTimes(4);
    const calls = mocks.renderStill.mock.calls.map(([options]) => ({ frame: options.frame, output: options.output }));
    expect(calls.map((c) => c.frame)).toEqual([45, 61, 105, 117]);
    expect(calls[1]!.output).toBe(join(resolve(outDir), "scene-01.f82.png"));
    expect(calls[3]!.output).toBe(join(resolve(outDir), "scene-02.f82.png"));
  });
});

describe("renderSceneRuntimeProbe", () => {
  it("renders strict sampled frames and reports the scene/frame that crashes", async () => {
    const spec = lockedSpec();
    const projectRoot = join(tempRoot, "projects", "demo-12345678");
    const onProgress = vi.fn();
    mocks.renderStill.mockImplementation(async ({ frame }) => {
      if (frame === 105) throw new Error("inputRange must be strictly monotonically increasing");
      return { buffer: null, contentType: "image/png" };
    });

    const issues = await renderSceneRuntimeProbe(spec, { projectRoot, fractions: [0], onProgress });

    expect(issues).toEqual([
      {
        sceneId: "scene-02",
        frame: 105,
        message: expect.stringContaining("inputRange"),
      },
    ]);
    expect(mocks.selectComposition).toHaveBeenCalledWith(
      expect.objectContaining({
        inputProps: { spec, strictSceneErrors: true },
      }),
    );
    expect(mocks.renderStill).toHaveBeenCalledWith(
      expect.objectContaining({
        output: null,
        frame: 105,
        inputProps: { spec, strictSceneErrors: true },
      }),
    );
    expect(onProgress).toHaveBeenCalledWith(1, 2);
    expect(onProgress).toHaveBeenCalledWith(2, 2);
  });
});

describe("bundle cache (Phase A)", () => {
  // A serveUrl is spec-independent, so two render ops over the SAME entry +
  // publicDir reuse one bundle (the win: 4 bundles/render → fewer). Keyed by
  // publicDir PATH, so a different project root is a miss (no cross-project hit).
  it("reuses one bundle across two ops with the same entry + publicDir", async () => {
    const spec = lockedSpec();
    const projectRoot = join(tempRoot, "projects", "demo-12345678");

    const timings: Array<{ name: string }> = [];
    await renderVideo({ spec, outPath: join(projectRoot, "renders", "demo-12345678.mp4"), projectRoot });
    await renderSceneStills(spec, join(projectRoot, "review"), { projectRoot, onTiming: (timing) => timings.push(timing) });

    // Both ops default to the same Remotion entry + same publicDir ⇒ one bundle,
    // one selectComposition, then a composition cache hit for the stills pass.
    expect(mocks.bundle).toHaveBeenCalledTimes(1);
    expect(mocks.selectComposition).toHaveBeenCalledTimes(1);
    expect(timings.map((timing) => timing.name)).toContain("stills.selectComposition.cache_hit");
  });

  it("does NOT reuse across different publicDirs (keyed by project root)", async () => {
    const spec = lockedSpec();
    const rootA = join(tempRoot, "projects", "demo-aaaaaaaa");
    const rootB = join(tempRoot, "projects", "demo-bbbbbbbb");

    await renderVideo({ spec, outPath: join(rootA, "renders", "a.mp4"), projectRoot: rootA });
    await renderVideo({ spec, outPath: join(rootB, "renders", "b.mp4"), projectRoot: rootB });

    expect(mocks.bundle).toHaveBeenCalledTimes(2);
  });
});
