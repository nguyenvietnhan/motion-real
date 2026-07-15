import { continueRender, delayRender } from "remotion";
import { VENDORED_FONTS } from "./vendor-fonts.generated.js";

/**
 * Render-safe font loading.
 *
 * Every render font must be present with the **vietnamese** subset so a
 * Vietnamese diacritic never falls back to a system face ("nét to nét nhỏ").
 *
 * Fonts are VENDORED as base64 woff2 data URLs (`vendor-fonts.generated.ts`,
 * produced by `scripts/vendor-fonts.ts`) and registered via `FontFace` with NO
 * network. This removes the live `fonts.gstatic.com` fetch from the render hot
 * path — the source of intermittent "Timed out loading Google Font" failures.
 *
 * Registration is wrapped in `delayRender`/`continueRender` but is NON-FATAL:
 * if a face fails we still `continueRender` so a cosmetic font issue never kills
 * an otherwise valid render.
 *
 * Family map: Inter (display/body), Be Vietnam Pro (alternate display/body),
 * Cascadia Mono (mono labels) — all Vietnamese-complete.
 */

/** Register the vendored faces locally (no network). */
function loadVendoredFonts(): void {
  if (VENDORED_FONTS.length === 0) {
    // eslint-disable-next-line no-console
    console.warn("[fonts] VENDORED_FONTS is empty — run `npm run vendor-fonts`");
    return;
  }
  // No FontFace (Node/vitest) → inert.
  if (typeof FontFace === "undefined" || typeof document === "undefined") return;

  for (const font of VENDORED_FONTS) {
    const handle = delayRender(`Loading vendored font ${font.family} ${font.weight} ${font.subset}`);
    try {
      const face = new FontFace(font.family, `url(${font.dataUrl}) format('woff2')`, {
        weight: font.weight,
        style: font.style,
        unicodeRange: font.unicodeRange,
      });
      face
        .load()
        .then((loaded) => {
          document.fonts.add(loaded);
        })
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.warn(
            `[fonts] vendored ${font.family} ${font.weight}/${font.subset} failed to load (using stack fallback):`,
            err,
          );
        })
        .finally(() => {
          continueRender(handle);
        });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[fonts] vendored ${font.family} ${font.weight}/${font.subset} could not be constructed (using stack fallback):`,
        err,
      );
      continueRender(handle);
    }
  }
}

// Importing this module (side-effect) triggers the loads.
loadVendoredFonts();

/** Loaded family names — MUST match the neutral render theme font stacks. */
export const LOADED_FONT_FAMILIES = {
  display: "Inter",
  bodyPremium: "Be Vietnam Pro",
  mono: "Cascadia Mono",
} as const;

/** One loaded font's Vietnamese-coverage status (for the doctor font check). */
export type FontCoverage = { family: string; hasVietnamese: boolean };

/**
 * Report whether each loaded render font ships the `vietnamese` subset.
 * Coverage is verified from the vendored manifest only.
 */
export function fontCoverageReport(): FontCoverage[] {
  const hasViet = (family: string) =>
    VENDORED_FONTS.some((f) => f.family === family && f.subset === "vietnamese");
  return [
    { family: LOADED_FONT_FAMILIES.display, hasVietnamese: hasViet(LOADED_FONT_FAMILIES.display) },
    { family: LOADED_FONT_FAMILIES.bodyPremium, hasVietnamese: hasViet(LOADED_FONT_FAMILIES.bodyPremium) },
    { family: LOADED_FONT_FAMILIES.mono, hasVietnamese: hasViet(LOADED_FONT_FAMILIES.mono) },
  ];
}
