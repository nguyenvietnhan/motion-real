import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { FPS, T_TRANSITION, secondsToFrames, type VideoSpec } from "@motionreal/schema";
import { lockSpec } from "./lock.js";
import type { TtsManifest } from "../types.js";

/**
 * Property-based tests for the locker (design Properties 1 and 6).
 * Renderer-independent and deterministic.
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
  }));
  const duration = 60;
  return {
    version: 1,
    title: "Lock test",
    format: "tiktok",
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
  return { updatedAt: "t", provider: "mock", voiceId: "mock", speed: 1, byScene, mixedSrc: "audio/narration.mixed.wav" };
}

describe("lockSpec — Property 1: transition-aware timeline", () => {
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

describe("lockSpec — narration motion cues", () => {
  const narration = "Đầu tiên nhận yêu cầu rồi sau đó xử lý dữ liệu và cuối cùng trả kết quả.";
  const beats = [
    { id: "receive", anchor: "nhận yêu cầu", action: "Reveal input" },
    { id: "process", anchor: "xử lý dữ liệu", action: "Reveal processing" },
    { id: "return", anchor: "trả kết quả", action: "Reveal output" },
  ];

  function motionSpec(sceneCount = 1): VideoSpec {
    return {
      version: 1,
      title: "Motion cues",
      format: "tiktok",
      language: "vi",
      scenes: Array.from({ length: sceneCount }, (_, index) => ({
        id: `scene-${String(index + 1).padStart(2, "0")}`,
        component: `motion-${index + 1}`,
        durationInSeconds: 6,
        headline: "Motion",
        narration,
        motionBeats: beats,
        props: {},
      })),
    };
  }

  it("creates deterministic increasing cues for no-TTS still locks without captions", () => {
    const first = lockSpec(motionSpec(), null);
    const second = lockSpec(motionSpec(), null);
    expect(first.scenes[0]!.motionCueFrames).toEqual(second.scenes[0]!.motionCueFrames);
    const cues = first.scenes[0]!.motionCueFrames!;
    expect(cues.receive).toBeLessThan(cues.process!);
    expect(cues.process).toBeLessThan(cues.return!);
    expect(first.captions).toEqual([]);
  });

  it("uses SRT timing and includes the head transition in scene-local cues", () => {
    const spec = motionSpec(2);
    const manifest = manifestFor(spec, [6, 6]);
    manifest.byScene["scene-02"]!.srt = [
      { startSec: 1, endSec: 2, text: "đầu tiên nhận yêu cầu" },
      { startSec: 3, endSec: 4, text: "xử lý dữ liệu" },
      { startSec: 5, endSec: 6, text: "trả kết quả" },
    ];
    const locked = lockSpec(spec, manifest);
    const second = locked.scenes[1]!;
    expect(second.motionCueFrames?.receive).toBeGreaterThanOrEqual(T_TRANSITION + FPS);
    expect(second.motionCueFrames?.return).toBeLessThan(second.durationInFrames);
  });

  it("recomputes cues for fps and duration changes", () => {
    const at30 = lockSpec(motionSpec(), null, { fps: 30 });
    const longer = motionSpec();
    longer.scenes[0]!.durationInSeconds = 10;
    const at60 = lockSpec(longer, null, { fps: 60 });
    expect(at60.scenes[0]!.motionCueFrames?.process).toBeGreaterThan(at30.scenes[0]!.motionCueFrames?.process ?? 0);
  });

  it("drops every cue for one scene when narration edits make an anchor stale", () => {
    const spec = motionSpec(2);
    spec.scenes[1]!.narration = "Nội dung đã được người dùng sửa và không còn cụm neo cũ.";
    const locked = lockSpec(spec, null);
    expect(locked.scenes[0]!.motionCueFrames).toBeDefined();
    expect(locked.scenes[1]!.motionCueFrames).toBeUndefined();
  });
});
