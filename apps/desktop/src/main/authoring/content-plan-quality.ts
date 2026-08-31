import type { PacingBudget } from "./pacing-policy.js";
import { countWords } from "./pacing-policy.js";
import type { ContentPlan } from "./content-plan-schema.js";
import { hasConcreteFact, hasGenericMotionIntent } from "./content-plan-normalize.js";
import type { ResearchSource } from "./content-evidence.js";
import { provenanceQualityMessages, provenanceVerdict } from "./content-plan-provenance.js";

export type ContentPlanQualityCheck =
  | "hook"
  | "viewer-promise"
  | "payoff"
  | "claim-ledger"
  | "claim-provenance"
  | "pacing"
  | "layout-diversity"
  | "motion-progression"
  | "motion-beats"
  | "review-intent";
export type ContentPlanQualitySeverity = "blocking" | "advisory";
export type ContentPlanQualityIssue = {
  check: ContentPlanQualityCheck;
  severity: ContentPlanQualitySeverity;
  message: string;
  sceneId?: string;
};
export type ContentPlanQualityResult = {
  issues: ContentPlanQualityIssue[];
  blockingIssues: ContentPlanQualityIssue[];
  advisoryIssues: ContentPlanQualityIssue[];
};
export type ContentPlanQualityOptions = { requireReviewIntent?: boolean };

function contentPlanQualitySeverity(check: ContentPlanQualityCheck): ContentPlanQualitySeverity {
  return check === "layout-diversity" || check === "motion-progression" ? "advisory" : "blocking";
}

/**
 * Deterministic local review for content planning. Blocking issues protect
 * factual safety and pacing; advisory issues are fed into TSX authoring instead
 * of stopping creative plans before visual code exists.
 */
export function evaluateContentPlanQuality(
  plan: ContentPlan,
  pacing?: PacingBudget,
  /** When provided (including empty), enforce claim-provenance against readable sources. */
  sources?: readonly ResearchSource[],
  options?: ContentPlanQualityOptions,
): ContentPlanQualityResult {
  const issues: ContentPlanQualityIssue[] = [];
  const addIssue = (issue: Omit<ContentPlanQualityIssue, "severity">) => {
    issues.push({ ...issue, severity: contentPlanQualitySeverity(issue.check) });
  };
  if (plan.scenes[0]?.purpose !== "hook") {
    addIssue({ check: "hook", sceneId: plan.scenes[0]?.sceneId, message: "scene-01 must be the hook beat" });
  }
  if (plan.viewerPromise.trim().length === 0) {
    addIssue({ check: "viewer-promise", message: "viewerPromise is required" });
  }
  if (plan.payoff.trim().length === 0) {
    addIssue({ check: "payoff", message: "payoff is required" });
  }

  if (sources !== undefined) {
    for (const claim of plan.claims) {
      for (const msg of provenanceQualityMessages(claim, provenanceVerdict(claim, sources))) {
        addIssue(msg);
      }
    }
  }

  const hasReviewIntentContract = options?.requireReviewIntent === true
    || plan.scenes.some((scene) => scene.temporalMode !== undefined || scene.detailMode !== undefined);
  for (const scene of plan.scenes) {
    const sceneText = `${scene.beat}\n${scene.narration}\n${scene.onScreenText}`;
    if (hasConcreteFact(sceneText) && scene.evidenceClaimIds.length === 0) {
      addIssue({
        check: "claim-ledger",
        sceneId: scene.sceneId,
        message: "number/date/price/source-like claims must reference usable evidenceClaimIds",
      });
    }
    if (hasGenericMotionIntent(scene.motionProgression)) {
      addIssue({
        check: "motion-progression",
        sceneId: scene.sceneId,
        message: "motionProgression must describe a specific motion intent, not generic text/card appearance",
      });
    }
    if (/\bsemantic\s*:/iu.test(scene.motionProgression) && !scene.motionBeats) {
      addIssue({
        check: "motion-beats",
        sceneId: scene.sceneId,
        message: "semantic motionProgression requires 2-4 narration-anchored motionBeats",
      });
    }
    if (hasReviewIntentContract && (!scene.temporalMode || !scene.detailMode)) {
      addIssue({
        check: "review-intent",
        sceneId: scene.sceneId,
        message: "generated scenes must declare both temporalMode and detailMode",
      });
    } else if (scene.temporalMode === "static" && scene.motionBeats) {
      addIssue({
        check: "review-intent",
        sceneId: scene.sceneId,
        message: "static scenes must not declare motionBeats",
      });
    } else if ((scene.temporalMode === "stepped" || scene.temporalMode === "continuous") && !scene.motionBeats) {
      addIssue({
        check: "review-intent",
        sceneId: scene.sceneId,
        message: `${scene.temporalMode} scenes require 2-4 motionBeats`,
      });
    }
  }

  if (pacing?.enforceScenePacing && plan.scenes.length > 0) {
    const narrationWords = plan.scenes.map((scene) => ({ sceneId: scene.sceneId, words: countWords(scene.narration) }));
    const totalNarrationWords = narrationWords.reduce((sum, scene) => sum + scene.words, 0);
    const avgNarrationWords = totalNarrationWords / plan.scenes.length;

    if (plan.scenes.length < pacing.minScenes) {
      addIssue({
        check: "pacing",
        message: `${pacing.targetSeconds}s/${pacing.targetWords} words needs at least ${pacing.minScenes} scenes; got ${plan.scenes.length}`,
      });
    }
    if (plan.scenes.length > pacing.maxScenes) {
      addIssue({
        check: "pacing",
        message: `${pacing.targetSeconds}s target allows at most ${pacing.maxScenes} scenes; got ${plan.scenes.length} — merge beats or lengthen narration per scene`,
      });
    }
    if (totalNarrationWords < pacing.minTotalNarrationWords) {
      addIssue({
        check: "pacing",
        message:
          `total narration is ${totalNarrationWords} words, far below ~${pacing.targetWords} words for ${pacing.targetSeconds}s ` +
          `(minimum ${pacing.minTotalNarrationWords}). Lengthen spoken lines; do not only add empty/micro scenes.`,
      });
    }
    if (avgNarrationWords > pacing.maxAvgWordsPerScene) {
      addIssue({
        check: "pacing",
        message: `average narration is ${Math.round(avgNarrationWords)} words/scene; keep it at or below ${pacing.maxAvgWordsPerScene} by splitting beats`,
      });
    }
    for (const scene of narrationWords) {
      if (scene.words > pacing.maxSceneNarrationWords) {
        addIssue({
          check: "pacing",
          sceneId: scene.sceneId,
          message: `scene narration is ${scene.words} words; split or tighten scenes above ${pacing.maxSceneNarrationWords} words`,
        });
      }
    }
  }

  const layoutFamilies = new Set(plan.scenes.map((scene) => scene.layoutFamily));
  if (plan.scenes.length >= 3 && layoutFamilies.size < 2) {
    addIssue({ check: "layout-diversity", message: "plans with 3+ scenes should use at least 2 layout families unless intentionally formal" });
  }
  return {
    issues,
    blockingIssues: issues.filter((issue) => issue.severity === "blocking"),
    advisoryIssues: issues.filter((issue) => issue.severity === "advisory"),
  };
}
