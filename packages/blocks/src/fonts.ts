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
 * Registration uses ONE `delayRender` for the whole batch and is NON-FATAL:
 * each face is capped with a short timeout; hang/fail never burns the full
 * browser `timeoutInMilliseconds` (~120s). Production incident (2026-07-16):
 * per-face delayRender + hung `FontFace.load()` on Inter 400 vietnamese killed
 * unattended full export twice after TTS/build/determinism had already passed.
 *
 * Family map: Inter (display/body), Be Vietnam Pro (alternate display/body),
 * Cascadia Mono (mono labels) — all Vietnamese-complete.
 */

/** Cap a single FontFace.load so a stuck face cannot hold the whole render. */
export const FONT_FACE_LOAD_MS = 8_000;

/** delayRender budget for the whole batch (must exceed parallel per-face cap). */
const VENDORED_FONTS_DELAY_MS = FONT_FACE_LOAD_MS + 4_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Register the vendored faces locally (no network). */
function loadVendoredFonts(): void {
  if (VENDORED_FONTS.length === 0) {
    // eslint-disable-next-line no-console
    console.warn("[fonts] VENDORED_FONTS is empty — run `npm run vendor-fonts`");
    return;
  }
  // No FontFace (Node/vitest) → inert.
  if (typeof FontFace === "undefined" || typeof document === "undefined") return;

  // One handle for all faces. 22 independent delayRenders meant one hung
  // FontFace.load() blocked full MP4 until BROWSER_TIMEOUT (~118s message).
  const handle = delayRender("Loading vendored fonts", {
    timeoutInMilliseconds: VENDORED_FONTS_DELAY_MS,
  });

  void (async () => {
    try {
      await Promise.all(
        VENDORED_FONTS.map(async (font) => {
          const label = `${font.family} ${font.weight} ${font.subset}`;
          try {
            const face = new FontFace(font.family, `url(${font.dataUrl}) format('woff2')`, {
              weight: font.weight,
              style: font.style,
              unicodeRange: font.unicodeRange,
            });
            const loaded = await withTimeout(face.load(), FONT_FACE_LOAD_MS, `vendored ${label}`);
            document.fonts.add(loaded);
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn(
              `[fonts] vendored ${label} failed to load (using stack fallback):`,
              err,
            );
          }
        }),
      );
    } finally {
      continueRender(handle);
    }
  })();
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
