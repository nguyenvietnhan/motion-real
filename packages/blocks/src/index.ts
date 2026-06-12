/**
 * @news/blocks — reusable, slot-based, theme-aware layout blocks.
 *
 * Blocks are EMPTY themed containers the authoring AI fills — never content
 * templates. They are squared (no rounded corners), each renders as a clearly
 * delineated unit, keep content inside the content zone, and contain no banned
 * APIs (pure functions of the frame). Authored scenes compose these for text /
 * structure and author bespoke code only for imagery (R2, R17, R18).
 */

// Theme context (the single shared instance; re-exported by @news/compositions):
export { ThemeProvider, useTheme } from "./theme-context.js";

// Per-scene timing context (wraps each scene so effects can sync to scene end):
export { SceneTimingProvider, useSceneDurationInFrames } from "./scene-timing.js";

// Motion helpers (fps-aware; deterministic, frame-pure):
export {
  bezier,
  easeOut,
  frameRamp,
  useReveal,
  useRamp,
  useFrameScale,
  useSceneProgress,
  useApproxSceneProgress,
  useExactSceneProgress,
  useTilt,
  useKenBurnsScale,
  useIntroZoom,
  usePop,
} from "./motion.js";

// Frame + content column (content-zone constrained):
export { Frame, Content } from "./frame.js";

// Single sanctioned image block (the ONLY way an authored scene shows an image;
// authored code is banned from raw Img/staticFile — see admission N5):
export { SceneImage } from "./scene-image.js";

// Text blocks:
export { TitleBlock, IdeaPanel, Callout } from "./text.js";

// Data blocks:
export { KeyPoints, StatChip } from "./data.js";

// Editorial "boxed" blocks + authored-viz primitives (header bar, framed panels,
// tags, footer, big stat, count-up number, bar chart, full-frame Story):
export {
  HeaderBar,
  Panel,
  Tag,
  Footer,
  StatBlock,
  CountUp,
  BarChart,
  Story,
  type Tone,
} from "./editorial.js";

// Caption track (used by the master composition, not authored scenes):
export { Captions, CAPTION_RENDER_BAND, CAPTION_CANVAS } from "./captions.js";

// Surface-kit: language-driven chrome helpers (blocks + authored scenes read
// border/radius/fill/shadow/chip from the resolved theme tokens):
export {
  surfaceBorder,
  surfaceBorderWidth,
  innerDivider,
  surfaceRadius,
  surfaceShadow,
  blockSurface,
  topRuleStyle,
  chipStyle,
  labelStyle,
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
