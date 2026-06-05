/**
 * @news/compositions — the diversity layer.
 *
 * Importing a scene module has the side effect of registering its component.
 * Add a new visual by creating `scenes/<id>.tsx` that calls registerComponent,
 * then exporting it here.
 */

// Scene components (registration side-effects):
export { heroAnnouncement } from "./scenes/hero-announcement.js";
export { priceSpotlight } from "./scenes/price-spotlight.js";
export { insightStack } from "./scenes/insight-stack.js";
export { finalCta } from "./scenes/final-cta.js";
export { quotePull } from "./scenes/quote-pull.js";
export { comparisonSplit } from "./scenes/comparison-split.js";
export { statGrid } from "./scenes/stat-grid.js";

// Registry + validation:
export {
  registerComponent,
  getComponent,
  listComponents,
  knownComponentIds,
  validateProps,
  type SceneComponentDefinition,
  type SceneComponentProps,
  type PropValidationIssue,
} from "./registry.js";

// Primitives (for authoring new scenes):
export {
  SceneFrame,
  Content,
  StoryHeader,
  VisualFrame,
  useSceneProgress,
  bezier,
  type SceneContext,
} from "./primitives.js";

// Master composition:
export { VideoComposition, type VideoCompositionProps } from "./video.js";
