import { z } from "zod";

/**
 * Renderer-agnostic video contract.
 *
 * Unlike the HyperFrames pipeline (which locked the AI into ~40 fixed template
 * IDs with rigid visual payloads), this schema keeps the structural / pacing /
 * narration discipline but leaves the *visual layer open*: every scene names a
 * Remotion `component` from an extensible registry and passes free-form `props`.
 * Each component validates its own props at the composition layer, so diversity
 * lives in code (React) rather than in a closed enum.
 */

export const FPS = 30 as const;

export const DURATION_PRESETS = [60, 90, 120, 180] as const;
export type DurationPreset = (typeof DURATION_PRESETS)[number];

export const DEFAULT_TTS_SPEED = 1.0;

export const SCENE_PACING: Record<
  DurationPreset,
  {
    min: number;
    target: number;
    max: number;
    sceneSeconds: string;
    sceneNarrationWords: string;
    totalNarrationWords: string;
  }
> = {
  60: {
    min: 10,
    target: 12,
    max: 14,
    sceneSeconds: "9.0-11.0",
    sceneNarrationWords: "20-24",
    totalNarrationWords: "160-200",
  },
  90: {
    min: 14,
    target: 16,
    max: 18,
    sceneSeconds: "10.0-12.0",
    sceneNarrationWords: "22-26",
    totalNarrationWords: "240-290",
  },
  120: {
    min: 18,
    target: 20,
    max: 22,
    sceneSeconds: "11.0-13.0",
    sceneNarrationWords: "24-28",
    totalNarrationWords: "340-400",
  },
  180: {
    min: 24,
    target: 26,
    max: 28,
    sceneSeconds: "11.5-14.0",
    sceneNarrationWords: "25-30",
    totalNarrationWords: "480-570",
  },
};

export const SCENE_BOUNDS: Record<DurationPreset, { min: number; max: number }> = {
  60: { min: SCENE_PACING[60].min, max: SCENE_PACING[60].max },
  90: { min: SCENE_PACING[90].min, max: SCENE_PACING[90].max },
  120: { min: SCENE_PACING[120].min, max: SCENE_PACING[120].max },
  180: { min: SCENE_PACING[180].min, max: SCENE_PACING[180].max },
};

export const DurationPresetSchema = z.union([
  z.literal(60),
  z.literal(90),
  z.literal(120),
  z.literal(180),
]);

export const SceneSpecSchema = z.object({
  /** Sequential id: scene-01, scene-02, ... */
  id: z.string().regex(/^scene-[0-9]{2}$/),
  /** Registry component id (open, extensible). */
  component: z.string().min(1),
  /** Target duration in seconds (a pacing target; locked timing follows TTS). */
  durationInSeconds: z.number().positive(),
  /** On-screen short hook. */
  headline: z.string().min(1).max(120),
  /** Small support line under the headline. */
  body: z.string().max(260).optional(),
  eyebrow: z.string().max(64).optional(),
  /** Spoken narration (TTS). */
  narration: z.string().min(1).max(1200),
  /** Free-form visual data for the component to render. */
  props: z.record(z.string(), z.unknown()).default({}),
  /** Optional sound-effect cue. */
  sfx: z.enum(["none", "transition", "alert", "emphasis", "success"]).default("none").optional(),
});

export type SceneSpec = z.infer<typeof SceneSpecSchema>;

export const VideoSpecSchema = z.object({
  version: z.literal(1),
  title: z.string().min(1).max(140),
  styleId: z.literal("clean-luxury-tech"),
  duration: DurationPresetSchema,
  ratio: z.literal("9:16"),
  language: z.literal("vi"),
  scenes: z.array(SceneSpecSchema),
});

export type VideoSpec = z.infer<typeof VideoSpecSchema>;

/**
 * After TTS, each scene's wall-clock duration is resolved from the measured
 * audio length. The locked spec carries frame-accurate timing for Remotion.
 */
export const LockedSceneSpecSchema = SceneSpecSchema.extend({
  startFrame: z.number().int().min(0),
  durationInFrames: z.number().int().positive(),
  audio: z
    .object({
      src: z.string(),
      duration: z.number().nonnegative(),
    })
    .optional(),
});

export type LockedSceneSpec = z.infer<typeof LockedSceneSpecSchema>;

export const LockedVideoSpecSchema = VideoSpecSchema.extend({
  fps: z.literal(FPS).default(FPS),
  durationInFrames: z.number().int().positive(),
  scenes: z.array(LockedSceneSpecSchema),
  audio: z
    .object({
      narrationSrc: z.string().optional(),
    })
    .default({}),
});

export type LockedVideoSpec = z.infer<typeof LockedVideoSpecSchema>;

export type ValidationResult = {
  ok: boolean;
  errors: string[];
};

export function parseDurationPreset(value: unknown): DurationPreset {
  const parsed = typeof value === "string" ? Number(value) : value;
  const result = DurationPresetSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error("Duration must be one of 60, 90, 120, or 180 seconds.");
  }
  return result.data;
}

export function parseAiJsonOutput(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced ? fenced[1]!.trim() : trimmed;
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("AI output does not contain a JSON object.");
  }
  return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
}

export function secondsToFrames(seconds: number, fps: number = FPS): number {
  return Math.max(1, Math.round(seconds * fps));
}

function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Structural + narration validation that is independent of which visual
 * component a scene uses. Component-specific prop validation happens in the
 * compositions package (each component owns its zod schema).
 */
export function validateVideoSpecStructure(
  spec: VideoSpec,
  knownComponents?: ReadonlySet<string>,
): ValidationResult {
  const errors: string[] = [];
  const bounds = SCENE_BOUNDS[spec.duration];

  if (spec.scenes.length < bounds.min || spec.scenes.length > bounds.max) {
    errors.push(
      `Scene count for ${spec.duration}s must be between ${bounds.min} and ${bounds.max}; received ${spec.scenes.length}.`,
    );
  }

  const total = spec.scenes.reduce((sum, scene) => sum + scene.durationInSeconds, 0);
  if (Math.abs(total - spec.duration) > 0.01) {
    errors.push(`Scene durations must total ${spec.duration}s; received ${total.toFixed(2)}s.`);
  }

  const ids = new Set<string>();
  for (const [index, scene] of spec.scenes.entries()) {
    if (ids.has(scene.id)) errors.push(`Duplicate scene id: ${scene.id}.`);
    ids.add(scene.id);

    const expectedId = `scene-${String(index + 1).padStart(2, "0")}`;
    if (scene.id !== expectedId) {
      errors.push(`Scene at index ${index} must have id ${expectedId}; received ${scene.id}.`);
    }
    if (scene.narration.includes("\n")) {
      errors.push(`${scene.id} narration must be one paragraph, not multiline.`);
    }
    const headlineWords = countWords(scene.headline);
    if (headlineWords > 10) {
      errors.push(`${scene.id} headline has ${headlineWords} words; keep visual headlines under 10 words.`);
    }
    if (knownComponents && !knownComponents.has(scene.component)) {
      errors.push(`${scene.id} uses unknown component "${scene.component}".`);
    }
  }

  // --- Narration pacing (prevents too-fast scene cuts) ---
  const pacing = SCENE_PACING[spec.duration];
  const [minWordsStr] = pacing.sceneNarrationWords.split("-");
  const minWords = Number(minWordsStr);
  const [minTotalStr] = pacing.totalNarrationWords.split("-");
  const minTotal = Number(minTotalStr);
  let totalNarrationWords = 0;
  for (const scene of spec.scenes) {
    const wordCount = countWords(scene.narration);
    totalNarrationWords += wordCount;
    if (wordCount < minWords) {
      errors.push(
        `${scene.id} narration has ${wordCount} words; minimum is ${minWords} for ${spec.duration}s videos.`,
      );
    }
  }
  if (totalNarrationWords < minTotal) {
    errors.push(
      `Total narration word count is ${totalNarrationWords}; minimum for ${spec.duration}s videos is ${minTotal}.`,
    );
  }

  return { ok: errors.length === 0, errors };
}

export function validateLockedTimings(spec: LockedVideoSpec): ValidationResult {
  const errors: string[] = [];
  const last = spec.scenes.at(-1);
  if (!last) {
    errors.push("Locked spec must contain scenes.");
  } else {
    const end = last.startFrame + last.durationInFrames;
    if (end !== spec.durationInFrames) {
      errors.push(`Locked timeline must end at ${spec.durationInFrames} frames; received ${end}.`);
    }
  }
  return { ok: errors.length === 0, errors };
}
