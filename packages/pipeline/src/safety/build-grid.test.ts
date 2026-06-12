import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LockedVideoSpec } from "@news/schema";
import { runBuildGridStatic, typecheckIssues, bundleIssues } from "./build-grid.js";
import { ensureProject, projectPaths } from "../store/store.js";

let home: string;
const prevHome = process.env.VIDEO_TOOL_HOME;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "news-build-"));
  process.env.VIDEO_TOOL_HOME = join(home, ".video-tool");
});

afterEach(async () => {
  process.env.VIDEO_TOOL_HOME = prevHome;
  await rm(home, { recursive: true, force: true });
});

function lockedNoAudio(): LockedVideoSpec {
  return {
    version: 1,
    title: "t",
    styleId: "clean-luxury-tech",
    duration: 60,
    ratio: "9:16",
    language: "vi",
    fps: 30,
    durationInFrames: 300,
    scenes: [
      {
        id: "scene-01",
        component: "hero-announcement",
        durationInSeconds: 5,
        headline: "H",
        narration: "n",
        props: {},
        startFrame: 0,
        durationInFrames: 150,
      },
      {
        id: "scene-02",
        component: "final-cta",
        durationInSeconds: 5,
        headline: "H2",
        narration: "n2",
        props: {},
        startFrame: 150,
        durationInFrames: 150,
      },
    ],
    audio: {},
    captions: [],
  };
}

describe("build grid — N12 locked timing", () => {
  it("passes a contiguous timeline", () => {
    const report = runBuildGridStatic(lockedNoAudio(), "demo-12345678");
    expect(report.issues.filter((i) => i.check === "N12")).toEqual([]);
  });

  it("fires when scenes do not tile to the total (gap/overlap)", () => {
    const locked = lockedNoAudio();
    locked.scenes[1]!.startFrame = 140; // overlap → end (290) !== total (300)
    const report = runBuildGridStatic(locked, "demo-12345678");
    expect(report.issues.some((i) => i.check === "N12")).toBe(true);
    expect(report.ok).toBe(false);
  });
});

describe("build grid — N13 missing audio", () => {
  it("does not require audio when the project has no narration", () => {
    const report = runBuildGridStatic(lockedNoAudio(), "demo-12345678");
    expect(report.issues.filter((i) => i.check === "N13")).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("fires when a scene declares narration audio that is missing on disk", async () => {
    const id = "audio-abcdef12";
    await ensureProject(id);
    const locked = lockedNoAudio();
    locked.scenes[0]!.audio = { src: "audio/scene-01.wav", duration: 5 };
    locked.scenes[1]!.audio = { src: "audio/scene-02.wav", duration: 5 };
    locked.audio = { narrationSrc: "audio/narration.mixed.wav" };
    const report = runBuildGridStatic(locked, id);
    // every missing file fires N13
    expect(report.issues.filter((i) => i.check === "N13").length).toBeGreaterThanOrEqual(3);
    expect(report.ok).toBe(false);
  });

  it("passes when declared audio files exist and are non-empty", async () => {
    const id = "audio-okfedcba";
    await ensureProject(id);
    const p = projectPaths(id);
    await mkdir(p.audioDir, { recursive: true });
    for (const f of ["scene-01.wav", "scene-02.wav", "narration.mixed.wav"]) {
      await writeFile(join(p.audioDir, f), Buffer.from("RIFFdummywav"));
    }
    const locked = lockedNoAudio();
    locked.scenes[0]!.audio = { src: "audio/scene-01.wav", duration: 5 };
    locked.scenes[1]!.audio = { src: "audio/scene-02.wav", duration: 5 };
    locked.audio = { narrationSrc: "audio/narration.mixed.wav" };
    const report = runBuildGridStatic(locked, id);
    expect(report.issues.filter((i) => i.check === "N13")).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("fires when a scene declares narration but has no audio entry at all", async () => {
    const id = "audio-noentry1";
    await ensureProject(id);
    const locked = lockedNoAudio();
    // mixed track present but scene-02 has no per-scene audio entry
    locked.scenes[0]!.audio = { src: "audio/scene-01.wav", duration: 5 };
    locked.audio = { narrationSrc: "audio/narration.mixed.wav" };
    const report = runBuildGridStatic(locked, id);
    expect(report.issues.some((i) => i.check === "N13" && i.sceneId === "scene-02")).toBe(true);
  });
});

describe("build grid — N9 image presence", () => {
  it("fires when a scene declares a local image.ref that is missing on disk", async () => {
    const id = "image-missing1";
    await ensureProject(id);
    const locked = lockedNoAudio();
    locked.scenes[0]!.image = { ref: "assets/missing.png" };
    const report = runBuildGridStatic(locked, id);
    expect(report.issues.some((i) => i.check === "N9" && i.sceneId === "scene-01")).toBe(true);
    expect(report.ok).toBe(false);
  });

  it("passes when the declared image file exists and is non-empty", async () => {
    const id = "image-present1";
    await ensureProject(id);
    const p = projectPaths(id);
    await mkdir(join(p.root, "assets"), { recursive: true });
    await writeFile(join(p.root, "assets", "a.png"), Buffer.from("\x89PNGdummy"));
    const locked = lockedNoAudio();
    locked.scenes[0]!.image = { ref: "assets/a.png" };
    const report = runBuildGridStatic(locked, id);
    expect(report.issues.filter((i) => i.check === "N9")).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("does not require an asset when no scene declares an image", async () => {
    const id = "image-none1234";
    await ensureProject(id);
    const report = runBuildGridStatic(lockedNoAudio(), id);
    expect(report.issues.filter((i) => i.check === "N9")).toEqual([]);
  });
});

describe("build grid — N10/N11 wrappers", () => {
  it("N10 produces an error only on failure", () => {
    expect(typecheckIssues(true, "")).toEqual([]);
    const issues = typecheckIssues(false, "TS1005");
    expect(issues[0]!.check).toBe("N10");
    expect(issues[0]!.severity).toBe("error");
  });

  it("N11 produces an error only on failure", () => {
    expect(bundleIssues(true, "")).toEqual([]);
    const issues = bundleIssues(false, "Module not found");
    expect(issues[0]!.check).toBe("N11");
    expect(issues[0]!.severity).toBe("error");
  });
});
