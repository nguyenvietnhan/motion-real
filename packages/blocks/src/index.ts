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

// Pack-driven chrome helpers (style packs read border/shadow from the theme):
export { chromeBorder, chromeBorderWidth, chromeShadow } from "./chrome.js";
