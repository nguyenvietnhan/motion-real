import { continueRender, delayRender } from "remotion";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadBeVietnamPro } from "@remotion/google-fonts/BeVietnamPro";
import { loadFont as loadCascadiaMono } from "@remotion/google-fonts/CascadiaMono";
import { getInfo as interInfo } from "@remotion/google-fonts/Inter";
import { getInfo as bvpInfo } from "@remotion/google-fonts/BeVietnamPro";
import { getInfo as cascadiaInfo } from "@remotion/google-fonts/CascadiaMono";
import { VENDORED_FONTS } from "./vendor-fonts.generated.js";

/**
 * Render-safe font loading (tool-productization R1, Property 19).
 *
 * Every style-pack font must be present with the **vietnamese** subset so a
 * Vietnamese diacritic never falls back to a system face ("nét to nét nhỏ").
 *
 * STRATEGY — self-hosted first, never fatal:
 *  1. Primary path: fonts are VENDORED as base64 woff2 data URLs
 *     (`vendor-fonts.generated.ts`, produced by `scripts/vendor-fonts.ts`) and
 *     registered via `FontFace` with NO network. This removes the live
 *     `fonts.gstatic.com` fetch from the render hot path — the source of the
 *     intermittent "Timed out loading Google Font" render failures, which are a
 *     network problem unrelated to the video's content.
 *  2. The registration is wrapped in `delayRender`/`continueRender` but is
 *     NON-FATAL: if a face fails to parse/load we still `continueRender` (and
 *     swallow the error) so a cosmetic font issue can NEVER kill an otherwise
 *     valid render — at worst the text uses the next family in the CSS stack.
 *  3. Fallback: if the vendored manifest is empty (fonts were never vendored),
 *     fall back to the original `@remotion/google-fonts` network loads so the
 *     app still works — just with the old network dependency.
 *
 * `fonts.ts` runs in BOTH Node (vitest, via `@news/blocks`) and the browser. A
 * data: URL is a plain string and `FontFace` is guarded on `typeof`, so this
 * module is inert in Node and real in the browser.
 *
 * Family map: Inter (bold-editorial display/body), Be Vietnam Pro (galaxy
 * display/body), Cascadia Mono (both packs' mono labels) — all Vietnamese-complete.
 */

/** Register the vendored faces locally (no network). Returns false if nothing was vendored. */
function loadVendoredFonts(): boolean {
  if (VENDORED_FONTS.length === 0) return false;
  // No FontFace (Node/vitest) → inert, but report success so we don't hit the
  // network fallback in a non-browser context.
  if (typeof FontFace === "undefined" || typeof document === "undefined") return true;

  for (const font of VENDORED_FONTS) {
    // Each face gets its own delayRender handle so the render waits for the
    // (instant, local) load — but every exit path calls continueRender, so a
    // bad face can never leave the render hanging or throw.
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
          // Non-fatal: a cosmetic font miss must not fail the render.
          // eslint-disable-next-line no-console
          console.warn(`[fonts] vendored ${font.family} ${font.weight}/${font.subset} failed to load (using stack fallback):`, err);
        })
        .finally(() => {
          continueRender(handle);
        });
    } catch (err) {
      // Synchronous construction failure (malformed data URL, bad descriptor) —
      // also non-fatal.
      // eslint-disable-next-line no-console
      console.warn(`[fonts] vendored ${font.family} ${font.weight}/${font.subset} could not be constructed (using stack fallback):`, err);
      continueRender(handle);
    }
  }
  return true;
}

/** Original network loads — only used when nothing was vendored. */
function loadNetworkFonts(): void {
  loadInter("normal", { weights: ["400", "700", "800", "900"], subsets: ["vietnamese", "latin"] });
  loadBeVietnamPro("normal", { weights: ["400", "600", "700", "800", "900"], subsets: ["vietnamese", "latin"] });
  loadCascadiaMono("normal", { weights: ["400", "700"], subsets: ["vietnamese", "latin"] });
}

// Importing this module (side-effect) triggers the loads; `Frame` imports it so
// every render tree pulls the fonts in.
if (!loadVendoredFonts()) {
  loadNetworkFonts();
}

/** Loaded family names — MUST match the style packs' `fontFamily` stacks. */
export const LOADED_FONT_FAMILIES = {
  display: "Inter",
  bodyPremium: "Be Vietnam Pro",
  mono: "Cascadia Mono",
} as const;

/** One loaded font's Vietnamese-coverage status (for the doctor font check). */
export type FontCoverage = { family: string; hasVietnamese: boolean };

/**
 * Report whether each loaded style-pack font ships the `vietnamese` subset — the
 * coverage that prevents diacritic fallback ("nét to nét nhỏ"). Used by the
 * doctor font-coverage check (tool-productization R6 / design §6). When fonts are
 * vendored, coverage is verified from the manifest; otherwise from the google-fonts
 * metadata. Both must report the vietnamese subset for the three families.
 */
export function fontCoverageReport(): FontCoverage[] {
  if (VENDORED_FONTS.length > 0) {
    const hasViet = (family: string) =>
      VENDORED_FONTS.some((f) => f.family === family && f.subset === "vietnamese");
    return [
      { family: "Inter", hasVietnamese: hasViet("Inter") },
      { family: "Be Vietnam Pro", hasVietnamese: hasViet("Be Vietnam Pro") },
      { family: "Cascadia Mono", hasVietnamese: hasViet("Cascadia Mono") },
    ];
  }
  return [
    { family: "Inter", hasVietnamese: interInfo().subsets.includes("vietnamese") },
    { family: "Be Vietnam Pro", hasVietnamese: bvpInfo().subsets.includes("vietnamese") },
    { family: "Cascadia Mono", hasVietnamese: cascadiaInfo().subsets.includes("vietnamese") },
  ];
}
