import { VENDORED_FONTS } from "./vendor-fonts.generated.js";

/**
 * Render-safe font loading (no network, never block Remotion).
 *
 * History / root cause (production unattended full, 2026-07-16):
 * - Module-level `delayRender` + `FontFace.load()` on 22 base64 faces blocked
 *   the render. Remotion's handle timeout is `timeoutInMilliseconds - 2000`
 *   (so a 12s budget surfaces as "not cleared after 10000ms"). Sync FontFace
 *   construction can starve the timers that were meant to continueRender.
 * - Remotion also awaits `document.fonts.ready` after each seek; abandoned
 *   `FontFace.load()` promises can leave faces "loading" forever.
 * - Remotion docs: do not call delayRender outside a component.
 *
 * Fix: inject `@font-face` CSS for the faces the **neutral theme actually
 * uses** (Inter + Cascadia Mono). No delayRender, no FontFace.load(). Browser
 * loads glyphs on demand when a frame paints text. Be Vietnam Pro is vendored
 * historically but unused by `makeTheme()` — skip it at inject time.
 *
 * Re-run `npm run vendor-fonts` only when refreshing woff2 bytes; this module
 * does not need a regenerate to drop unused families from the hot path.
 */

/** Families the neutral render theme leads with (must stay in sync with theme). */
export const LOADED_FONT_FAMILIES = {
  display: "Inter",
  body: "Inter",
  mono: "Cascadia Mono",
} as const;

const THEME_FONT_FAMILIES = new Set<string>([
  LOADED_FONT_FAMILIES.display,
  LOADED_FONT_FAMILIES.body,
  LOADED_FONT_FAMILIES.mono,
]);

const STYLE_TAG_ID = "motionreal-vendored-fonts";

/**
 * Inject one `@font-face` rule per vendored face used by the theme.
 * Idempotent; safe to import from multiple runtime modules.
 */
function injectVendoredFontFaces(): void {
  if (VENDORED_FONTS.length === 0) {
    // eslint-disable-next-line no-console
    console.warn("[fonts] VENDORED_FONTS is empty — run `npm run vendor-fonts`");
    return;
  }
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_TAG_ID)) return;

  const faces = VENDORED_FONTS.filter((f) => THEME_FONT_FAMILIES.has(f.family));
  if (faces.length === 0) {
    // eslint-disable-next-line no-console
    console.warn("[fonts] no vendored faces match theme families");
    return;
  }

  const css = faces
    .map((font) => {
      // JSON.stringify quotes family names safely (spaces, etc.).
      return [
        "@font-face {",
        `  font-family: ${JSON.stringify(font.family)};`,
        `  font-weight: ${font.weight};`,
        `  font-style: ${font.style};`,
        "  font-display: block;",
        `  unicode-range: ${font.unicodeRange};`,
        `  src: url(${JSON.stringify(font.dataUrl)}) format("woff2");`,
        "}",
      ].join("\n");
    })
    .join("\n");

  const style = document.createElement("style");
  style.id = STYLE_TAG_ID;
  style.setAttribute("data-motionreal-fonts", "vendored");
  style.textContent = css;
  (document.head ?? document.documentElement).appendChild(style);
}

// Side-effect on import (Node/vitest: document undefined → no-op).
injectVendoredFontFaces();

/** One loaded font's Vietnamese-coverage status (for the doctor font check). */
export type FontCoverage = { family: string; hasVietnamese: boolean };

/**
 * Report whether each theme render font ships the `vietnamese` subset.
 * Coverage is verified from the vendored manifest only (unique families).
 */
export function fontCoverageReport(): FontCoverage[] {
  const hasViet = (family: string) =>
    VENDORED_FONTS.some((f) => f.family === family && f.subset === "vietnamese");
  // Unique families — theme display/body both use Inter.
  const families = [...new Set(Object.values(LOADED_FONT_FAMILIES))];
  return families.map((family) => ({ family, hasVietnamese: hasViet(family) }));
}
