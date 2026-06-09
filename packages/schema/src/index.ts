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

// Layout zones (content zone / caption band / platform-UI reserve) live in their
// own module but are part of the shared contract, so re-export them here.
export * from "./zones.js";

export const FPS = 30 as const;

/**
 * Shared timing constants (author-mode-v2 R3/R4/R5/R11.3) — the single source of
 * truth reused by transitions, TTS breath gaps, the lock math, and the master
 * composition.
 *
 * Transition length is defined in SECONDS so it is identical at any render fps
 * (the 30fps final and the 10fps fast draft feel the same). `T_TRANSITION` is
 * the 30fps frame count kept for back-compat; `transitionFrames(fps)` is the
 * fps-correct value the lock + composition actually use. The breath gap (silent
 * pause between scene narration clips) equals the transition seconds so each
 * transition overlap lands on silence and no speech is ever clipped.
 */
export const T_TRANSITION_SECONDS = 0.5;
/** Per-boundary transition overlap in frames at a given fps. */
export function transitionFrames(fps: number = FPS): number {
  return Math.max(1, Math.round(T_TRANSITION_SECONDS * fps));
}
/** Back-compat 30fps frame count (= transitionFrames(FPS)). */
export const T_TRANSITION = transitionFrames(FPS);
/** Breath gap between consecutive scene narration clips, in seconds. */
export const BREATH_GAP_SECONDS = T_TRANSITION_SECONDS;

/** A pacing target is advisory; videos may run shorter/longer than any preset. */
export const DURATION_PRESETS = [60, 90, 120, 180] as const;
export type DurationPreset = (typeof DURATION_PRESETS)[number];

/** Minimum narration words per scene (free pacing): a floor that still guards against too-fast cuts. */
export const MIN_SCENE_NARRATION_WORDS = 8;

/** Hold time (seconds) for a scene that carries no narration, so it is still on screen. */
export const DEFAULT_HOLD_SECONDS = 4;

export const DEFAULT_TTS_SPEED = 1.0;

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
  /**
   * Transition INTO the next scene. `slide` (default) and `fade` are the calm
   * baseline; `wipe`/`clockWipe`/`zoom` are punchier accents for section breaks
   * or emphasis. All are deterministic DOM transitions (no WebGL).
   */
  transitionToNext: z.enum(["slide", "fade", "wipe", "clockWipe", "zoom"]).optional(),
  /**
   * AI-chosen in-scene emphasis. `"zoom"` applies a whole-scene punch-in that
   * settles — reserve it for the beats that deserve a spotlight (the hook, a key
   * reveal), NOT every scene. Omit for a calm scene. (The ambient 3D tilt is
   * always on; this is the deliberate, per-scene accent on top.)
   */
  emphasis: z.enum(["zoom"]).optional(),
});

export type SceneSpec = z.infer<typeof SceneSpecSchema>;

/**
 * Per-project palette. The planner picks ONE dominant color that fits the
 * topic; the whole video's palette (background tint, accent, companion tone) is
 * derived from it deterministically, so each project has its own coherent color
 * while sharing the same layout grammar. Optional for back-compat: when absent,
 * the renderer falls back to the default dominant.
 */
export const ThemeSpecSchema = z.object({
  /** Dominant color as a 6-digit hex (e.g. "#5B8CFF"). */
  dominant: z.string().regex(/^#[0-9a-fA-F]{6}$/, "dominant must be a 6-digit hex color like #5B8CFF"),
  /** Optional short mood label for human readability (e.g. "calm tech blue"). */
  mood: z.string().max(40).optional(),
  /**
   * Optional selectable design style pack id (tool-productization R1), e.g.
   * "bold-editorial" (default) or "clean-premium". Validated against the
   * registered packs at spec-build time; absent ⇒ the default pack.
   */
  stylePackId: z.string().optional(),
});

export type ThemeSpec = z.infer<typeof ThemeSpecSchema>;

export const VideoSpecSchema = z.object({
  version: z.literal(1),
  title: z.string().min(1).max(140),
  styleId: z.literal("clean-luxury-tech"),
  /**
   * Optional pacing TARGET in seconds (free pacing, R6): not a hard constraint.
   * Scene count and total duration are free; a longer measured render is fine.
   */
  duration: z.number().positive().optional(),
  ratio: z.literal("9:16"),
  language: z.literal("vi"),
  /** Per-project dominant color the AI chose (optional → default palette). */
  theme: ThemeSpecSchema.optional(),
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

/**
 * A single burned-in caption line (author-mode-v2 R16). Cues are derived from
 * narration (+ TTS timing), baked into the locked spec, and rendered in the
 * caption band — so caption rendering is a pure function of the frame
 * (deterministic, N16-safe), never a live transcript.
 */
export const CaptionCueSchema = z.object({
  /** Absolute start frame (already offset by the scene's startFrame). */
  startFrame: z.number().int().min(0),
  /** Exclusive end frame; the cue is visible on [startFrame, endFrame). */
  endFrame: z.number().int().positive(),
  /** A single line that fits the caption band width at the caption font size. */
  text: z.string().min(1),
  /**
   * Per-word timing for KARAOKE highlighting (author-mode-v2 R16). Word frames
   * are derived (approximately) from the cue span — proportional to word length
   * — since the TTS SRT is sentence-level. Deterministic + frame-pure. Optional:
   * when absent the renderer shows the whole `text` line without highlighting.
   */
  words: z
    .array(
      z.object({
        text: z.string().min(1),
        startFrame: z.number().int().min(0),
        endFrame: z.number().int().positive(),
      }),
    )
    .optional(),
  /** Provenance, for oracles/review. */
  sceneId: z.string(),
});

export type CaptionCue = z.infer<typeof CaptionCueSchema>;

export const LockedVideoSpecSchema = VideoSpecSchema.extend({
  /** Render fps. 30 for the final; a fast draft may re-lock at a lower fps (e.g. 10). */
  fps: z.number().int().positive().default(FPS),
  durationInFrames: z.number().int().positive(),
  scenes: z.array(LockedSceneSpecSchema),
  audio: z
    .object({
      narrationSrc: z.string().optional(),
    })
    .default({}),
  /** Burned-in single-line caption cues (sorted, non-overlapping). */
  captions: z.array(CaptionCueSchema).default([]),
});

export type LockedVideoSpec = z.infer<typeof LockedVideoSpecSchema>;

export type ValidationResult = {
  ok: boolean;
  errors: string[];
};

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
 *
 * Free pacing (author-mode-v2 R6): there are NO fixed scene-count bounds and NO
 * duration-preset equality. What stays enforced: sequential `scene-NN` ids,
 * single-paragraph narration, a scannable headline, a per-scene narration floor
 * (guards against too-fast cuts), and unknown-component detection.
 */
export function validateVideoSpecStructure(
  spec: VideoSpec,
  knownComponents?: ReadonlySet<string>,
): ValidationResult {
  const errors: string[] = [];

  if (spec.scenes.length === 0) {
    errors.push("Spec must contain at least one scene.");
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
    const narrationWords = countWords(scene.narration);
    if (narrationWords < MIN_SCENE_NARRATION_WORDS) {
      errors.push(
        `${scene.id} narration has ${narrationWords} words; minimum is ${MIN_SCENE_NARRATION_WORDS} to avoid a too-fast cut.`,
      );
    }
    if (knownComponents && !knownComponents.has(scene.component)) {
      errors.push(`${scene.id} uses unknown component "${scene.component}".`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Overlap-aware locked-timing validation (N12, author-mode-v2 R5.3). With
 * `TransitionSeries`, adjacent scene sequences OVERLAP by the transition frames,
 * so the timeline is no longer strictly contiguous. What must still hold:
 *  - the first scene starts at frame 0;
 *  - scenes are monotonic and leave NO gap (each scene starts at or before the
 *    previous scene's end — an overlap is fine, a gap is not);
 *  - the last scene ends exactly at `durationInFrames`.
 * This accepts both a contiguous timeline (overlap 0) and a transition-aware one
 * (overlap = T_TRANSITION), and still fires when scenes fail to tile the total.
 */
export function validateLockedTimings(spec: LockedVideoSpec): ValidationResult {
  const errors: string[] = [];
  const scenes = spec.scenes;
  if (scenes.length === 0) {
    errors.push("Locked spec must contain scenes.");
    return { ok: false, errors };
  }

  if (scenes[0]!.startFrame !== 0) {
    errors.push(`First scene must start at frame 0; received ${scenes[0]!.startFrame}.`);
  }

  for (let i = 1; i < scenes.length; i += 1) {
    const prev = scenes[i - 1]!;
    const cur = scenes[i]!;
    const prevEnd = prev.startFrame + prev.durationInFrames;
    if (cur.startFrame < prev.startFrame) {
      errors.push(`${cur.id} starts (${cur.startFrame}) before the previous scene (${prev.startFrame}).`);
    } else if (cur.startFrame > prevEnd) {
      errors.push(`Gap before ${cur.id}: it starts at ${cur.startFrame} but the previous scene ends at ${prevEnd}.`);
    }
  }

  const last = scenes.at(-1)!;
  const end = last.startFrame + last.durationInFrames;
  if (end !== spec.durationInFrames) {
    errors.push(`Locked timeline must end at ${spec.durationInFrames} frames; received ${end}.`);
  }

  return { ok: errors.length === 0, errors };
}
