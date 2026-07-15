import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { cpus, tmpdir } from "node:os";
import { join } from "node:path";
import { tierSeconds, type DurationTier, type VideoFormat, type LockedVideoSpec, type VideoSpec } from "@motionreal/schema";

/**
 * Orchestrator tests (pure AUTHOR mode). @remotion/bundler + @remotion/renderer
 * are mocked so NO Chromium is downloaded and NO real render happens. The
 * authored-admission path (dynamic.tsx import) is covered by admission tests;
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
import { encodePngRGBA } from "./safety/png.js";
import type { ComposeContactSheet } from "./review.js";
import { makeReport, type ReviewChecklist, type TtsManifest } from "./types.js";

let tempRoot: string;
let prevHome: string | undefined;
let prevRenderConcurrency: string | undefined;
let prevDraftRenderConcurrency: string | undefined;
let prevRenderGl: string | undefined;
let prevRenderChromeMode: string | undefined;
let prevLayoutMeasure: string | undefined;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "news-orchestrator-"));
  prevHome = process.env.VIDEO_TOOL_HOME;
  prevRenderConcurrency = process.env.NEWS_RENDER_CONCURRENCY;
  prevDraftRenderConcurrency = process.env.NEWS_DRAFT_RENDER_CONCURRENCY;
  prevRenderGl = process.env.NEWS_RENDER_GL;
  prevRenderChromeMode = process.env.NEWS_RENDER_CHROME_MODE;
  prevLayoutMeasure = process.env.MOTIONREAL_LAYOUT_MEASURE;
  process.env.VIDEO_TOOL_HOME = tempRoot;
  delete process.env.NEWS_RENDER_CONCURRENCY;
  delete process.env.NEWS_DRAFT_RENDER_CONCURRENCY;
  delete process.env.NEWS_RENDER_GL;
  delete process.env.NEWS_RENDER_CHROME_MODE;
  delete process.env.MOTIONREAL_LAYOUT_MEASURE;
  stillBytes = "identical-frame-bytes";

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
  if (prevRenderConcurrency === undefined) delete process.env.NEWS_RENDER_CONCURRENCY;
  else process.env.NEWS_RENDER_CONCURRENCY = prevRenderConcurrency;
  if (prevDraftRenderConcurrency === undefined) delete process.env.NEWS_DRAFT_RENDER_CONCURRENCY;
  else process.env.NEWS_DRAFT_RENDER_CONCURRENCY = prevDraftRenderConcurrency;
  if (prevRenderGl === undefined) delete process.env.NEWS_RENDER_GL;
  else process.env.NEWS_RENDER_GL = prevRenderGl;
  if (prevRenderChromeMode === undefined) delete process.env.NEWS_RENDER_CHROME_MODE;
  else process.env.NEWS_RENDER_CHROME_MODE = prevRenderChromeMode;
  if (prevLayoutMeasure === undefined) delete process.env.MOTIONREAL_LAYOUT_MEASURE;
  else process.env.MOTIONREAL_LAYOUT_MEASURE = prevLayoutMeasure;
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
      provider: opts.provider,
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
  format: "tiktok",
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

async function readyProject(spec: VideoSpec = SAMPLE_SPEC): Promise<string> {
  const { projectId } = await scaffoldVideoProject({ prompt: "Author render test", tts: { provider: "mock" } });
  // Pre-write the resolved spec so renderProject can skip authoring/admission.
  await writeJson(projectPaths(projectId).spec, spec);
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

  it("captures the selected ElevenLabs voice and model in the project brief", async () => {
    const result = await scaffoldVideoProject({
      prompt: "ElevenLabs project",
      tts: { provider: "elevenlabs", voiceId: "voice-1", modelId: "eleven_multilingual_v2" },
    });
    expect(result.brief.tts).toMatchObject({
      provider: "elevenlabs",
      voiceId: "voice-1",
      modelId: "eleven_multilingual_v2",
      speed: 1,
    });
  });

  it("persists selected format and duration tier for restart-safe authoring retry", async () => {
    const result = await scaffoldVideoProject({
      prompt: "Random Forest",
      format: "tiktok",
      durationTier: 3,
    });
    expect(result.brief).toMatchObject({
      format: "tiktok",
      durationTier: 3,
      ratio: "9:16",
    });
    const persisted = JSON.parse(await readFile(projectPaths(result.projectId).brief, "utf8"));
    expect(persisted).toMatchObject({
      format: "tiktok",
      durationTier: 3,
      ratio: "9:16",
    });
  });

  it("resolves duration tier targets into the persisted brief duration", async () => {
    const cases: Array<{ format: VideoFormat; durationTier: DurationTier; seconds: number }> = [
      { format: "tiktok", durationTier: 1, seconds: 45 },
      { format: "tiktok", durationTier: 2, seconds: 90 },
      { format: "tiktok", durationTier: 3, seconds: 150 },
      { format: "tiktok", durationTier: 4, seconds: 210 },
    ];

    for (const item of cases) {
      const result = await scaffoldVideoProject({
        projectId: `duration-${item.format}-${item.durationTier}`,
        prompt: "Duration tier mapping",
        format: item.format,
        durationTier: item.durationTier,
      });

      expect(result.brief.duration).toBe(item.seconds);
      expect(result.brief.duration).toBe(tierSeconds(item.durationTier));
      const persisted = JSON.parse(await readFile(projectPaths(result.projectId).brief, "utf8"));
      expect(persisted.duration).toBe(item.seconds);
    }
  });

  it("resolves scaffold duration: explicit override, else UI tier wins over prompt", async () => {
    const explicit = await scaffoldVideoProject({
      projectId: "duration-explicit",
      prompt: "Make this 1p30s, but caller overrides",
      format: "tiktok",
      durationTier: 3,
      duration: 120,
    });
    expect(explicit.brief.duration).toBe(120);

    // Prompt "60s" vs tier 3 (~150s) → UI tier wins.
    const tierBeatsPrompt = await scaffoldVideoProject({
      projectId: "duration-tier-beats-prompt",
      prompt: "Make this a quick 60s video",
      format: "tiktok",
      durationTier: 3,
    });
    expect(tierBeatsPrompt.brief.duration).toBe(150);

    const tier4 = await scaffoldVideoProject({
      projectId: "duration-tier-4",
      prompt: "Short note in prompt 15s ignored",
      format: "tiktok",
      durationTier: 4,
    });
    expect(tier4.brief.duration).toBe(210);

    const promptOnly = await scaffoldVideoProject({
      projectId: "duration-prompt-only",
      prompt: "Make a 1p30s video",
      format: "tiktok",
    });
    expect(promptOnly.brief.duration).toBe(90);

    // No length stated, no tier → short-form default ~45s (tier 1).
    const fallback = await scaffoldVideoProject({
      projectId: "duration-default",
      prompt: "Make a video about bottlenecks",
      format: "tiktok",
    });
    expect(fallback.brief.duration).toBe(45);
  });
});

describe("renderProject — render pipeline (skipAuthoring)", () => {
  it("rejects a concurrent render for the same project before it can mutate render state", async () => {
    const projectId = await readyProject();
    let entered!: () => void;
    let release!: () => void;
    const enteredSynthesize = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const releaseSynthesize = new Promise<void>((resolve) => {
      release = resolve;
    });
    const synthesize: RenderProjectDeps["synthesize"] = async (spec, opts) => {
      entered();
      await releaseSynthesize;
      return fakeSynthesize()!(spec, opts);
    };

    const first = renderProject(projectId, {
      skipAuthoring: true,
      ttsProvider: "mock",
      checklist: FULL_CHECKLIST,
      composeContactSheet: fakeCompositor(),
      deps: { synthesize },
    });
    await enteredSynthesize;

    await expect(
      renderProject(projectId, {
        skipAuthoring: true,
        ttsProvider: "mock",
        checklist: FULL_CHECKLIST,
        composeContactSheet: fakeCompositor(),
        deps: { synthesize: fakeSynthesize() },
      }),
    ).rejects.toMatchObject({ stage: "render-lock" });

    release();
    await expect(first).resolves.toMatchObject({ projectId });
  });

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
    const timingEvents = events.filter((e) => e.type === "render.timing");
    const stageStarts = events.filter((e) => e.type === "render.stage_start");
    expect(stageStarts.map((e) => e.name)).toEqual(
      expect.arrayContaining([
        "stage.tts",
        "stage.lock",
        "stage.build_gate",
        "stage.determinism",
        "stage.render",
        "stage.review",
        "stage.render_oracles",
      ]),
    );
    expect(events.findIndex((e) => e.type === "render.stage_start" && e.name === "stage.tts")).toBeLessThan(
      events.findIndex((e) => e.type === "render.timing" && e.name === "stage.tts"),
    );
    expect(timingEvents.map((e) => e.name)).toEqual(
      expect.arrayContaining([
        "stage.tts",
        "stage.lock",
        "stage.build_gate",
        "stage.determinism",
        "stage.render",
        "stage.review",
        "stage.render_oracles",
        "stage.layout_measure.skipped",
        "stage.late_safe_area",
        "stage.render_cache_key",
        "stage.read_authored_sources",
        "video.ensureBrowser",
        "video.renderMedia",
        "review-stills.renderStillFallback",
      ]),
    );
    expect(timingEvents.every((e) => typeof e.ms === "number")).toBe(true);
  });

  it("treats bgmPath null as explicit silence instead of using default.mp3", async () => {
    const projectId = await readyProject();
    const synthesize = fakeSynthesize();
    let seenBgmPath: string | undefined;

    await renderProject(projectId, {
      skipAuthoring: true,
      ttsProvider: "mock",
      bgmPath: null,
      checklist: FULL_CHECKLIST,
      composeContactSheet: fakeCompositor(),
      deps: {
        synthesize: async (spec, opts) => {
          seenBgmPath = opts.bgmPath;
          return synthesize!(spec, opts);
        },
      },
    });

    expect(seenBgmPath).toBeUndefined();
  });

  it("adapts default draft concurrency but leaves full render on the renderer default", async () => {
    const draftProject = await readyProject();

    await renderProject(draftProject, {
      skipAuthoring: true,
      quality: "draft",
      ttsProvider: "none",
      checklist: FULL_CHECKLIST,
      composeContactSheet: fakeCompositor(),
    });

    const logicalCpus = Math.max(1, cpus().length);
    const expected = Math.max(1, logicalCpus - 1);
    const draftRenderCall = mocks.renderMedia.mock.calls.at(-1)?.[0];
    expect(draftRenderCall?.concurrency).toBe(expected);

    const fullProject = await readyProject();
    await renderProject(fullProject, {
      skipAuthoring: true,
      ttsProvider: "none",
      checklist: FULL_CHECKLIST,
      composeContactSheet: fakeCompositor(),
    });

    const fullRenderCall = mocks.renderMedia.mock.calls.at(-1)?.[0];
    expect(fullRenderCall?.concurrency).toBeNull();
  });

  it("passes machine-level Chromium GL config through to Remotion", async () => {
    process.env.NEWS_RENDER_GL = "angle";
    const projectId = await readyProject();

    await renderProject(projectId, {
      skipAuthoring: true,
      quality: "draft",
      ttsProvider: "none",
      checklist: FULL_CHECKLIST,
      composeContactSheet: fakeCompositor(),
    });

    expect(mocks.selectComposition).toHaveBeenCalledWith(expect.objectContaining({ chromiumOptions: { gl: "angle" } }));
    expect(mocks.renderMedia).toHaveBeenCalledWith(expect.objectContaining({ chromiumOptions: { gl: "angle" } }));
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

  it("skips N15/N17 layout measuring for SceneImage-only specs by default", async () => {
    const projectId = await readyProject({
      ...SAMPLE_SPEC,
      scenes: [
        { ...SAMPLE_SPEC.scenes[0]!, image: { ref: "assets/photo.png", alt: "photo" } },
        SAMPLE_SPEC.scenes[1]!,
      ],
    });
    await writeFile(join(projectPaths(projectId).assetsDir, "photo.png"), Buffer.from("fake-image"));

    await renderProject(projectId, {
      skipAuthoring: true,
      ttsProvider: "none",
      forceFull: true,
      checklist: FULL_CHECKLIST,
      composeContactSheet: fakeCompositor(),
    });

    const events = (await readFile(projectPaths(projectId).events, "utf8"))
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const timingNames = events.filter((e) => e.type === "render.timing").map((e) => e.name);
    expect(timingNames).toContain("stage.layout_measure.skipped");
    expect(timingNames).not.toContain("stage.layout_measure");
    expect(events.find((e) => e.type === "render.overlap.skipped")).toMatchObject({
      cause: "no tagged layout blocks",
      layoutMeasureMode: "auto",
    });
  });

  it("surfaces N15/N17 layout warnings as non-gating diagnostics", async () => {
    const projectId = await readyProject();
    mocks.renderStill.mockImplementation(async ({ output, onArtifact }) => {
      if (output === null) {
        onArtifact?.({
          content: JSON.stringify({
            blocks: [
              { kind: "headline", x: 100, y: 100, width: 200, height: 160 },
              { kind: "body", x: 150, y: 130, width: 200, height: 160 },
            ],
          }),
        });
      } else if (typeof output === "string") {
        await writeFile(output, layoutWarningStillPng());
      }
      return { buffer: null, contentType: "image/png" };
    });

    const result = await renderProject(projectId, {
      skipAuthoring: true,
      ttsProvider: "none",
      forceFull: true,
      checklist: FULL_CHECKLIST,
      composeContactSheet: fakeCompositor(),
      layoutMeasureMode: "force",
    });

    const events = (await readFile(projectPaths(projectId).events, "utf8"))
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const timingNames = events.filter((e) => e.type === "render.timing").map((e) => e.name);
    expect(timingNames).toContain("stage.layout_measure");
    expect(events.find((e) => e.type === "render.overlap")).toMatchObject({ scenes: SAMPLE_SPEC.scenes.length });
    const layoutWarnings = result.report.issues.filter((i) => i.check === "N15" || i.check === "N17");
    expect(layoutWarnings.some((i) => i.check === "N15")).toBe(true);
    expect(layoutWarnings.some((i) => i.check === "N17")).toBe(true);
    expect(layoutWarnings.every((i) => i.severity === "warning")).toBe(true);
    expect(result.report.issues.some((i) => i.severity === "error")).toBe(false);
    expect(result.report.ok).toBe(true);
    expect(await readBriefState(projectId)).toBe("done");
  });

  it("surfaces late-sample N14 drift as a non-gating WARNING (lands in the report, project still 'done')", async () => {
    // A late still (`<id>.f82.png`) whose content drifts into the caption
    // clearance gap must produce an N14 issue — but as a WARNING, so it appears
    // in the aggregate report without flipping the "done" gate. We make ONLY the
    // late stills decodable (a 1080×1920 PNG with content painted in the gap);
    // the midpoint stills keep the default non-PNG bytes (runRenderGrid just
    // warns "could not load" for those, which also never flips the gate).
    mocks.renderStill.mockImplementation(async ({ output }) => {
      if (typeof output === "string" && output.endsWith(".f82.png")) {
        await writeFile(output, dirtyLateStillPng());
      } else if (typeof output === "string") {
        await writeFile(output, Buffer.from(stillBytes));
      }
      return { buffer: null, contentType: "image/png" };
    });

    const projectId = await readyProject();
    const result = await renderProject(projectId, {
      skipAuthoring: true,
      ttsProvider: "mock",
      checklist: FULL_CHECKLIST,
      composeContactSheet: fakeCompositor(),
      deps: { synthesize: fakeSynthesize() },
    });

    // The drift is reported as a late-sample N14 warning…
    const late = result.report.issues.filter(
      (i) => i.check === "N14" && i.severity === "warning" && i.message.includes("[late sample]"),
    );
    expect(late.length).toBeGreaterThan(0);
    // …but it does NOT flip the gate: no error issues, project reaches "done".
    expect(result.report.issues.some((i) => i.severity === "error")).toBe(false);
    expect(result.report.ok).toBe(true);
    expect(await readBriefState(projectId)).toBe("done");

    const events = (await readFile(projectPaths(projectId).events, "utf8"))
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(events.map((e) => e.type)).toContain("render.latesafearea");
  });

  it("surfaces N10 degraded diagnostics as non-gating report warnings", async () => {
    const { projectId } = await scaffoldVideoProject({
      prompt: "N10 degraded diagnostic project",
      tts: { provider: "none" },
    });
    const paths = projectPaths(projectId);
    await writeFile(join(paths.authoredDir, "scene-01.tsx"), authoredProbeSceneSource(), "utf8");
    await writeJson(paths.manifest, {
      title: "N10 degraded diagnostic project",
      scenes: [
        {
          id: "scene-01",
          component: "authored-runtime-probe",
          headline: "Probe",
          narration: "Một câu đọc thử cho cảnh N10 diagnostic.",
          props: { label: "Demo" },
          durationInSeconds: 4,
        },
      ],
    });
    const n10Warning = {
      check: "N10",
      severity: "warning" as const,
      path: "packaged-app",
      message: "Authored typecheck skipped: packaged layout. N10 degraded to a no-op; crash-class unbound names were not checked before render.",
    };
    const typecheckAuthored = vi.fn<NonNullable<RenderProjectDeps["typecheckAuthored"]>>(() => [n10Warning]);
    const sceneRuntimeProbe: RenderProjectDeps["sceneRuntimeProbe"] = vi.fn(async () => makeReport([], ["render"]));
    const determinism: RenderProjectDeps["determinism"] = vi.fn(async () => makeReport([], ["render"]));

    const result = await renderProject(projectId, {
      forceFull: true,
      ttsProvider: "none",
      checklist: FULL_CHECKLIST,
      composeContactSheet: fakeCompositor(),
      deps: { typecheckAuthored, sceneRuntimeProbe, determinism },
    });

    expect(typecheckAuthored).toHaveBeenCalled();
    expect(result.report.issues).toContainEqual(n10Warning);
    expect(result.report.ok).toBe(true);
    expect(await readBriefState(projectId)).toBe("done");
  });

  it("blocks authored renders when the strict scene runtime probe reports a fallback-hidden crash", async () => {
    const { projectId } = await scaffoldVideoProject({
      prompt: "Runtime probe authored project",
      tts: { provider: "none" },
    });
    const paths = projectPaths(projectId);
    await writeFile(join(paths.authoredDir, "scene-01.tsx"), authoredProbeSceneSource(), "utf8");
    await writeJson(paths.manifest, {
      title: "Runtime probe authored project",
      scenes: [
        {
          id: "scene-01",
          component: "authored-runtime-probe",
          headline: "Probe",
          narration: "Một câu đọc thử cho cảnh runtime probe.",
          props: { label: "Demo" },
          durationInSeconds: 4,
        },
      ],
    });
    const sceneRuntimeProbe: RenderProjectDeps["sceneRuntimeProbe"] = vi.fn(async () =>
      makeReport(
        [
          {
            check: "N31",
            severity: "error",
            sceneId: "scene-01",
            path: "frame:0",
            message: "Authored scene crashed during strict runtime probe: inputRange must be strictly increasing.",
          },
        ],
        ["render"],
      ),
    );
    const determinism: RenderProjectDeps["determinism"] = vi.fn(async () => makeReport([], ["render"]));

    await expect(
      renderProject(projectId, {
        forceFull: true,
        ttsProvider: "none",
        checklist: FULL_CHECKLIST,
        composeContactSheet: fakeCompositor(),
        deps: { sceneRuntimeProbe, determinism },
      }),
    ).rejects.toMatchObject({ check: "N31", sceneId: "scene-01" });

    expect(sceneRuntimeProbe).toHaveBeenCalled();
    expect(determinism).not.toHaveBeenCalled();
    expect(mocks.renderMedia).not.toHaveBeenCalled();
    expect(await readBriefState(projectId)).toBe("failed");
  });
});

/**
 * A 1080×1920 PNG whose only content is a white bar painted INTO the caption
 * clearance gap (y≈1360) — exactly the synthetic input `checkCaptionClearance`
 * fires on. Used to prove the late-sample pass turns real drift into a warning.
 */
function dirtyLateStillPng(): Buffer {
  const width = 1080;
  const height = 1920;
  const rgba = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p += 1) {
    rgba[p * 4] = 10;
    rgba[p * 4 + 1] = 12;
    rgba[p * 4 + 2] = 18;
    rgba[p * 4 + 3] = 255;
  }
  for (let y = 1358; y < 1368; y += 1) {
    for (let x = 120; x < 620; x += 1) {
      const i = (y * width + x) * 4;
      rgba[i] = 255;
      rgba[i + 1] = 255;
      rgba[i + 2] = 255;
      rgba[i + 3] = 255;
    }
  }
  return encodePngRGBA(width, height, rgba);
}

/**
 * A 1080x1920 PNG with white content exactly on the right/bottom edge of the
 * synthetic measured block used by the layout-warning test, so N17 fires.
 */
function layoutWarningStillPng(): Buffer {
  const width = 1080;
  const height = 1920;
  const rgba = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p += 1) {
    rgba[p * 4] = 10;
    rgba[p * 4 + 1] = 12;
    rgba[p * 4 + 2] = 18;
    rgba[p * 4 + 3] = 255;
  }
  for (let y = 100; y < 260; y += 1) {
    const i = (y * width + 299) * 4;
    rgba[i] = 255;
    rgba[i + 1] = 255;
    rgba[i + 2] = 255;
    rgba[i + 3] = 255;
  }
  for (let x = 100; x < 300; x += 1) {
    const i = (259 * width + x) * 4;
    rgba[i] = 255;
    rgba[i + 1] = 255;
    rgba[i + 2] = 255;
    rgba[i + 3] = 255;
  }
  return encodePngRGBA(width, height, rgba);
}

function authoredProbeSceneSource(): string {
  return `
import React from "react";
import { useCurrentFrame } from "remotion";
import { registerComponent, type SceneComponentProps } from "@motionreal/compositions";
import { z } from "zod";

export const schema = z.object({ label: z.string().min(1) });
type Props = z.infer<typeof schema>;

const Scene: React.FC<SceneComponentProps<Props>> = ({ headline, props }) => {
  const frame = useCurrentFrame();
  return <div style={{ opacity: Math.min(1, frame / 15) }}>{headline}: {props.label}</div>;
};

export const example: Props = { label: "Demo" };

export default registerComponent<Props>({
  id: "authored-runtime-probe",
  displayName: "Runtime Probe",
  promptGuide: "Used by the orchestrator runtime probe test.",
  schema,
  Component: Scene,
  example,
});
`;
}
