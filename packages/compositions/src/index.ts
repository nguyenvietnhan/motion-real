/**
 * @news/compositions — the registry + master composition layer (pure AUTHOR
 * mode). This package NO LONGER ships built-in scene templates: importing it
 * registers nothing. The registry is populated only by AI-AUTHORED scene
 * modules that self-register inside the generated Remotion entry after passing
 * the host-side AST admission gate, and the master `VideoComposition` renders
 * whatever the project's locked spec references.
 *
 * Reusable, slot-based layout blocks live in `@news/blocks`; authored scenes
 * compose those for structure and author bespoke code for imagery.
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

// Per-project theme propagation (re-exported from @news/blocks; one shared context):
export { ThemeProvider, useTheme } from "./theme-context.js";

// The single sanctioned image block, re-exported so an authored scene can reach
// it WITHOUT importing @news/blocks (which is no longer on the authored-import
// whitelist — the layout blocks were deleted, but the user/crawled-image feature
// must keep working). An authored scene writes `import { SceneImage } from
// "@news/compositions"`.
export { SceneImage } from "@news/blocks";

// Master composition:
export { VideoComposition, SceneContent, MissingComponent, type VideoCompositionProps } from "./video.js";

// Thumbnail / cover composition (format-aware single still; freeform-engine R12, I3):
export { ThumbnailComposition, ThumbnailPropsSchema, type ThumbnailProps } from "./thumbnail.js";
