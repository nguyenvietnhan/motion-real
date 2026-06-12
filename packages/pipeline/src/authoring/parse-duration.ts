import { DURATION_PRESETS, type DurationPreset } from "@news/schema";

/**
 * Parse a target duration (seconds) out of a free-text Vietnamese brief and snap
 * it to the nearest supported {@link DurationPreset} (60/90/120/180).
 *
 * WHY: the desktop create flow hands the orchestrator only the raw `prompt`, and
 * `scaffoldVideoProject` otherwise defaults `duration` to 60 — so a user who
 * typed "1p30s" silently got a 60s target (the N28 duration check then measured
 * a 90s ask against a 60s goal, and the author word-budget aimed at the wrong
 * length). This recovers the user's stated length from the text itself.
 *
 * PURE + TOTAL: returns `undefined` when the text states no recognizable length
 * (the caller keeps its own default). Digits only — spelled-out numbers ("một
 * phút") are intentionally out of scope to stay unambiguous.
 *
 * Recognized (case-insensitive), checked most-specific first:
 *   - "1 phút rưỡi" / "1p rưỡi"            → 90  (minutes + a half)
 *   - "1p30s" / "1 phút 30 giây" / "1p30"  → minutes*60 + seconds
 *   - "2 phút" / "2p"                       → minutes*60
 *   - "90 giây" / "90 giay" / "90s"         → seconds
 */
export function parseDurationFromPrompt(prompt: string): DurationPreset | undefined {
  const t = prompt.toLowerCase();
  const min = "(?:p|phút|phut)";
  const sec = "(?:s|giây|giay)";

  let seconds: number | undefined;

  // "1 phút rưỡi" / "1p rưỡi" → minutes + 30s.
  let m = t.match(new RegExp(`(\\d+)\\s*${min}\\s*rưỡi`));
  if (m) {
    seconds = Number(m[1]) * 60 + 30;
  }
  // "1p30s" / "1 phút 30 giây" / "1p30" → minutes + seconds.
  if (seconds === undefined) {
    m = t.match(new RegExp(`(\\d+)\\s*${min}\\s*(\\d+)\\s*${sec}?`));
    if (m) seconds = Number(m[1]) * 60 + Number(m[2]);
  }
  // "2 phút" / "2p" (minutes only, no trailing seconds).
  if (seconds === undefined) {
    m = t.match(new RegExp(`(\\d+)\\s*${min}\\b`));
    if (m) seconds = Number(m[1]) * 60;
  }
  // "90 giây" / "90s" (seconds only).
  if (seconds === undefined) {
    m = t.match(new RegExp(`(\\d+)\\s*${sec}\\b`));
    if (m) seconds = Number(m[1]);
  }

  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return undefined;
  return snapToPreset(seconds);
}

/** Snap an arbitrary seconds value to the closest supported preset. */
function snapToPreset(seconds: number): DurationPreset {
  let best: DurationPreset = DURATION_PRESETS[0];
  let bestGap = Math.abs(seconds - best);
  for (const p of DURATION_PRESETS) {
    const gap = Math.abs(seconds - p);
    if (gap < bestGap) {
      best = p;
      bestGap = gap;
    }
  }
  return best;
}
