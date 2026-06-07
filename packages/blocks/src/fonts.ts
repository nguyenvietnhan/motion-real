import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadBeVietnamPro } from "@remotion/google-fonts/BeVietnamPro";
import { loadFont as loadCascadiaMono } from "@remotion/google-fonts/CascadiaMono";
import { getInfo as interInfo } from "@remotion/google-fonts/Inter";
import { getInfo as bvpInfo } from "@remotion/google-fonts/BeVietnamPro";
import { getInfo as cascadiaInfo } from "@remotion/google-fonts/CascadiaMono";

/**
 * Render-safe font loading (tool-productization R1, Property 19).
 *
 * Every style-pack font is loaded with the **vietnamese** subset (plus latin)
 * and the weights the design uses. `loadFont()` registers the `@font-face` and,
 * in the render/browser context, blocks the render via Remotion's `delayRender`
 * until the font is ready — so a Vietnamese diacritic NEVER falls back to a
 * system face ("nét to nét nhỏ"). In Node (vitest) there is no `FontFace`, so
 * these calls are inert. Importing this module (side-effect) triggers the loads;
 * `Frame` imports it so every render tree pulls the fonts in.
 *
 * Family map: Inter (bold-editorial display/body), Be Vietnam Pro (clean-premium
 * display/body), Cascadia Mono (both packs' mono labels) — all Vietnamese-complete.
 */
loadInter("normal", { weights: ["400", "700", "800", "900"], subsets: ["vietnamese", "latin"] });
loadBeVietnamPro("normal", { weights: ["400", "600", "700", "800", "900"], subsets: ["vietnamese", "latin"] });
loadCascadiaMono("normal", { weights: ["400", "700"], subsets: ["vietnamese", "latin"] });

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
 * doctor font-coverage check (tool-productization R6 / design §6).
 */
export function fontCoverageReport(): FontCoverage[] {
  return [
    { family: "Inter", hasVietnamese: interInfo().subsets.includes("vietnamese") },
    { family: "Be Vietnam Pro", hasVietnamese: bvpInfo().subsets.includes("vietnamese") },
    { family: "Cascadia Mono", hasVietnamese: cascadiaInfo().subsets.includes("vietnamese") },
  ];
}
