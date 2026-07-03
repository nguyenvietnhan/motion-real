import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { FPS, T_TRANSITION, type VideoSpec } from "@motionreal/schema";
import { parseSrt, segmentToLines, buildSceneCaptionCues, MAX_CAPTION_LINE_CHARS } from "./captions.js";
import { lockSpec } from "./lock.js";
import type { TtsManifest } from "../types.js";

describe("parseSrt", () => {
  it("parses standard SRT blocks (comma or dot ms, CRLF tolerant)", () => {
    const srt = [
      "1",
      "00:00:00,000 --> 00:00:01,500",
      "Dòng một",
      "",
      "2",
      "00:00:01,500 --> 00:00:03,000",
      "Dòng hai phần A",
      "Dòng hai phần B",
      "",
    ].join("\r\n");
    const segs = parseSrt(srt);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toEqual({ startSec: 0, endSec: 1.5, text: "Dòng một" });
    expect(segs[1]!.startSec).toBe(1.5);
    expect(segs[1]!.endSec).toBe(3);
    expect(segs[1]!.text).toBe("Dòng hai phần A Dòng hai phần B");
  });

  it("ignores malformed blocks", () => {
    expect(parseSrt("garbage\nno timestamps here")).toEqual([]);
  });
});

describe("segmentToLines", () => {
  it("never exceeds maxChars (except an unbreakable single word) and drops empties", () => {
    fc.assert(
      fc.property(fc.array(fc.string({ minLength: 1, maxLength: 12 }), { minLength: 0, maxLength: 40 }), (words) => {
        const text = words.join(" ");
        const lines = segmentToLines(text, MAX_CAPTION_LINE_CHARS);
        for (const line of lines) {
          expect(line.length).toBeGreaterThan(0);
          const isSingleWord = !line.includes(" ");
          if (!isSingleWord) expect(line.length).toBeLessThanOrEqual(MAX_CAPTION_LINE_CHARS);
        }
        // No content is lost.
        expect(lines.join(" ").split(/\s+/).filter(Boolean)).toEqual(text.split(/\s+/).filter(Boolean));
      }),
      { numRuns: 100 },
    );
  });

  it("splits a long sentence into multiple single lines", () => {
    const text = "Đây là một câu tường thuật khá dài cần được chia thành nhiều dòng phụ đề ngắn gọn dễ đọc";
    const lines = segmentToLines(text, 30);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(30);
  });
});

describe("buildSceneCaptionCues", () => {
  it("even-split fallback: contiguous cues inside the scene, one active per frame", () => {
    const cues = buildSceneCaptionCues({
      sceneId: "scene-01",
      narration: "Một hai ba bốn năm sáu bảy tám chín mười mười một mười hai mười ba mười bốn",
      audioStartFrame: 100,
      speechFrames: 300,
      fps: FPS,
      totalFrames: 100000,
    });
    expect(cues.length).toBeGreaterThan(0);
    for (const c of cues) {
      expect(c.endFrame).toBeGreaterThan(c.startFrame);
      expect(c.startFrame).toBeGreaterThanOrEqual(100);
      expect(c.endFrame).toBeLessThanOrEqual(400);
      expect(c.sceneId).toBe("scene-01");
    }
    // Non-overlapping + sorted.
    for (let i = 1; i < cues.length; i += 1) {
      expect(cues[i]!.startFrame).toBeGreaterThanOrEqual(cues[i - 1]!.endFrame);
    }
  });

  it("uses SRT timing but keeps the clean narration text (never the phonetic transcript)", () => {
    const cues = buildSceneCaptionCues({
      sceneId: "scene-02",
      narration: "Google ký thỏa thuận",
      srt: [
        // ASR transcript is phonetic ("gút gồ" for Google) — must NOT leak into captions.
        { startSec: 0, endSec: 1, text: "gút gồ" },
        { startSec: 1, endSec: 2, text: "ký thoả" },
      ],
      audioStartFrame: 0,
      speechFrames: 60,
      fps: FPS,
      totalFrames: 100000,
    });
    const words = cues.flatMap((c) => c.words ?? []);
    // Caption words are the CLEAN narration, timed by the SRT spans.
    expect(words.map((w) => w.text)).toEqual(["Google", "ký", "thỏa", "thuận"]);
    // No phonetic transcript text leaks through.
    expect(words.some((w) => /gút|gồ/.test(w.text))).toBe(false);
    expect(words[0]!.startFrame).toBe(0);
    // The 2 SRT segments carry equal word weight, so the 2nd half of the
    // narration ("thỏa") is timed into the second segment (≈ 1s = 30 frames in).
    const thoa = words.find((w) => w.text === "thỏa")!;
    expect(thoa.startFrame).toBeGreaterThanOrEqual(28);
    // Every word is inside its cue and word intervals are ordered + non-overlapping.
    for (const c of cues) {
      for (const w of c.words ?? []) {
        expect(w.startFrame).toBeGreaterThanOrEqual(c.startFrame);
        expect(w.endFrame).toBeLessThanOrEqual(c.endFrame);
        expect(w.endFrame).toBeGreaterThan(w.startFrame);
      }
    }
    for (let i = 1; i < words.length; i += 1) {
      expect(words[i]!.startFrame).toBeGreaterThanOrEqual(words[i - 1]!.startFrame);
    }
  });
});

// --- P7: deterministic, non-overlapping caption cues baked into the lock -----

function specWithScenes(n: number): VideoSpec {
  const scenes: VideoSpec["scenes"] = Array.from({ length: n }, (_, i) => ({
    id: `scene-${String(i + 1).padStart(2, "0")}`,
    component: i === 0 ? "hero-announcement" : i === n - 1 ? "final-cta" : "insight-stack",
    durationInSeconds: 5,
    headline: `Cảnh ${i + 1}`,
    narration: "Một câu tường thuật đủ dài để có vài dòng phụ đề ngắn cho cảnh này một cách tự nhiên.",
    props: {},
  }));
  return { version: 1, title: "Caption lock test", styleId: "clean-luxury-tech", format: "tiktok", ratio: "9:16", language: "vi", scenes };
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

describe("lockSpec — Property 7: baked caption cues", () => {
  it("cues are sorted, non-overlapping, in-bounds, and at most one is active per frame", () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: 2, max: 15, noNaN: true }), { minLength: 1, maxLength: 8 }), (durations) => {
        const spec = specWithScenes(durations.length);
        const locked = lockSpec(spec, manifestFor(spec, durations), { mixedNarrationSrc: "audio/n.wav" });
        const cues = locked.captions;

        for (const c of cues) {
          expect(c.startFrame).toBeGreaterThanOrEqual(0);
          expect(c.endFrame).toBeGreaterThan(c.startFrame);
          expect(c.endFrame).toBeLessThanOrEqual(locked.durationInFrames);
        }
        // Globally sorted + non-overlapping ⇒ at most one active cue per frame.
        for (let i = 1; i < cues.length; i += 1) {
          expect(cues[i]!.startFrame).toBeGreaterThanOrEqual(cues[i - 1]!.endFrame);
        }
        void T_TRANSITION;
      }),
      { numRuns: 150 },
    );
  });
});
