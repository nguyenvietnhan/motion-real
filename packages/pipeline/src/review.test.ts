import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LockedVideoSpec } from "@motionreal/schema";

/**
 * Review-loop gate tests. @remotion/bundler +
 * @remotion/renderer are mocked exactly like renderer.test.ts / cache.test.ts so
 * NO Chromium download or real render happens; the mocked renderStill writes a
 * tiny PNG so the keyframes exist on disk. The contact-sheet compositor is
 * injected (a fake that writes a small file) so ffmpeg is never required.
 * VIDEO_TOOL_HOME points at a temp dir so nothing touches the repo root.
 */

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
  buildReview,
  emptyReviewChecklist,
  reviewGatePassed,
  type ComposeContactSheet,
} from "./review.js";
import { projectPaths } from "./store/store.js";
import type { ReviewChecklist } from "./types.js";

let tempRoot: string;
let prevHome: string | undefined;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "news-review-"));
  prevHome = process.env.VIDEO_TOOL_HOME;
  process.env.VIDEO_TOOL_HOME = tempRoot;

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
  // Each renderStill writes a tiny PNG so the extracted keyframe exists on disk.
  mocks.renderStill.mockImplementation(async ({ output }) => {
    await writeFile(output, Buffer.from("png-bytes"));
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

function lockedSpec(): LockedVideoSpec {
  return {
    version: 1,
    title: "Review test",
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
        props: { badgeText: "Test", highlight: "Review" },
        startFrame: 0,
        durationInFrames: 90,
      },
      {
        id: "scene-02",
        component: "final-cta",
        durationInSeconds: 1,
        headline: "Kết",
        narration: "Một câu kết ngắn.",
        props: { ctaText: "Kết luận", subText: "Review ổn định" },
        startFrame: 90,
        durationInFrames: 30,
      },
    ],
    audio: {},
    captions: [],
  };
}

/** Fake compositor: writes a small file so contact.jpg exists without ffmpeg. */
function fakeCompositor(): ComposeContactSheet {
  return vi.fn(async ({ outPath }) => {
    await writeFile(outPath, Buffer.from("jpg-bytes"));
  });
}

describe("buildReview", () => {
  it("extracts one keyframe per scene at scene midpoints, builds contact.jpg, and writes review.json", async () => {
    const spec = lockedSpec();
    const compose = fakeCompositor();

    const artifacts = await buildReview(spec, {
      projectId: "demo-12345678",
      mp4Path: "renders/demo-12345678.mp4",
      checklist: FULL_CHECKLIST,
      composeContactSheet: compose,
    });

    const paths = projectPaths("demo-12345678");

    // (1) one still per scene, at the scene midpoints (clamped to last frame).
    expect(mocks.renderStill).toHaveBeenCalledTimes(2);
    expect(mocks.renderStill.mock.calls.map(([o]) => o.frame)).toEqual([45, 105]);
    expect(artifacts.keyframes).toEqual([
      join(paths.reviewDir, "scene-01.png"),
      join(paths.reviewDir, "scene-02.png"),
    ]);
    for (const k of artifacts.keyframes) expect(existsSync(k)).toBe(true);

    // (2) contact sheet was assembled through the injected compositor.
    expect(compose).toHaveBeenCalledTimes(1);
    expect(compose).toHaveBeenCalledWith(
      expect.objectContaining({ outPath: join(paths.reviewDir, "contact.jpg") }),
    );
    expect(existsSync(artifacts.contactSheetPath)).toBe(true);
    expect(artifacts.contactSheetPath).toBe(join(paths.reviewDir, "contact.jpg"));

    // (3) review.json captures project-relative paths + checklist + gate result.
    expect(artifacts.reviewJsonPath).toBe(join(paths.reviewDir, "review.json"));
    const review = JSON.parse(await readFile(artifacts.reviewJsonPath, "utf8"));
    expect(review).toMatchObject({
      projectId: "demo-12345678",
      mp4Path: "renders/demo-12345678.mp4",
      keyframes: ["review/scene-01.png", "review/scene-02.png"],
      contactSheet: "review/contact.jpg",
      checklist: FULL_CHECKLIST,
      gate: { check: "N25", passed: true, incomplete: [] },
      ok: true,
    });

    // (4) gate passed → report ok and the MP4 path is reported back.
    expect(artifacts.report.ok).toBe(true);
    expect(artifacts.report.ranTiers).toEqual(["review"]);
    expect(artifacts.report.issues).toEqual([]);
    expect(artifacts.mp4Path).toBe(join(paths.root, "renders", "demo-12345678.mp4"));

    // No real browser/render was used — only the mocks.
    expect(vi.isMockFunction(mocks.ensureBrowser)).toBe(true);
  });

  it("fires N24 (error) when the contact sheet is missing (compositor no-ops)", async () => {
    const spec = lockedSpec();
    const noop = vi.fn(); // writes nothing → contact.jpg never created

    const artifacts = await buildReview(spec, {
      projectId: "demo-noop",
      checklist: FULL_CHECKLIST, // isolate N24: checklist is complete
      composeContactSheet: noop,
    });

    expect(noop).toHaveBeenCalledTimes(1);
    expect(existsSync(artifacts.contactSheetPath)).toBe(false);
    expect(artifacts.report.ok).toBe(false);
    const n24 = artifacts.report.issues.filter((i) => i.check === "N24");
    expect(n24.length).toBeGreaterThan(0);
    expect(n24.every((i) => i.severity === "error")).toBe(true);
    expect(artifacts.report.issues.some((i) => i.check === "N25")).toBe(false);
    // Gate failed → MP4 path is NOT reported.
    expect(artifacts.mp4Path).toBeUndefined();
  });

  it("fires N24 (error) when keyframe extraction throws (fail-soft, no crash)", async () => {
    const spec = lockedSpec();
    const compose = fakeCompositor();

    const artifacts = await buildReview(spec, {
      projectId: "demo-throw",
      checklist: FULL_CHECKLIST,
      extractKeyframes: async () => {
        throw new Error("renderer exploded");
      },
      composeContactSheet: compose,
    });

    expect(compose).not.toHaveBeenCalled(); // no keyframes → no sheet attempt
    expect(artifacts.keyframes).toEqual([]);
    expect(artifacts.report.ok).toBe(false);
    const n24 = artifacts.report.issues.filter((i) => i.check === "N24");
    expect(n24.some((i) => /renderer exploded/.test(i.message))).toBe(true);
  });

  it("defaults to an all-false checklist so the gate stays closed (N25) until confirmed", async () => {
    const spec = lockedSpec();
    const compose = fakeCompositor();

    const artifacts = await buildReview(spec, {
      projectId: "demo-default-checklist",
      composeContactSheet: compose,
    });

    // Artifacts were built fine, but the checklist gate blocks "done".
    expect(existsSync(artifacts.contactSheetPath)).toBe(true);
    expect(artifacts.report.ok).toBe(false);
    expect(artifacts.checklist).toEqual(emptyReviewChecklist());
    const n25 = artifacts.report.issues.filter((i) => i.check === "N25");
    expect(n25).toHaveLength(8);
    expect(artifacts.mp4Path).toBeUndefined();
  });
});

describe("reviewGatePassed — N25 process gate", () => {
  it("passes only when every checklist item is confirmed", () => {
    const report = reviewGatePassed(FULL_CHECKLIST);
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
    expect(report.ranTiers).toEqual(["review"]);
  });

  it("fails with one N25 issue naming the incomplete item", () => {
    const report = reviewGatePassed({ ...FULL_CHECKLIST, hook: false });
    expect(report.ok).toBe(false);
    expect(report.issues).toHaveLength(1);
    const issue = report.issues[0]!;
    expect(issue.check).toBe("N25");
    expect(issue.severity).toBe("error");
    expect(issue.path).toBe("hook");
    expect(issue.message).toMatch(/hook/);
  });

  it("flags every incomplete item by name (non-vacuous)", () => {
    const report = reviewGatePassed({ ...FULL_CHECKLIST, safeArea: false, audio: false });
    expect(report.ok).toBe(false);
    expect(report.issues.map((i) => i.path).sort()).toEqual(["audio", "safeArea"]);
    expect(report.issues.every((i) => i.check === "N25" && i.severity === "error")).toBe(true);
  });

  it("an all-false checklist flags all eight items", () => {
    const report = reviewGatePassed(emptyReviewChecklist());
    expect(report.ok).toBe(false);
    expect(report.issues).toHaveLength(8);
  });
});
