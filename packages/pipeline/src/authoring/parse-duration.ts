import {
  DURATION_PRESETS,
  tierSeconds,
  type DurationPreset,
  type DurationTier,
  type VideoFormat,
} from "@motionreal/schema";

/**
 * Parse a target duration (seconds) out of a free-text Vietnamese brief and snap
 * to the nearest supported {@link DurationPreset} (60/90/120/180) for CLI/legacy.
 *
 * Prefer {@link parseDurationSecondsFromPrompt} + {@link resolveEffectiveDuration}
 * when exact short-form lengths (e.g. 15s) matter for pacing.
 */
export function parseDurationFromPrompt(prompt: string): DurationPreset | undefined {
  const seconds = parseDurationSecondsFromPrompt(prompt);
  if (seconds === undefined) return undefined;
  return snapToPreset(seconds);
}

/**
 * Parse stated wall-clock seconds from free text (no snap).
 * Digits only — spelled-out numbers ("một phút") intentionally out of scope.
 */
export function parseDurationSecondsFromPrompt(prompt: string): number | undefined {
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
  // "90 giây" / "90s" / "15 giây" (seconds only).
  if (seconds === undefined) {
    m = t.match(new RegExp(`(\\d+)\\s*${sec}\\b`));
    if (m) seconds = Number(m[1]);
  }

  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return undefined;
  // Clamp to a sane short-form band (product is TikTok/Reels/Shorts).
  return Math.min(Math.max(Math.round(seconds), 8), 600);
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

/** Nearest desktop duration tier label for a free target length. */
export function nearestDurationTier(targetSeconds: number): DurationTier {
  const table: Array<{ tier: DurationTier; seconds: number }> = [
    { tier: 1, seconds: 45 },
    { tier: 2, seconds: 90 },
    { tier: 3, seconds: 150 },
  ];
  let best = table[0]!;
  let bestGap = Math.abs(targetSeconds - best.seconds);
  for (const row of table) {
    const gap = Math.abs(targetSeconds - row.seconds);
    if (gap < bestGap) {
      best = row;
      bestGap = gap;
    }
  }
  return best.tier;
}

export type EffectiveDurationSource = "tier" | "prompt" | "explicit" | "default";

export type EffectiveDuration = {
  /** Exact pacing target in seconds (word budget + scene count). */
  targetSeconds: number;
  /** Nearest tier label for schema / UI continuity. */
  durationTier: DurationTier;
  source: EffectiveDurationSource;
  conflict?: { promptSeconds: number; tierSeconds: number };
};

const CONFLICT_RATIO = 0.2;

/**
 * One duration truth for create/authoring.
 * When the prompt states an explicit length and the UI tier disagrees by >20%,
 * **prompt wins** (user typed "15 giây" on purpose; knobs are often left default).
 */
export function resolveEffectiveDuration(input: {
  prompt: string;
  durationTier?: DurationTier;
  format?: VideoFormat;
  /** Explicit override (CLI / scaffold options.duration). */
  explicitDuration?: number;
}): EffectiveDuration {
  const format: VideoFormat = input.format ?? "tiktok";

  if (input.explicitDuration !== undefined && Number.isFinite(input.explicitDuration) && input.explicitDuration > 0) {
    const targetSeconds = Math.round(input.explicitDuration);
    return {
      targetSeconds,
      durationTier: input.durationTier ?? nearestDurationTier(targetSeconds),
      source: "explicit",
    };
  }

  const promptSeconds = parseDurationSecondsFromPrompt(input.prompt);
  const hasTier = input.durationTier === 1 || input.durationTier === 2 || input.durationTier === 3;
  const tierSec = hasTier ? tierSeconds(format, input.durationTier!) : undefined;

  if (promptSeconds !== undefined && tierSec !== undefined) {
    const gap = Math.abs(promptSeconds - tierSec);
    const conflict = gap > CONFLICT_RATIO * Math.max(promptSeconds, tierSec);
    if (conflict) {
      return {
        targetSeconds: promptSeconds,
        durationTier: nearestDurationTier(promptSeconds),
        source: "prompt",
        conflict: { promptSeconds, tierSeconds: tierSec },
      };
    }
    // Aligned enough: keep UI tier label, use tier seconds for stability.
    return {
      targetSeconds: tierSec,
      durationTier: input.durationTier!,
      source: "tier",
    };
  }

  if (promptSeconds !== undefined) {
    return {
      targetSeconds: promptSeconds,
      durationTier: nearestDurationTier(promptSeconds),
      source: "prompt",
    };
  }

  if (tierSec !== undefined) {
    return {
      targetSeconds: tierSec,
      durationTier: input.durationTier!,
      source: "tier",
    };
  }

  return { targetSeconds: 45, durationTier: 1, source: "default" };
}
