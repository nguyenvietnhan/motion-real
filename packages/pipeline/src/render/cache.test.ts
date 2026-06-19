import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LockedVideoSpec } from "@news/schema";

/**
 * Caching + determinism tests (Requirements 7.2, 7.4, 7.5; design Properties
 * P2 and P4). The determinism test mocks @remotion/bundler + @remotion/renderer
 * exactly like renderer.test.ts so it never downloads Chromium or does a real
 * render — the mocked renderStill writes controllable bytes so we can simulate
 * an identical (deterministic) vs differing (non-deterministic) frame.
 */

let stillCallCount = 0;
let differingBytes = false;

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

import { specHash, renderCacheKey, stableStringify } from "./cache.js";
import { checkDeterminism, sampleFrame } from "./determinism.js";
import { lintSceneSources, compositionsSrcDir, blocksSrcDir } from "../safety/forbidden-api.js";

beforeEach(() => {
  stillCallCount = 0;
  differingBytes = false;
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
  // Each renderStill writes bytes to its output. When `differingBytes` is set,
  // the two renders of the same frame disagree (simulating hidden randomness).
  mocks.renderStill.mockImplementation(async ({ output }) => {
    const call = stillCallCount++;
    const bytes = differingBytes ? Buffer.from(`frame-bytes-${call}`) : Buffer.from("identical-frame-bytes");
    await writeFile(output, bytes);
    return { buffer: null, contentType: "image/png" };
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

// --- fixtures -------------------------------------------------------------

type SceneParams = {
  component: string;
  durationInFrames: number;
  headline: string;
  narration: string;
  audioSrc: string;
  prop: string;
};

function buildLocked(scenes: SceneParams[], opts: { title?: string } = {}): LockedVideoSpec {
  let startFrame = 0;
  const built = scenes.map((scene, index) => {
    const locked = {
      id: `scene-${String(index + 1).padStart(2, "0")}`,
      component: scene.component,
      durationInSeconds: Math.max(1, scene.durationInFrames / 30),
      headline: scene.headline,
      narration: scene.narration,
      props: { k: scene.prop } as Record<string, unknown>,
      startFrame,
      durationInFrames: scene.durationInFrames,
      audio: { src: scene.audioSrc, duration: scene.durationInFrames / 30 },
    };
    startFrame += scene.durationInFrames;
    return locked;
  });
  return {
    version: 1,
    title: opts.title ?? "Hash test",
    styleId: "clean-luxury-tech",
    format: "tiktok",
    duration: 60,
    ratio: "9:16",
    language: "vi",
    fps: 30,
    durationInFrames: startFrame,
    scenes: built,
    audio: { narrationSrc: "audio/narration.mixed.wav" },
    captions: [],
  };
}

function lockedSpec(): LockedVideoSpec {
  return buildLocked([
    {
      component: "hero-announcement",
      durationInFrames: 90,
      headline: "Mở đầu",
      narration: "Một câu đọc thử cho cảnh mở đầu.",
      audioSrc: "audio/scene-01.mp3",
      prop: "a",
    },
    {
      component: "final-cta",
      durationInFrames: 30,
      headline: "Kết",
      narration: "Một câu kết ngắn.",
      audioSrc: "audio/scene-02.mp3",
      prop: "b",
    },
  ]);
}

/** Rebuild an equal object with keys inserted in reverse order (to prove the hash ignores key order). */
function reorderKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reorderKeysDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>).reverse()) {
      out[key] = reorderKeysDeep(val);
    }
    return out;
  }
  return value;
}

const arbSceneParams: fc.Arbitrary<SceneParams> = fc.record({
  component: fc.constantFrom("hero-announcement", "insight-stack", "final-cta", "price-spotlight"),
  durationInFrames: fc.integer({ min: 1, max: 600 }),
  headline: fc.string({ minLength: 1, maxLength: 40 }),
  narration: fc.string({ minLength: 1, maxLength: 60 }),
  audioSrc: fc.string({ minLength: 1, maxLength: 40 }),
  prop: fc.string({ maxLength: 20 }),
});

function mutate(scene: SceneParams, kind: string): SceneParams {
  switch (kind) {
    case "component":
      return { ...scene, component: scene.component === "final-cta" ? "hero-announcement" : "final-cta" };
    case "durationInFrames":
      return { ...scene, durationInFrames: scene.durationInFrames + 1 };
    case "headline":
      return { ...scene, headline: `${scene.headline}X` };
    case "narration":
      return { ...scene, narration: `${scene.narration}X` };
    case "audioSrc":
      return { ...scene, audioSrc: `${scene.audioSrc}X` };
    default:
      return { ...scene, prop: `${scene.prop}X` };
  }
}

// --- specHash: Property 4 (cache coherence) -------------------------------

describe("specHash — Property 4: cache coherence", () => {
  it("is stable for identical inputs and invariant to object key ordering", () => {
    fc.assert(
      fc.property(fc.array(arbSceneParams, { minLength: 1, maxLength: 6 }), (scenes) => {
        const a = buildLocked(scenes);
        const b = buildLocked(scenes.map((s) => ({ ...s })));
        expect(specHash(a)).toBe(specHash(b));

        const reordered = reorderKeysDeep(a) as LockedVideoSpec;
        expect(specHash(reordered)).toBe(specHash(a));
      }),
      { numRuns: 200 },
    );
  });

  it("changing any frame-affecting scene field changes the hash", () => {
    fc.assert(
      fc.property(
        fc.array(arbSceneParams, { minLength: 1, maxLength: 6 }),
        fc.nat(),
        fc.constantFrom("component", "durationInFrames", "headline", "narration", "audioSrc", "prop"),
        (scenes, pick, kind) => {
          const index = pick % scenes.length;
          const base = buildLocked(scenes);
          const variant = buildLocked(scenes.map((s, i) => (i === index ? mutate(s, kind) : { ...s })));
          expect(specHash(variant)).not.toBe(specHash(base));
        },
      ),
      { numRuns: 300 },
    );
  });

  it("changing the scene count changes the hash", () => {
    fc.assert(
      fc.property(fc.array(arbSceneParams, { minLength: 1, maxLength: 6 }), arbSceneParams, (scenes, extra) => {
        const base = buildLocked(scenes);
        const longer = buildLocked([...scenes.map((s) => ({ ...s })), extra]);
        expect(specHash(longer)).not.toBe(specHash(base));
      }),
      { numRuns: 200 },
    );
  });

  it("stableStringify sorts keys so reordered inputs serialize identically", () => {
    const a = lockedSpec();
    const reordered = reorderKeysDeep(a);
    // Naive stringify differs (key order flipped), canonical stringify does not.
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(a));
    expect(stableStringify(reordered)).toBe(stableStringify(a));
  });
});

// --- Requirement 7.5: narration change → audio path change → hash change --

describe("specHash — Requirement 7.5: narration invalidates the render cache", () => {
  it("changing a scene's audio.src changes the hash", () => {
    const base = lockedSpec();
    const changed = buildLocked([
      {
        component: "hero-announcement",
        durationInFrames: 90,
        headline: "Mở đầu",
        narration: "Một câu đọc thử cho cảnh mở đầu.",
        audioSrc: "audio/scene-01-DIFFERENT.mp3",
        prop: "a",
      },
      {
        component: "final-cta",
        durationInFrames: 30,
        headline: "Kết",
        narration: "Một câu kết ngắn.",
        audioSrc: "audio/scene-02.mp3",
        prop: "b",
      },
    ]);
    expect(specHash(changed)).not.toBe(specHash(base));
  });

  it("changing narration text (and thus its derived audio path) changes the hash", () => {
    const scenes: SceneParams[] = [
      {
        component: "hero-announcement",
        durationInFrames: 90,
        headline: "Mở đầu",
        narration: "Bản tin gốc.",
        audioSrc: "audio/aaaa.mp3",
        prop: "a",
      },
    ];
    const base = buildLocked(scenes);
    // New narration → TTS keys a new clip path → both fields differ.
    const edited = buildLocked([{ ...scenes[0]!, narration: "Bản tin đã sửa.", audioSrc: "audio/bbbb.mp3" }]);
    expect(specHash(edited)).not.toBe(specHash(base));
  });
});

// --- renderCacheKey: authored source invalidates the render cache ---------

describe("renderCacheKey — authored source is part of the full render key", () => {
  const locked = buildLocked([
    { component: "hero", durationInFrames: 90, headline: "H", narration: "N", audioSrc: "audio/a.mp3", prop: "a" },
  ]);

  it("with no authored sources reduces to specHash (back-compat)", () => {
    expect(renderCacheKey(locked, [])).toBe(specHash(locked));
    expect(renderCacheKey(locked)).toBe(specHash(locked));
  });

  it("changing authored source (same spec) changes the key — a visual edit busts the cache", () => {
    const before = renderCacheKey(locked, ["const Scene = () => <rect width={10} />;"]);
    const after = renderCacheKey(locked, ["const Scene = () => <rect width={20} />;"]);
    expect(after).not.toBe(before);
    // And it differs from the bare spec hash, so a stale MP4 is never reused.
    expect(before).not.toBe(specHash(locked));
  });

  it("is invariant to authored file ordering (content-addressed, sorted)", () => {
    const a = renderCacheKey(locked, ["sourceA", "sourceB"]);
    const b = renderCacheKey(locked, ["sourceB", "sourceA"]);
    expect(a).toBe(b);
  });
});

// --- Determinism guard: Property 2 / N16 ----------------------------------

describe("checkDeterminism — Property 2 / N16", () => {
  it("samples the midpoint of the first scene", () => {
    expect(sampleFrame(lockedSpec())).toBe(45);
  });

  it("passes when the sampled frame renders byte-identical twice", async () => {
    differingBytes = false;
    // The locked spec carries a local narration path, so the guard wants a
    // project/public root (just as the orchestrator supplies one); rendering is
    // mocked so the dir is never actually read.
    const report = await checkDeterminism(lockedSpec(), { projectRoot: tmpdir() });

    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
    expect(report.ranTiers).toEqual(["render"]);
    expect(mocks.renderStill).toHaveBeenCalledTimes(2);
    expect(mocks.renderStill.mock.calls.map(([options]) => options.frame)).toEqual([45, 45]);
    // No real browser/render was triggered — only the mocks.
    expect(vi.isMockFunction(mocks.ensureBrowser)).toBe(true);
  });

  it("fails N16 when the same frame renders different bytes", async () => {
    differingBytes = true;
    const report = await checkDeterminism(lockedSpec(), { projectRoot: tmpdir() });

    expect(report.ok).toBe(false);
    expect(report.issues.some((issue) => issue.check === "N16" && issue.severity === "error")).toBe(true);
  });
});

// --- Forbidden-API lint (N5) ----------------------------------------------

describe("lintSceneSources — N5 forbidden-API guard", () => {
  it("passes on the real registered compositions sources", () => {
    const report = lintSceneSources();
    if (!report.ok) {
      // Surface any unexpected violations for debugging.

      console.error(report.issues);
    }
    expect(report.ok).toBe(true);
    expect(report.ranTiers).toEqual(["lint"]);
    expect(compositionsSrcDir().endsWith(join("packages", "compositions", "src"))).toBe(true);
  });

  it("passes on the @news/blocks sources (R2.3 deterministic blocks)", () => {
    const report = lintSceneSources(blocksSrcDir());
    if (!report.ok) {
      console.error(report.issues);
    }
    expect(report.ok).toBe(true);
    expect(blocksSrcDir().endsWith(join("packages", "blocks", "src"))).toBe(true);
  });

  it("fires N5 on a fixture containing Math.random(), but not on a clean sibling", async () => {
    const dir = await mkdtemp(join(tmpdir(), "news-lint-"));
    try {
      await writeFile(join(dir, "clean.tsx"), "export const seed = 7;\nexport const ok = Math.abs(-1);\n");
      await writeFile(join(dir, "evil.tsx"), "export const jitter = () => Math.random() * 10;\n");

      const report = lintSceneSources(dir);

      expect(report.ok).toBe(false);
      const violations = report.issues.filter((issue) => issue.check === "N5");
      expect(violations).toHaveLength(1);
      expect(violations[0]!.path).toMatch(/^evil\.tsx:1$/);
      expect(violations[0]!.message).toMatch(/Math\.random/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("detects each banned construct class", async () => {
    const dir = await mkdtemp(join(tmpdir(), "news-lint-"));
    try {
      await writeFile(
        join(dir, "scene.tsx"),
        [
          "const a = Date.now();",
          "const b = new Date();",
          "fetch('https://x');",
          "const r = require('x');",
          "const d = import('x');",
          "import fs from 'node:fs';",
          "import cp from 'child_process';",
          "const e = process.env.HOME;",
          "eval('1');",
          "const f = Function('return 1');",
          "const x = <div dangerouslySetInnerHTML={{ __html: '' }} />;",
        ].join("\n"),
      );
      const report = lintSceneSources(dir);
      const tokens = new Set(report.issues.map((issue) => issue.message.match(/"([^"]+)"/)?.[1]));
      expect(tokens).toEqual(
        new Set([
          "Date.now",
          "new Date(",
          "fetch(",
          "require(",
          "import(",
          "fs module",
          "child_process module",
          "process.",
          "eval(",
          "Function(",
          "dangerouslySetInnerHTML",
        ]),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
