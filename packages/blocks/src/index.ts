/**
 * @motionreal/blocks — render RUNTIME internals + SceneImage implementation.
 *
 * Not on the authored-import whitelist (admission N4). Authored scenes write
 * bespoke JSX/SVG and import only `react`, `remotion`, `@motionreal/compositions`,
 * and `zod`. This barrel is the small runtime `@motionreal/compositions` consumes
 * — theme context, scene timing, motion hooks, captions, fonts, layout probe —
 * plus `SceneImage` (authored code reaches it only via the compositions re-export).
 */

// Theme context (the single shared runtime instance; consumed by compositions internally):
export { ThemeProvider, useTheme } from "./theme-context.js";

// Per-scene timing context (wraps each scene so effects can sync to scene end):
export { SceneTimingProvider, useSceneDurationInFrames } from "./scene-timing.js";

// Motion helpers (fps-aware; deterministic, frame-pure):
export {
  bezier,
  easeOut,
  frameRamp,
  useReveal,
  useFrameScale,
  useSceneProgress,
  useApproxSceneProgress,
  useExactSceneProgress,
  useIntroZoom,
} from "./motion.js";

// Single sanctioned image block (the ONLY way an authored scene shows an image;
// authored code is banned from raw Img/staticFile — see admission N5). Authored
// scenes import it from @motionreal/compositions, which re-exports it.
export { SceneImage } from "./scene-image.js";

// Caption track (used by the master composition, not authored scenes):
export { Captions, CAPTION_RENDER_BAND, CAPTION_CANVAS } from "./captions.js";

// Surface-kit: runtime chrome helpers read border/radius/fill/shadow/chip from
// the resolved theme tokens:
export {
  surfaceBorder,
  surfaceRadius,
} from "./chrome.js";

// Render-safe font loading + Vietnamese-coverage report (for the doctor check):
export { LOADED_FONT_FAMILIES, fontCoverageReport, type FontCoverage } from "./fonts.js";

// Deterministic layout measurement (N15/N17): the probe + its attr/artifact
// contract, mounted only inside the dedicated measure composition.
export {
  LayoutProbe,
  NRT_BLOCK_ATTR,
  LAYOUT_ARTIFACT_NAME,
  type MeasuredBlock,
  type LayoutMeasurement,
} from "./layout-probe.js";
