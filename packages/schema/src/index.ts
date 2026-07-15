import { z } from "zod";

/**
 * Renderer-agnostic video contract for pure AUTHOR mode.
 *
 * Structural / pacing / narration discipline lives here; visuals stay open:
 * every scene names a Remotion `component` from an extensible registry and
 * passes free-form `props`. Each component validates its own props at the
 * composition layer, so diversity lives in authored React code.
 */

// Layout zones (content zone / caption band / platform-UI reserve) live in their
// own module but are part of the shared contract, so re-export them here.
export * from "./zones.js";

export const FPS = 30 as const;

/**
 * Shared timing constants — the single source of
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

/** Minimum narration words per scene (free pacing): a floor that still guards against too-fast cuts. */
export const MIN_SCENE_NARRATION_WORDS = 8;

/** Hold time (seconds) for a scene that carries no narration, so it is still on screen. */
export const DEFAULT_HOLD_SECONDS = 4;

export const DEFAULT_TTS_SPEED = 1.0;

/**
 * A scene's single optional image (no-media → ≤1 LOCAL image per scene). The
 * field is FIRST-CLASS and SINGULAR — so "at most one image" is structurally
 * impossible to violate — and lives OUTSIDE the free-form `props` so it never
 * collides with a component's own Zod schema.
 *
 * `ref` is a project-relative path to a LOCAL asset (resolved by the renderer
 * via Remotion `staticFile()` against the project root, exactly like narration
 * audio). The refinement rejects everything that would breach the offline /
 * determinism invariant (N16) or smuggle remote media past the new N9:
 * - any URL scheme (`http(s)://`, `data:`, `blob:`) — remote media is banned
 * at render time; only local assets are allowed;
 * - absolute paths and `..` traversal — the ref must stay inside the project;
 * - any non-raster / scriptable extension — only png/jpg/jpeg/webp/gif (SVG
 * is rejected: it can carry script in a Chromium render context).
 * Create/crawl/upload flows populate `ref` via content-addressed files
 * (`assets/<sha>.<ext>`); this schema only defines + guards the shape.
 */
const IMAGE_REF_EXT = /\.(png|jpe?g|webp|gif)$/i;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
export const SceneImageSchema = z.object({
  /** Project-relative path to a LOCAL image asset (e.g. "assets/<sha>.png"). */
  ref: z
    .string()
    .min(1)
    .max(512)
    .refine((r) => !HAS_SCHEME.test(r), "image.ref must be a local path, not a URL or data/blob scheme (remote media is banned at render time)")
    .refine((r) => !/^([/\\]|[A-Za-z]:)/.test(r), "image.ref must be project-relative, not an absolute path")
    .refine((r) => !r.split(/[/\\]/).includes(".."), "image.ref must not contain a \"..\" path traversal")
    .refine((r) => IMAGE_REF_EXT.test(r), "image.ref must end in .png/.jpg/.jpeg/.webp/.gif (SVG and other formats are not allowed)"),
  /** Optional alt/caption text for accessibility + review (not rendered as a caption). */
  alt: z.string().max(160).optional(),
});

export type SceneImage = z.infer<typeof SceneImageSchema>;

export const SceneSpecSchema = z.object({
  /** Sequential id: scene-01, scene-02,... */
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
  /**
   * At most ONE local image for this scene (optional). Singular by design so
   * "≤1 image per scene" cannot be violated; rendered only via the sanctioned
   * `<SceneImage>` block. See `SceneImageSchema` for the local-only / no-remote
   * refinement that protects the N16 offline invariant.
   */
  image: SceneImageSchema.optional(),
  /**
   * Transition INTO the next scene. `slide` (default) and `fade` are the calm
   * baseline; `wipe`/`clockWipe`/`zoom` are punchier accents for section breaks
   * or emphasis. All are deterministic DOM transitions (no WebGL).
   */
  transitionToNext: z.enum(["slide", "fade", "wipe", "clockWipe", "zoom"]).optional(),
  /**
   * AI-chosen in-scene emphasis. `"zoom"` applies a whole-scene punch-in that
   * settles (composition `SceneZoom`) — reserve it for the beats that deserve a
   * spotlight (the hook, a key reveal), NOT every scene. Omit for a calm scene;
   * there is no engine-wide ambient tilt applied when this field is absent.
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
});

export type ThemeSpec = z.infer<typeof ThemeSpecSchema>;

/**
 * Delivery format. Short-form 9:16 only — see `geometry` in `./zones.ts`.
 * REQUIRED on a spec so the renderer always knows the canvas contract.
 */
export const VideoFormatSchema = z.literal("tiktok");

/**
 * Duration tier for short-form pacing (45s / 90s / 150s / 210s). Optional on the
 * spec because resolved pacing lives in `duration` (seconds). Desktop knobs:
 * 1≈0:45, 2≈1:30, 3≈2:30, 4≈3:30 (default 1).
 */
export const DurationTierSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);
export type DurationTier = z.infer<typeof DurationTierSchema>;

/** Target seconds for a short-form duration tier. The pacing AIM, not a hard cut. */
export function tierSeconds(tier: DurationTier): number {
  const table: Record<DurationTier, number> = { 1: 45, 2: 90, 3: 150, 4: 210 };
  return table[tier];
}

/** True when value is a valid desktop/CLI duration tier (1–4). */
export function isDurationTier(value: unknown): value is DurationTier {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

/** Nearest tier label for a free-form second length. */
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

/**
 * Language of the authored video content: publish title, hashtags, on-screen
 * text, narration, and therefore generated captions. Vivibe supports only `vi`;
 * English video generation must use a multilingual provider such as ElevenLabs.
 */
export const VideoLanguageSchema = z.enum(["vi", "en"]);
export type VideoLanguage = z.infer<typeof VideoLanguageSchema>;

/** Max publish-title length (short-form + hashtags). */
export function titleMaxChars(): number {
  return 100;
}

export const VideoSpecSchema = z.object({
  version: z.literal(1),
  title: z.string().min(1).max(140),
  /** Delivery format (REQUIRED): short-form 9:16. */
  format: VideoFormatSchema,
  /** Duration bucket (optional): word-budget target, see `tierSeconds`. */
  durationTier: DurationTierSchema.optional(),
  /** Language of the authored video content (optional → vi). */
  videoLanguage: VideoLanguageSchema.optional(),
  /**
   * Optional pacing TARGET in seconds (free pacing, R6): not a hard constraint.
   * Scene count and total duration are free; a longer measured render is fine.
   */
  duration: z.number().positive().optional(),
  /** Aspect ratio. Always 9:16 for short-form; optional for readability. */
  ratio: z.literal("9:16").optional(),
  language: VideoLanguageSchema,
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
 * A single burned-in caption line. Cues are derived from
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
   * Per-word timing for KARAOKE highlighting. Word frames
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
 * Free pacing: there are NO fixed scene-count bounds and NO
 * duration-preset equality. What stays enforced: sequential `scene-NN` ids,
 * single-paragraph narration, a scannable headline, a per-scene narration floor
 * (guards against too-fast cuts), and unknown-component detection.
 */
export function validateVideoSpecStructure(
  spec: VideoSpec,
  knownComponents?: ReadonlySet<string>,
): ValidationResult {
  const errors: string[] = [];

  if (spec.format !== "tiktok") {
    errors.push(`Spec must declare format "tiktok"; received ${JSON.stringify(spec.format)}.`);
  }

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
 * Overlap-aware locked-timing validation (N12). With
 * `TransitionSeries`, adjacent scene sequences OVERLAP by the transition frames,
 * so the timeline is no longer strictly contiguous. What must still hold:
 * - the first scene starts at frame 0;
 * - scenes are monotonic and leave NO gap (each scene starts at or before the
 * previous scene's end — an overlap is fine, a gap is not);
 * - the last scene ends exactly at `durationInFrames`.
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
