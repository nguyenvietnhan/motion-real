export {
  ContentPlanClaimSchema,
  ContentPlanSceneSchema,
  ContentPlanSchema,
  PRESENTATION_PROFILE_VALUES,
  PresentationProfileSchema,
  ScenePurposeSchema,
  contentPlanForAuthoring,
  semanticMotionSceneIds,
  usableClaims,
} from "./content-plan-schema.js";
export type {
  ContentPlan,
  ContentPlanClaim,
  ContentPlanScene,
  ScenePurpose,
  SceneTemporalMode,
  SceneDetailMode,
  PresentationProfile,
} from "./content-plan-schema.js";
export { sceneReviewProfiles } from "./scene-review-profile.js";
export type { SceneReviewProfile } from "./scene-review-profile.js";

export type { ContentPlanNormalizationDiagnostic } from "./content-plan-normalize.js";

export { parseContentPlan } from "./content-plan-parser.js";
export type { ContentPlanParseResult } from "./content-plan-parser.js";

export { evaluateContentPlanQuality } from "./content-plan-quality.js";
export type {
  ContentPlanQualityCheck,
  ContentPlanQualityIssue,
  ContentPlanQualityOptions,
  ContentPlanQualityResult,
  ContentPlanQualitySeverity,
} from "./content-plan-quality.js";

export {
  buildContentPlanMessages,
  buildContentPlanRepairMessages,
} from "./content-plan-prompt.js";

import type { ContentPlan } from "./content-plan-schema.js";
import type { ContentPlanQualityIssue } from "./content-plan-quality.js";

/**
 * Production content-planning result: the authorable plan plus soft quality
 * advisories for TSX authoring. Both facades and persisted artifacts carry
 * this shape; legacy artifacts without advisories read back as empty.
 */
export type PlannedAuthoringContent = {
  contentPlan: ContentPlan;
  advisories: ContentPlanQualityIssue[];
};
