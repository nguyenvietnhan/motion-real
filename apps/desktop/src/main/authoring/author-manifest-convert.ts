import { createLogger, type Manifest, type ManifestScene } from "@motionreal/pipeline";
import type { VideoFormat, DurationTier, VideoLanguage } from "@motionreal/schema";
import type { AuthorManifest } from "./manifest-schema.js";

const log = createLogger("authoring");

/** Engine ThemeSpec limits: dominant must be 6-digit hex, mood ≤40 chars. */
const HEX6 = /^#[0-9a-fA-F]{6}$/;

export function sanitizeTheme(theme: { dominant: string; mood?: string }): {
  dominant: string;
  mood?: string;
} {
  const dominant = HEX6.test(theme.dominant.trim()) ? theme.dominant.trim() : "#1E9CB0";
  const mood = (theme.mood ?? "").trim().slice(0, 40);
  return {
    dominant,
    ...(mood ? { mood } : {}),
  };
}

/**
 * AuthorManifest (open-id, pure-author) → engine Manifest with sequential scene
 * ids. `allowedRefs` is the set of image refs we actually provided to the model;
 * any scene `image.ref` NOT in that set is a hallucinated path and is DROPPED
 * (defense-in-depth so an invented ref never reaches the manifest/render — the
 * N9 build existence check is the backstop). Empty set ⇒ no images were offered,
 * so every `image` is dropped.
 *
 * `delivery` is injected by the backend (the AI never authors it — it only writes
 * `theme.dominant`/`mood` + scenes). Desktop create fixes short-form
 * `format: "tiktok"` + `durationTier: 1`; `videoLanguage` is the user language
 * choice. Defaults: tiktok / tier 1 / vi.
 */
export function toEngineManifest(
  m: AuthorManifest,
  allowedRefs: ReadonlySet<string> = new Set(),
  delivery: { format?: VideoFormat; durationTier?: DurationTier; videoLanguage?: VideoLanguage } = {},
): Manifest {
  const scenes: ManifestScene[] = m.scenes.map((s, i) => {
    const keepImage = s.image && allowedRefs.has(s.image.ref);
    if (s.image && !keepImage) {
      log.warn({ sceneIndex: i + 1, ref: s.image.ref }, "dropping scene image with non-provided ref");
    }
    return {
      id: `scene-${String(i + 1).padStart(2, "0")}`,
      component: s.component,
      eyebrow: s.eyebrow,
      headline: s.headline,
      narration: s.narration,
      props: s.props ?? {},
      ...(s.body ? { body: s.body } : {}),
      ...(keepImage ? { image: { ref: s.image!.ref, ...(s.image!.alt ? { alt: s.image!.alt } : {}) } } : {}),
      ...(s.transitionToNext ? { transitionToNext: s.transitionToNext } : {}),
    };
  });
  // Clamp to the engine VideoSpec limits so AI variance never trips schema
  // validation: title ≤140, theme.dominant hex, theme.mood ≤40. Delivery fields
  // are injected by the backend, never authored by the model.
  return {
    title: m.title.slice(0, 140),
    ...(m.hashtags && m.hashtags.length > 0 ? { hashtags: m.hashtags } : {}),
    theme: sanitizeTheme(m.theme),
    ...(delivery.format ? { format: delivery.format } : {}),
    ...(delivery.durationTier ? { durationTier: delivery.durationTier } : {}),
    ...(delivery.videoLanguage ? { videoLanguage: delivery.videoLanguage } : {}),
    scenes,
  } as Manifest;
}

/** Aggregate admission violation checks for structured failure logs. */
export function countSafetyChecks(violations: readonly { check: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const violation of violations) {
    counts[violation.check] = (counts[violation.check] ?? 0) + 1;
  }
  return counts;
}
