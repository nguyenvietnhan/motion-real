import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { LockedVideoSpec } from "@news/schema";

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

import { renderSceneStills, renderVideo } from "./renderer.js";

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "news-renderer-"));
  mocks.bundle.mockResolvedValue("http://localhost:3000/bundle");
  mocks.ensureBrowser.mockResolvedValue({ type: "local-puppeteer-browser", path: "chrome" });
  mocks.selectComposition.mockImplementation(async ({ inputProps }) => ({
    id: "NewsVideo",
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
    styleId: "clean-luxury-tech",
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
  };
}

describe("renderVideo", () => {
  it("uses the Node Remotion path with locked spec input props and h264 output", async () => {
    const spec = lockedSpec();
    const projectRoot = join(tempRoot, "projects", "demo-12345678");
    const outPath = join(projectRoot, "renders", "demo-12345678.mp4");
    const onProgress = vi.fn();

    const result = await renderVideo({ spec, outPath, concurrency: 2, onProgress });

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
        id: "NewsVideo",
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

    const outputs = await renderSceneStills(spec, outDir);

    expect(outputs).toEqual([join(resolve(outDir), "scene-01.png"), join(resolve(outDir), "scene-02.png")]);
    expect(mocks.renderStill).toHaveBeenCalledTimes(2);
    expect(mocks.renderStill.mock.calls.map(([options]) => options.frame)).toEqual([45, 105]);
    expect(mocks.renderStill.mock.calls.map(([options]) => options.imageFormat)).toEqual(["png", "png"]);
  });
});
