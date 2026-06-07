import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { FPS, T_TRANSITION, secondsToFrames, type VideoSpec } from "@news/schema";
import { lockSpec } from "./lock.js";
import { getSfxCues, sfxAsset } from "./sfx.js";
import type { TtsManifest } from "../types.js";

/**
 * Property-based tests for the locker (design Properties 1 and 6) plus the SFX
 * mapping. These are renderer-independent and deterministic.
 */

function specWithSceneSeconds(seconds: number[]): VideoSpec {
  const scenes: VideoSpec["scenes"] = seconds.map((s, i) => ({
    id: `scene-${String(i + 1).padStart(2, "0")}`,
    component: i === 0 ? "hero-announcement" : i === seconds.length - 1 ? "final-cta" : "insight-stack",
    durationInSeconds: s,
    headline: `Cảnh ${i + 1}`,
    body: "Dòng phụ",
    narration: "Một câu tường thuật đủ dài để giữ nhịp cho cảnh này một cách tự nhiên và liền mạch.",
    props: {},
    sfx: i === 0 ? "transition" : i === seconds.length - 1 ? "success" : "none",
  }));
  const duration = 60;
  return {
    version: 1,
    title: "Lock test",
    styleId: "clean-luxury-tech",
    duration: duration as VideoSpec["duration"],
    ratio: "9:16",
    language: "vi",
    scenes,
  };
}

function manifestFor(spec: VideoSpec, durations: number[]): TtsManifest {
  const byScene: TtsManifest["byScene"] = {};
  spec.scenes.forEach((scene, i) => {
    byScene[scene.id] = {
      text: scene.narration,
      voiceId: "mock",
      speed: 1,
      audioPath: `audio/${scene.id}.wav`,
      duration: durations[i]!,
      source: "mock",
    };
  });
  return { updatedAt: "t", voiceId: "mock", speed: 1, byScene, mixedSrc: "audio/narration.mixed.wav" };
}

describe("lockSpec — Property 1: transition-aware timeline (R5)", () => {
  it("video frames == assembled audio frames; scenes overlap by exactly T with no gaps", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 1, max: 20, noNaN: true }), { minLength: 1, maxLength: 12 }),
        (durations) => {
          const spec = specWithSceneSeconds(durations.map(() => 5));
          const manifest = manifestFor(spec, durations);
          const locked = lockSpec(spec, manifest);

          const n = locked.scenes.length;
          const T = n > 1 ? T_TRANSITION : 0;
          const speech = durations.map((d) => Math.max(1, secondsToFrames(d)));
          const expectedTotal = speech.reduce((a, b) => a + b, 0) + (n - 1) * T;

          // Total video frames equal the assembled audio length.
          expect(locked.durationInFrames).toBe(expectedTotal);

          // First scene starts at 0; adjacent scenes overlap by exactly T (no gaps).
          expect(locked.scenes[0]!.startFrame).toBe(0);
          for (let i = 1; i < n; i += 1) {
            const prev = locked.scenes[i - 1]!;
            const cur = locked.scenes[i]!;
            const overlap = prev.startFrame + prev.durationInFrames - cur.startFrame;
            expect(overlap).toBe(T);
          }
          const last = locked.scenes.at(-1)!;
          expect(last.startFrame + last.durationInFrames).toBe(expectedTotal);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("falls back to scene target seconds when no manifest is given", () => {
    const spec = specWithSceneSeconds([5, 5, 5, 5]);
    const locked = lockSpec(spec, null);
    const speech = spec.scenes.map((sc) => secondsToFrames(sc.durationInSeconds));
    const expected = speech.reduce((a, b) => a + b, 0) + (spec.scenes.length - 1) * T_TRANSITION;
    expect(locked.durationInFrames).toBe(expected);
  });
});

describe("secondsToFrames — Property 6: duration monotonicity", () => {
  it("is >= 1 for positive seconds and non-decreasing in seconds", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 60, noNaN: true }),
        fc.double({ min: 0.01, max: 60, noNaN: true }),
        (a, b) => {
          expect(secondsToFrames(a)).toBeGreaterThanOrEqual(1);
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          expect(secondsToFrames(hi)).toBeGreaterThanOrEqual(secondsToFrames(lo));
        },
      ),
      { numRuns: 200 },
    );
  });

  it("uses the configured FPS", () => {
    expect(secondsToFrames(2, FPS)).toBe(2 * FPS);
  });
});

describe("sfx mapping", () => {
  it("maps tags to assets and treats none/undefined as no cue", () => {
    expect(sfxAsset("transition")?.asset).toBe("swoosh");
    expect(sfxAsset("alert")?.asset).toBe("thud");
    expect(sfxAsset("emphasis")?.asset).toBe("ting");
    expect(sfxAsset("success")?.asset).toBe("success");
    expect(sfxAsset("none")).toBeNull();
    expect(sfxAsset(undefined)).toBeNull();
  });

  it("places transition at scene start and success before scene end", () => {
    const spec = specWithSceneSeconds([5, 5, 5, 5]);
    const locked = lockSpec(spec, manifestFor(spec, [5, 5, 5, 5]));
    const cues = getSfxCues(locked);
    const first = cues.find((c) => c.sceneId === "scene-01");
    const last = cues.find((c) => c.sceneId === "scene-04");
    expect(first?.atFrame).toBe(0);
    // success cue sits before the final scene's end, never before its start
    const finalScene = locked.scenes.at(-1)!;
    expect(last!.atFrame).toBeGreaterThanOrEqual(finalScene.startFrame);
    expect(last!.atFrame).toBeLessThan(finalScene.startFrame + finalScene.durationInFrames);
  });
});
