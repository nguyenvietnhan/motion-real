import {
  isDurationTier,
  nearestDurationTier,
  tierSeconds,
  type DurationTier,
} from "@motionreal/schema";

export { isDurationTier, nearestDurationTier };

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
  /** Explicit override (CLI / scaffold options.duration) — highest priority. */
  explicitDuration?: number;
}): EffectiveDuration {
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
  const tierSec = hasTier ? tierSeconds(input.durationTier!) : undefined;

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

  // Keep CLI/tools aligned with the desktop's fresh-install setting. Callers
  // that intentionally want ~45 seconds pass tier 1 explicitly.
  return { targetSeconds: 90, durationTier: 2, source: "default" };
}
