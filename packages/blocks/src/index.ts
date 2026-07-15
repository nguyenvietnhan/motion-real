/**
 * @motionreal/blocks — render RUNTIME internals + SceneImage implementation.
 *
 * Not on the authored-import whitelist (admission N4). Authored scenes write
 * bespoke JSX/SVG and import only `react`, `remotion`, `@motionreal/compositions`,
 * and `zod`. This barrel is the small runtime `@motionreal/compositions` consumes
 * — theme context, motion hooks, captions, fonts, layout probe — plus `SceneImage`
 * (authored code reaches it only via the compositions re-export).
 */

export { ThemeProvider, useTheme } from "./theme-context.js";

export {
  easeOut,
  useReveal,
  useIntroZoom,
} from "./motion.js";

export { SceneImage } from "./scene-image.js";

export { Captions, CAPTION_RENDER_BAND, CAPTION_CANVAS } from "./captions.js";

export { LOADED_FONT_FAMILIES, fontCoverageReport, type FontCoverage } from "./fonts.js";

export {
  LayoutProbe,
  NRT_BLOCK_ATTR,
  LAYOUT_ARTIFACT_NAME,
  type MeasuredBlock,
  type LayoutMeasurement,
} from "./layout-probe.js";
