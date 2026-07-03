/**
 * @motionreal/compositions — the registry + master composition layer (pure AUTHOR
 * mode). This package NO LONGER ships built-in scene templates: importing it
 * registers nothing. The registry is populated only by AI-AUTHORED scene
 * modules that self-register inside the generated Remotion entry after passing
 * the host-side AST admission gate, and the master `VideoComposition` renders
 * whatever the project's locked spec references.
 *
 * `@motionreal/blocks` remains a render-runtime package for captions, timing, image
 * rendering, and chrome helpers. Authored scenes do not import it; they write
 * their own raw JSX/CSS/SVG and reach images only through the `SceneImage`
 * re-export below.
 */

// Registry + validation:
export {
  registerComponent,
  getComponent,
  unregisterComponent,
  listComponents,
  knownComponentIds,
  validateProps,
  type SceneComponentDefinition,
  type SceneComponentProps,
  type PropValidationIssue,
} from "./registry.js";

// Per-project theme propagation for the master composition/runtime layer:
export { ThemeProvider, useTheme } from "./theme-context.js";

// The single sanctioned image block, re-exported so an authored scene can reach
// it WITHOUT importing @motionreal/blocks (which is no longer on the authored-import
// whitelist — the layout blocks were deleted, but the user/crawled-image feature
// must keep working). An authored scene writes `import { SceneImage } from
// "@motionreal/compositions"`.
export { SceneImage } from "@motionreal/blocks";

// Master composition:
export { VideoComposition, SceneContent, MissingComponent, type VideoCompositionProps } from "./video.js";

// Thumbnail / cover composition (format-aware single still; freeform-engine R12, I3):
export { ThumbnailComposition, ThumbnailPropsSchema, type ThumbnailProps } from "./thumbnail.js";
