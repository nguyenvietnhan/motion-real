import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LockedVideoSpec, VideoSpec } from "@news/schema";

/**
 * Orchestrator tests (pure AUTHOR mode). @remotion/bundler + @remotion/renderer
 * are mocked so NO Chromium is downloaded and NO real render happens. The
 * authored-admission path (dynamic .tsx import) is covered by admission tests;
 * here we exercise the render orchestration via `skipAuthoring` with a
 * pre-written spec, plus the scaffold step. VIDEO_TOOL_HOME → temp dir.
 */

let stillBytes = "identical-frame-bytes";

const mocks = vi.hoisted(() => ({
  bundle: vi.fn(),
  ensureBrowser: vi.fn(),
  selectComposition: vi.fn(),
  renderMedia: vi.fn(),
  renderStill: vi.fn(),
}));

vi.mock("@remotion/bundler", () => ({ bundle: mocks.bundle }));
vi.mock("@remotion/renderer", () => ({
  ensureBrowser: mocks.ensureBrowser,
  selectComposition: mocks.selectComposition,
  renderMedia: mocks.renderMedia,
  renderStill: mocks.renderStill,
}));

import { scaffoldVideoProject, renderProject, type RenderProjectDeps } from "./orchestrator.js";
import { projectPaths, renderCacheDir, writeJson } from "./store/store.js";
import { specHash } from "./render/cache.js";
import type { ComposeContactSheet } from "./review.js";
import type { ReviewChecklist, TtsManifest } from "./types.js";

let tempRoot: string;
let prevHome: string | undefined;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "news-orchestrator-"));
  prevHome = process.env.VIDEO_TOOL_HOME;
  process.env.VIDEO_TOOL_HOME = tempRoot;
  stillBytes = "identical-frame-bytes";

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
  mocks.renderMedia.mockImplementation(async ({ outputLocation, onProgress }) => {
    onProgress?.({ progress: 1 });
    await writeFile(outputLocation, Buffer.from("fake-mp4-bytes"));
    return { buffer: null, slowestFrames: [], contentType: "video/mp4" };
  });
  mocks.renderStill.mockImplementation(async ({ output }) => {
    await writeFile(output, Buffer.from(stillBytes));
    return { buffer: null, contentType: "image/png" };
  });
});

afterEach(async () => {
  vi.clearAllMocks();
  if (prevHome === undefined) delete process.env.VIDEO_TOOL_HOME;
  else process.env.VIDEO_TOOL_HOME = prevHome;
  await rm(tempRoot, { recursive: true, force: true });
});

const FULL_CHECKLIST: ReviewChecklist = {
  safeArea: true,
  alignment: true,
  transitions: true,
  clutter: true,
  hook: true,
  cta: true,
  audio: true,
  richness: true,
};

function fakeCompositor(): ComposeContactSheet {
  return vi.fn(async ({ outPath }) => {
    await writeFile(outPath, Buffer.from("jpg-bytes"));
  });
}

function fakeSynthesize(): RenderProjectDeps["synthesize"] {
  return async (spec, opts) => {
    const paths = projectPaths(opts.projectId);
    const { mkdir } = await import("node:fs/promises");
    await mkdir(paths.audioDir, { recursive: true });
    const byScene: TtsManifest["byScene"] = {};
    for (const scene of spec.scenes) {
      const audioPath = join(paths.audioDir, `${scene.id}.wav`);
      await writeFile(audioPath, Buffer.from("wav-bytes"));
      byScene[scene.id] = {
        text: scene.narration,
        voiceId: "mock-voice",
        speed: 1,
        audioPath,
        duration: scene.durationInSeconds ?? 8,
        source: "mock",
      };
    }
    await writeFile(join(paths.audioDir, "narration.mixed.wav"), Buffer.from("mixed-wav-bytes"));
    return {
      updatedAt: "2026-01-01T00:00:00.000Z",
      voiceId: "mock-voice",
      speed: 1,
      byScene,
      mixedSrc: "audio/narration.mixed.wav",
    };
  };
}

const SAMPLE_SPEC: VideoSpec = {
  version: 1,
  title: "Orchestrator test",
  styleId: "clean-luxury-tech",
  ratio: "9:16",
  language: "vi",
  theme: { dominant: "#4CE0A7" },
  scenes: [
    {
      id: "scene-01",
      component: "auth-hook",
      durationInSeconds: 5,
      headline: "Mở đầu",
      narration: "Một câu đọc thử cho cảnh mở đầu để giữ nhịp tự nhiên.",
      props: {},
    },
    {
      id: "scene-02",
      component: "auth-cta",
      durationInSeconds: 4,
      headline: "Kết",
      narration: "Một câu kết ngắn nhưng đủ dài cho phần đóng lại.",
      props: {},
    },
  ],
};

async function readyProject(): Promise<string> {
  const { projectId } = await scaffoldVideoProject({ prompt: "Author render test", tts: { provider: "mock" } });
  // Pre-write the resolved spec so renderProject can skip authoring/admission.
  await writeJson(projectPaths(projectId).spec, SAMPLE_SPEC);
  // Satisfy the draft-first gate: pretend a draft was already rendered/reviewed.
  const paths = projectPaths(projectId);
  await mkdir(paths.rendersDir, { recursive: true });
  await writeFile(join(paths.rendersDir, `${projectId}.draft.mp4`), Buffer.from(""));
  return projectId;
}

async function readBriefState(projectId: string): Promise<string> {
  const brief = JSON.parse(await readFile(projectPaths(projectId).brief, "utf8"));
  return brief.state;
}

describe("scaffoldVideoProject — R8/R10", () => {
  it("writes the brief + empty manifest + authored dir and is 'scaffolded'", async () => {
    const result = await scaffoldVideoProject({ prompt: "Vì sao chip AI đang đắt đỏ" });
    const paths = projectPaths(result.projectId);
    expect(existsSync(paths.brief)).toBe(true);
    expect(existsSync(paths.manifest)).toBe(true);
    expect(existsSync(paths.authoredDir)).toBe(true);
    expect(result.brief.state).toBe("scaffolded");
    expect(await readBriefState(result.projectId)).toBe("scaffolded");
  });
});

describe("renderProject — render pipeline (skipAuthoring)", () => {
  it("locks, runs build gate + determinism, renders, caches, oracles + review → done", async () => {
    const projectId = await readyProject();
    const compose = fakeCompositor();

    const result = await renderProject(projectId, {
      skipAuthoring: true,
      ttsProvider: "mock",
      checklist: FULL_CHECKLIST,
      composeContactSheet: compose,
      deps: { synthesize: fakeSynthesize() },
    });

    const paths = projectPaths(projectId);
    expect(existsSync(paths.lock)).toBe(true);
    expect(existsSync(paths.ttsManifest)).toBe(true);
    expect(mocks.renderStill).toHaveBeenCalled();
    expect(result.cached).toBe(false);
    expect(existsSync(result.mp4Path)).toBe(true);
    const locked = JSON.parse(await readFile(paths.lock, "utf8")) as LockedVideoSpec;
    expect(locked.captions.length).toBeGreaterThan(0); // captions baked from narration
    expect(existsSync(join(renderCacheDir(), `${specHash(locked)}.mp4`))).toBe(true);
    expect(compose).toHaveBeenCalledTimes(1);
    expect(result.report.ok).toBe(true);
    expect(await readBriefState(projectId)).toBe("done");

    const events = (await readFile(paths.events, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    const types = events.map((e) => e.type);
    expect(types).toEqual(
      expect.arrayContaining(["tts.done", "lock.written", "build.ok", "determinism.ok", "render.done", "project.done"]),
    );
  });

  it("serves the MP4 from cache on a second identical render", async () => {
    const projectId = await readyProject();
    const deps: RenderProjectDeps = { synthesize: fakeSynthesize() };

    const first = await renderProject(projectId, {
      skipAuthoring: true,
      ttsProvider: "mock",
      checklist: FULL_CHECKLIST,
      composeContactSheet: fakeCompositor(),
      deps,
    });
    expect(first.cached).toBe(false);
    expect(mocks.renderMedia).toHaveBeenCalledTimes(1);

    const second = await renderProject(projectId, {
      skipAuthoring: true,
      ttsProvider: "mock",
      checklist: FULL_CHECKLIST,
      composeContactSheet: fakeCompositor(),
      deps,
    });
    expect(second.cached).toBe(true);
    expect(mocks.renderMedia).toHaveBeenCalledTimes(1);
  });

  it("--no-cache forces a fresh render even when the cache has a hit", async () => {
    const projectId = await readyProject();
    const deps: RenderProjectDeps = { synthesize: fakeSynthesize() };
    const base = { skipAuthoring: true as const, ttsProvider: "mock" as const, checklist: FULL_CHECKLIST, deps };

    await renderProject(projectId, { ...base, composeContactSheet: fakeCompositor() });
    expect(mocks.renderMedia).toHaveBeenCalledTimes(1);

    const second = await renderProject(projectId, { ...base, noCache: true, composeContactSheet: fakeCompositor() });
    expect(second.cached).toBe(false);
    expect(mocks.renderMedia).toHaveBeenCalledTimes(2);
  });

  it("fails the determinism guard (N16) when the sampled frame is non-deterministic", async () => {
    const projectId = await readyProject();
    let call = 0;
    mocks.renderStill.mockImplementation(async ({ output }) => {
      await writeFile(output, Buffer.from(`frame-${call++}`));
      return { buffer: null, contentType: "image/png" };
    });

    await expect(
      renderProject(projectId, {
        skipAuthoring: true,
        ttsProvider: "none",
        checklist: FULL_CHECKLIST,
        composeContactSheet: fakeCompositor(),
      }),
    ).rejects.toThrow(/determinism/i);
    expect(await readBriefState(projectId)).toBe("failed");
    expect(mocks.renderMedia).not.toHaveBeenCalled();
  });

  it("keeps the project 'reviewing' when the review checklist is incomplete", async () => {
    const projectId = await readyProject();
    const result = await renderProject(projectId, {
      skipAuthoring: true,
      ttsProvider: "none",
      composeContactSheet: fakeCompositor(),
    });
    expect(existsSync(result.mp4Path)).toBe(true);
    expect(result.report.ok).toBe(false);
    expect(await readBriefState(projectId)).toBe("reviewing");
  });
});
