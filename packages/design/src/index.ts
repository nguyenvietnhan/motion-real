/**
 * @news/design — the shared visual grammar every scene pulls from.
 *
 * The system is MULTI-LANGUAGE. A "style" is not a thin chrome layer over one
 * frozen look — it is a self-contained DESIGN LANGUAGE (`StyleLanguage`) that
 * derives its OWN full palette + surface grammar + backdrop from a single
 * dominant hue and carries its OWN slice of the AI authoring contract. Blocks
 * read every visual decision from the resolved `Theme`, so ONE set of blocks
 * renders EVERY language, and adding a language is one new file under
 * `languages/` + one registry line (Open/Closed).
 *
 * Layering (no cycles):  core.ts ← languages/*.ts ← style-packs.ts ← index.ts
 *
 * INVARIANT across all languages (the "physics"): layout zones, caption band,
 * the content/caption divider, determinism, minimum type sizes — those live in
 * `@news/schema` + the BASE contract and no language may move them. Everything
 * else (polarity, corners, fonts, surface grammar, color series, backdrop) is
 * the language's to decide.
 *
 * Determinism: pure math only (no Math.random / Date / IO), so a theme is a
 * stable function of `(dominant, stylePackId)`.
 */

// The leaf: color math, the token model, fixed constants.
export * from "./core.js";
// The registry + makeTheme + theme assembly (Proxy aliasing).
export * from "./style-packs.js";
// The bundled languages (re-exported so consumers can introspect them).
export { editorialLanguage } from "./languages/editorial.js";
export { galaxyLanguage } from "./languages/galaxy.js";

import { DEFAULT_DOMINANT, withAlpha, type Theme } from "./core.js";
import { makeTheme } from "./style-packs.js";

/** Default theme (used by Studio / tests / any consumer with no project palette). */
export const theme: Theme = makeTheme(DEFAULT_DOMINANT);

/**
 * Shared background gradient, derived from the active theme's accent/companion.
 * Kept for back-compat; the `Frame` block now paints the language's backdrop
 * directly, but bespoke authored scenes may still reach for this.
 */
export function sceneBackground(t: Theme = theme): string {
  return (
    `radial-gradient(circle at 50% 25%, ${withAlpha(t.colors.accent, 0.16)} 0%, ` +
    `${withAlpha(t.colors.signal, 0.08)} 35%, ${withAlpha(t.colors.accent, 0.04)} 60%, ` +
    `${withAlpha(t.colors.bg, 0)} 80%), ` +
    t.colors.bg
  );
}

/**
 * Short design-system note surfaced to tooling. The full, per-language
 * philosophy lives in `docs/design-language.md`; each language also carries its
 * own `contract` (the AI authoring slice).
 */
export const designNotes = `## Multi-language design system

A 9:16 short-form video system with multiple self-contained DESIGN LANGUAGES
(e.g. "bold-editorial" — light print; "galaxy" — dark premium space). Each
language derives its full palette + surface grammar + backdrop from one
per-project dominant hue, and carries its own AI authoring contract. ONE set of
blocks renders every language by reading the resolved theme tokens
(theme.colors.*, theme.radius.*, theme.surface, theme.backdrop) — never
hard-coding a color, corner, or border.

INVARIANT across languages: layout zones, the caption band, the content/caption
divider, determinism (frame-pure), and minimum type sizes. VARIES per language:
base polarity, corner geometry, fonts, how blocks draw border/fill/shadow, the
semantic color series, and the frame backdrop. See docs/design-language.md.
`;
