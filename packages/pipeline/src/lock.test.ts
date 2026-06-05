import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { FPS, secondsToFrames, type VideoSpec } from "@news/schema";
import { lockSpec } from "./lock.js";
import { getSfxCues, sfxAsset } from "./sfx.js";
import type { TtsManifest } from "./types.js";

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

describe("lockSpec — Property 1: timeline contiguity", () => {
  it("tiles [0, durationInFrames) with no gaps or overlaps for any measured durations", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 1, max: 20, noNaN: true }), { minLength: 3, maxLength: 12 }),
        (durations) => {
          const spec = specWithSceneSeconds(durations.map(() => 5));
          const manifest = manifestFor(spec, durations);
          const locked = lockSpec(spec, manifest);

          let cursor = 0;
          for (const scene of locked.scenes) {
            expect(scene.startFrame).toBe(cursor);
            expect(scene.durationInFrames).toBeGreaterThanOrEqual(1);
            cursor += scene.durationInFrames;
          }
          expect(cursor).toBe(locked.durationInFrames);
          expect(locked.scenes.at(-1)!.startFrame + locked.scenes.at(-1)!.durationInFrames).toBe(
            locked.durationInFrames,
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  it("falls back to planner seconds when no manifest is given", () => {
    const spec = specWithSceneSeconds([5, 5, 5, 5]);
    const locked = lockSpec(spec, null);
    expect(locked.durationInFrames).toBe(spec.scenes.reduce((s, sc) => s + secondsToFrames(sc.durationInSeconds), 0));
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
