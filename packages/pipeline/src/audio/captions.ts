import { type CaptionCue } from "@motionreal/schema";

/**
 * Caption pipeline. Pure + deterministic: turn a scene's
 * narration (+ optional TTS SRT timing) into word-paged caption cues, then the
 * lock offsets them onto the composition timeline. No fs / no network here — the
 * TTS layer parses the SRT file and hands us the parsed segments.
 *
 * Caption TEXT is always the clean narration (brand names intact); the SRT is
 * used only for TIMING, never its (possibly phonetic) transcript text, so a word
 * like "Google" is never shown as "gút gồ".
 *
 * Each cue is a single caption line that fits the caption band width, carrying
 * per-word timing so the renderer can highlight the active word (karaoke). Long
 * narration is split into sequential one-line pages; there is no per-character
 * animation and captions are never authored per scene.
 */

/** A raw SRT segment (intra-scene, relative to the scene's speech clip). */
export type SrtSegment = { startSec: number; endSec: number; text: string };

/** Max characters on a single caption line (sized for the caption band width). */
export const MAX_CAPTION_LINE_CHARS = 22;

/** Parse an SRT document into ordered segments. Tolerant of CRLF and blank lines. */
export function parseSrt(srt: string): SrtSegment[] {
  const segments: SrtSegment[] = [];
  const blocks = srt.replace(/\r\n/g, "\n").split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    const timeLine = lines.find((l) => l.includes("-->"));
    if (!timeLine) continue;
    const match = timeLine.match(
      /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/,
    );
    if (!match) continue;
    const startSec = hmsToSec(match[1]!, match[2]!, match[3]!, match[4]!);
    const endSec = hmsToSec(match[5]!, match[6]!, match[7]!, match[8]!);
    const textLines = lines.filter((l) => l !== timeLine && !/^\d+$/.test(l));
    const text = textLines.join(" ").trim();
    if (text && endSec > startSec) segments.push({ startSec, endSec, text });
  }
  return segments;
}

function hmsToSec(h: string, m: string, s: string, ms: string): number {
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
}

/**
 * Split a block of text into single lines that each fit `maxChars`. Splits on
 * word boundaries; a single over-long word is kept whole (the N17/N29 oracle
 * would flag it). Never produces an empty line.
 */
export function segmentToLines(text: string, maxChars = MAX_CAPTION_LINE_CHARS): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current === "") {
      current = word;
    } else if ((current + " " + word).length <= maxChars) {
      current += " " + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export type SceneCaptionInput = {
  sceneId: string;
  narration: string;
  /** Parsed SRT segments for this scene's clip (relative seconds), if available. */
  srt?: SrtSegment[];
  /** Absolute composition frame where this scene's SPEECH begins. */
  audioStartFrame: number;
  /** This scene's speech length in frames (excludes breath gap / transitions). */
  speechFrames: number;
  fps: number;
  /** Hard cap so a cue never runs past the video. */
  totalFrames: number;
  maxLineChars?: number;
};

/** Max words shown together on one karaoke line (a "page"). */
export const MAX_CAPTION_PAGE_WORDS = 5;

type WordTiming = { text: string; startRel: number; endRel: number };

/**
 * Tile a text span across [startRel, endRel) in relative frames, giving each
 * word a sub-interval proportional to its character length. Deterministic.
 */
function wordsFromSpan(text: string, startRel: number, endRel: number): WordTiming[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const span = Math.max(1, endRel - startRel);
  const totalChars = words.reduce((n, w) => n + w.length, 0) || 1;
  const out: WordTiming[] = [];
  let acc = 0;
  for (const w of words) {
    const startFrac = acc / totalChars;
    acc += w.length;
    const endFrac = acc / totalChars;
    const s = Math.round(startRel + span * startFrac);
    const e = Math.max(s + 1, Math.round(startRel + span * endFrac));
    out.push({ text: w, startRel: s, endRel: e });
  }
  return out;
}

/** Group sequential words into single-line "pages" that fit the band width. */
function pageWords(words: WordTiming[], maxChars: number): WordTiming[][] {
  const pages: WordTiming[][] = [];
  let cur: WordTiming[] = [];
  let curLen = 0;
  for (const w of words) {
    const addLen = (cur.length === 0 ? 0 : 1) + w.text.length;
    if (cur.length > 0 && (curLen + addLen > maxChars || cur.length >= MAX_CAPTION_PAGE_WORDS)) {
      pages.push(cur);
      cur = [];
      curLen = 0;
    }
    cur.push(w);
    curLen += cur.length === 1 ? w.text.length : addLen;
  }
  if (cur.length > 0) pages.push(cur);
  return pages;
}

/**
 * Re-time the clean NARRATION words onto the SRT segment time spans. The Vivibe
 * SRT is an ASR transcript of the synthesized audio, so its TEXT can be phonetic
 * ("Google" → "gút gồ", "NVIDIA" → "nvidia"). We want the caption TEXT to be the
 * clean narration but keep the SRT's TIMING. Narration words are allocated to
 * each segment in proportion to that segment's share of spoken words, then tiled
 * within the segment's [start,end). Deterministic; total words preserved.
 */
function narrationWordsOnSrtTiming(narration: string, srt: SrtSegment[], fps: number): WordTiming[] {
  const words = narration.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || srt.length === 0) return [];
  const segWordCounts = srt.map((s) => Math.max(1, s.text.trim().split(/\s+/).filter(Boolean).length));
  const totalSegWords = segWordCounts.reduce((a, b) => a + b, 0);
  // Allocate narration words ∝ each segment's share of SRT words (floor), then
  // hand out the remainder left-to-right so every narration word is placed.
  const alloc = segWordCounts.map((c) => Math.floor((words.length * c) / totalSegWords));
  let assigned = alloc.reduce((a, b) => a + b, 0);
  for (let i = 0; assigned < words.length; i += 1, assigned += 1) alloc[i % alloc.length]! += 1;

  const out: WordTiming[] = [];
  let cursor = 0;
  srt.forEach((seg, idx) => {
    const take = alloc[idx]!;
    if (take <= 0) return;
    const slice = words.slice(cursor, cursor + take);
    cursor += take;
    const segStartRel = Math.max(0, Math.round(seg.startSec * fps));
    const segEndRel = Math.max(segStartRel + 1, Math.round(seg.endSec * fps));
    out.push(...wordsFromSpan(slice.join(" "), segStartRel, segEndRel));
  });
  return out;
}

/**
 * Build absolute, single-line KARAOKE caption cues for one scene. Each cue is a
 * "page" of a few words sized to fit the caption band; every word carries its
 * own [startFrame, endFrame) (approximate, from SRT timing or an even split) so
 * the renderer can highlight the word currently being spoken. Cues are
 * contiguous within the scene (no mid-speech blank), sorted, non-overlapping,
 * and clamped to the video length.
 *
 * Caption TEXT is always the clean `narration` (Vietnamese, brand names intact);
 * when an SRT is present we borrow only its TIMING, never its (possibly
 * phonetic) transcript text.
 */
export function buildSceneCaptionCues(input: SceneCaptionInput): CaptionCue[] {
  const maxChars = input.maxLineChars ?? MAX_CAPTION_LINE_CHARS;
  const sceneEnd = Math.min(input.totalFrames, input.audioStartFrame + input.speechFrames);
  if (sceneEnd <= input.audioStartFrame) return [];

  // 1) Word-level timings in RELATIVE frames [0, speechFrames). Use the clean
  // narration words, timed by the SRT spans when available, else even-split.
  let words: WordTiming[] = [];
  if (input.srt && input.srt.length > 0) {
    words = narrationWordsOnSrtTiming(input.narration, input.srt, input.fps);
  }
  if (words.length === 0) {
    words = wordsFromSpan(input.narration, 0, input.speechFrames);
  }
  if (words.length === 0) return [];

  // 2) Group into single-line pages.
  const pages = pageWords(words, maxChars);
  if (pages.length === 0) return [];

  // 3) Emit contiguous, non-overlapping absolute cues with per-word timings.
  const cues: CaptionCue[] = [];
  let prevEnd = input.audioStartFrame;
  for (let i = 0; i < pages.length; i += 1) {
    const page = pages[i]!;
    const nextStartRel = i + 1 < pages.length ? pages[i + 1]![0]!.startRel : input.speechFrames;
    const pageStartRel = page[0]!.startRel;
    const startFrame = Math.max(prevEnd, clampFrame(input.audioStartFrame + pageStartRel, input.audioStartFrame, sceneEnd));
    // Extend the page to the next page's start so there is no mid-speech blank.
    const endRel = Math.max(pageStartRel + 1, Math.min(nextStartRel, input.speechFrames));
    const endFrame = clampFrame(input.audioStartFrame + endRel, startFrame, sceneEnd);
    if (endFrame <= startFrame) continue;

    const lastIdx = page.length - 1;
    const wordCues = page.map((w, j) => {
      const ws = clampFrame(input.audioStartFrame + w.startRel, startFrame, endFrame);
      // The last word stays highlighted until the page ends.
      const weRaw = j === lastIdx ? endFrame : input.audioStartFrame + w.endRel;
      const we = clampFrame(weRaw, ws + 1, endFrame);
      return { text: w.text, startFrame: ws, endFrame: we };
    });

    cues.push({
      startFrame,
      endFrame,
      text: page.map((w) => w.text).join(" "),
      words: wordCues,
      sceneId: input.sceneId,
    });
    prevEnd = endFrame;
  }
  return cues;
}

function clampFrame(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
