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
 * for desktop create pacing.
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
    { tier: 4, seconds: 210 },
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
  /** Present when prompt length disagreed with UI tier (UI still wins). */
  conflict?: { promptSeconds: number; tierSeconds: number };
};

const CONFLICT_RATIO = 0.2;

function isDurationTier(value: unknown): value is DurationTier {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

/**
 * One duration truth for create/authoring.
 *
 * **Desktop policy: Settings / UI `durationTier` always wins** when set.
 * An explicit length in the prompt is only used when no tier is provided
 * (CLI / tools). Conflicts are logged for observability but do not override
 * the knob.
 */
export function resolveEffectiveDuration(input: {
  prompt: string;
  durationTier?: DurationTier;
  format?: VideoFormat;
  /** Explicit override (CLI / scaffold options.duration) — highest priority. */
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
  const hasTier = isDurationTier(input.durationTier);
  const tierSec = hasTier ? tierSeconds(format, input.durationTier!) : undefined;

  if (hasTier && tierSec !== undefined) {
    const conflict =
      promptSeconds !== undefined &&
      Math.abs(promptSeconds - tierSec) > CONFLICT_RATIO * Math.max(promptSeconds, tierSec)
        ? { promptSeconds, tierSeconds: tierSec }
        : undefined;
    return {
      targetSeconds: tierSec,
      durationTier: input.durationTier!,
      source: "tier",
      ...(conflict ? { conflict } : {}),
    };
  }

  if (promptSeconds !== undefined) {
    return {
      targetSeconds: promptSeconds,
      durationTier: nearestDurationTier(promptSeconds),
      source: "prompt",
    };
  }

  return { targetSeconds: 45, durationTier: 1, source: "default" };
}
