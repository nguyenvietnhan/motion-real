/**
 * @news/compositions — the registry + master composition layer (pure AUTHOR
 * mode). This package NO LONGER ships built-in scene templates: importing it
 * registers nothing. The registry is populated only by AI-AUTHORED scene
 * modules that self-register after passing the admission gate
 * (`@news/pipeline` admit + register), and the master `VideoComposition`
 * renders whatever the project's locked spec references.
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

// Master composition:
export { VideoComposition, SceneContent, MissingComponent, type VideoCompositionProps } from "./video.js";
