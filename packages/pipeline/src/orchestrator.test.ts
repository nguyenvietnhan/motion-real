import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LockedVideoSpec, VideoSpec } from "@news/schema";

/**
 * Orchestrator tests (Task 10.1; Requirements 1.1, 5.1, 6.5, 8.3, 8.5).
 *
 * @remotion/bundler + @remotion/renderer are mocked exactly like
 * renderer/cache/review tests so NO Chromium is downloaded and NO real render
 * happens; the mocked renderStill writes controllable bytes (identical → the
 * determinism guard passes) and the mocked renderMedia writes the MP4 file so
 * the render cache can be populated. VIDEO_TOOL_HOME points at a temp dir so
 * nothing touches the repo root. TTS is faked (mock-provider semantics) so no
 * network/Vivibe/ffmpeg is required, and the contact-sheet compositor is
 * injected so ffmpeg is never spawned.
 */

let stillBytes = "identical-frame-bytes";

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

import {
  createVideoProject,
  renderProject,
  type RenderProjectDeps,
} from "./orchestrator.js";
import { buildMockSpec } from "./planner/mock.js";
import { projectPaths, renderCacheDir } from "./store.js";
import { specHash } from "./cache.js";
import { lockSpec } from "./lock.js";
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
  // renderMedia writes the MP4 so the render cache can copy a real file.
  mocks.renderMedia.mockImplementation(async ({ outputLocation, onProgress }) => {
    onProgress?.({ progress: 1 });
    await writeFile(outputLocation, Buffer.from("fake-mp4-bytes"));
    return { buffer: null, slowestFrames: [], contentType: "video/mp4" };
  });
  // renderStill writes deterministic bytes (identical across calls by default).
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

/** Fake compositor: write a small file so contact.jpg exists without ffmpeg. */
function fakeCompositor(): ComposeContactSheet {
  return vi.fn(async ({ outPath }) => {
    await writeFile(outPath, Buffer.from("jpg-bytes"));
  });
}

/**
 * Fake TTS: write a tiny WAV per scene + a mixed track into the project audio
 * dir and return a manifest. No ffmpeg, no Vivibe — mirrors mock-provider
 * semantics so lockSpec/build-grid (N13) see real, non-empty audio files.
 */
function fakeSynthesize(): RenderProjectDeps["synthesize"] {
  return async (spec, opts) => {
    const paths = projectPaths(opts.projectId);
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
        duration: scene.durationInSeconds,
        source: "mock",
      };
    }
    const mixedAbs = join(paths.audioDir, "narration.mixed.wav");
    await writeFile(mixedAbs, Buffer.from("mixed-wav-bytes"));
    return { updatedAt: "2026-01-01T00:00:00.000Z", voiceId: "mock-voice", speed: 1, byScene, mixedSrc: "audio/narration.mixed.wav" };
  };
}

async function readBriefState(projectId: string): Promise<string> {
  const brief = JSON.parse(await readFile(projectPaths(projectId).brief, "utf8"));
  return brief.state;
}

// --- createVideoProject ----------------------------------------------------

describe("createVideoProject — Req 1.1 / 8.3", () => {
  it("plans, writes the brief + video-spec.json, and advances to 'planned'", async () => {
    const result = await createVideoProject({ prompt: "Vì sao chip AI đang đắt đỏ", duration: 60, aiProvider: "mock" });

    const paths = projectPaths(result.projectId);
    expect(existsSync(paths.brief)).toBe(true);
    expect(existsSync(paths.spec)).toBe(true);

    // Persisted spec matches the planner output and conforms to VideoSpec shape.
    const spec = JSON.parse(await readFile(paths.spec, "utf8")) as VideoSpec;
    expect(spec.version).toBe(1);
    expect(spec.duration).toBe(60);
    expect(spec.scenes.length).toBe(result.spec.scenes.length);

    expect(result.brief.state).toBe("planned");
    expect(await readBriefState(result.projectId)).toBe("planned");
    expect(result.report.ok).toBe(true);

    // Lifecycle events were appended (created + spec.created), no real render used.
    const events = (await readFile(paths.events, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    expect(events.map((e) => e.type)).toContain("project.created");
    expect(events.map((e) => e.type)).toContain("spec.created");
    expect(mocks.ensureBrowser).not.toHaveBeenCalled();
  });

  it("does NOT proceed when the static grid reports a hard error (state → failed)", async () => {
    // Inject a planner that returns a spec with an unknown component id → N2 error.
    const badPlanner: typeof import("./planner/index.js").planVideoSpec = async (input) => {
      const spec = buildMockSpec(input.prompt, input.duration);
      spec.scenes[0]!.component = "totally-not-a-registered-component";
      return { spec, issues: [], attempts: 1 };
    };

    let projectId = "";
    await expect(
      createVideoProject({ prompt: "broken spec", duration: 60, aiProvider: "mock", plan: badPlanner }),
    ).rejects.toThrow();

    // Find the created project and assert it failed without writing the spec.
    const { listProjects } = await import("./store.js");
    const projects = await listProjects();
    expect(projects.length).toBe(1);
    projectId = projects[0]!.projectId;
    expect(projects[0]!.brief?.state).toBe("failed");
    expect(existsSync(projectPaths(projectId).spec)).toBe(false);
  });
});

// --- renderProject ---------------------------------------------------------

describe("renderProject — Req 5.1 / 6.5 / 8.5", () => {
  async function plannedProject(): Promise<string> {
    const created = await createVideoProject({
      prompt: "Pipeline render test topic",
      duration: 60,
      aiProvider: "mock",
      tts: { provider: "mock" },
    });
    return created.projectId;
  }

  it("locks + writes manifest, runs the build gate + determinism, renders, caches, and reviews", async () => {
    const projectId = await plannedProject();
    const compose = fakeCompositor();

    const result = await renderProject(projectId, {
      ttsProvider: "mock",
      checklist: FULL_CHECKLIST,
      composeContactSheet: compose,
      deps: { synthesize: fakeSynthesize() },
    });

    const paths = projectPaths(projectId);

    // (1) lock + manifest written.
    expect(existsSync(paths.lock)).toBe(true);
    expect(existsSync(paths.ttsManifest)).toBe(true);

    // (2) determinism guard ran on the sampled frame (rendered twice, identical).
    expect(mocks.renderStill).toHaveBeenCalled();

    // (3) MP4 written + reported, and the render cache was populated.
    expect(result.cached).toBe(false);
    expect(existsSync(result.mp4Path)).toBe(true);
    expect(result.mp4Path).toBe(join(paths.rendersDir, `${projectId}.mp4`));
    const locked = JSON.parse(await readFile(paths.lock, "utf8")) as LockedVideoSpec;
    expect(existsSync(join(renderCacheDir(), `${specHash(locked)}.mp4`))).toBe(true);

    // (4) review ran + gate passed → state 'done'.
    expect(compose).toHaveBeenCalledTimes(1);
    expect(existsSync(join(paths.reviewDir, "review.json"))).toBe(true);
    expect(result.report.ok).toBe(true);
    expect(await readBriefState(projectId)).toBe("done");

    // (5) state transitions were persisted as events.
    const events = (await readFile(paths.events, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    const types = events.map((e) => e.type);
    expect(types).toEqual(
      expect.arrayContaining(["tts.done", "lock.written", "build.ok", "determinism.ok", "render.done", "project.done"]),
    );
  });

  it("serves the MP4 from cache on a second identical render (cached: true)", async () => {
    const projectId = await plannedProject();
    const deps: RenderProjectDeps = { synthesize: fakeSynthesize() };

    const first = await renderProject(projectId, {
      ttsProvider: "mock",
      checklist: FULL_CHECKLIST,
      composeContactSheet: fakeCompositor(),
      deps,
    });
    expect(first.cached).toBe(false);
    expect(mocks.renderMedia).toHaveBeenCalledTimes(1);

    const second = await renderProject(projectId, {
      ttsProvider: "mock",
      checklist: FULL_CHECKLIST,
      composeContactSheet: fakeCompositor(),
      deps,
    });
    expect(second.cached).toBe(true);
    // No second render — the cache hit short-circuited renderMedia.
    expect(mocks.renderMedia).toHaveBeenCalledTimes(1);
    expect(existsSync(second.mp4Path)).toBe(true);
  });

  it("renders a silent visual draft with --tts none (no manifest, lock falls back to target seconds)", async () => {
    const projectId = await plannedProject();

    const result = await renderProject(projectId, {
      ttsProvider: "none",
      checklist: FULL_CHECKLIST,
      composeContactSheet: fakeCompositor(),
    });

    const paths = projectPaths(projectId);
    // No TTS → no manifest written, but locking + render still happen.
    expect(existsSync(paths.ttsManifest)).toBe(false);
    expect(existsSync(paths.lock)).toBe(true);
    expect(existsSync(result.mp4Path)).toBe(true);

    // Locked durations fall back to the scene target seconds (no measured audio).
    const draftSpec = JSON.parse(await readFile(paths.spec, "utf8")) as VideoSpec;
    const expected = lockSpec(draftSpec, null, {});
    const locked = JSON.parse(await readFile(paths.lock, "utf8")) as LockedVideoSpec;
    expect(locked.durationInFrames).toBe(expected.durationInFrames);
    expect(result.report.ok).toBe(true);
    expect(await readBriefState(projectId)).toBe("done");
  });

  it("fails the determinism guard (N16) when the sampled frame is non-deterministic", async () => {
    const projectId = await plannedProject();
    let call = 0;
    // Make the two determinism renders disagree.
    mocks.renderStill.mockImplementation(async ({ output }) => {
      await writeFile(output, Buffer.from(`frame-${call++}`));
      return { buffer: null, contentType: "image/png" };
    });

    await expect(
      renderProject(projectId, {
        ttsProvider: "none",
        checklist: FULL_CHECKLIST,
        composeContactSheet: fakeCompositor(),
      }),
    ).rejects.toThrow(/determinism/i);

    expect(await readBriefState(projectId)).toBe("failed");
    // The render never started (guard runs before the full render).
    expect(mocks.renderMedia).not.toHaveBeenCalled();
  });

  it("keeps the project in 'reviewing' when the review checklist is incomplete (default all-false)", async () => {
    const projectId = await plannedProject();

    const result = await renderProject(projectId, {
      ttsProvider: "none",
      composeContactSheet: fakeCompositor(),
      // no checklist → all-false → N25 gate stays closed
    });

    expect(existsSync(result.mp4Path)).toBe(true);
    expect(result.report.ok).toBe(false);
    expect(await readBriefState(projectId)).toBe("reviewing");
  });
});
