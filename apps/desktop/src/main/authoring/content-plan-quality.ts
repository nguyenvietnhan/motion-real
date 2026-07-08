import type { PacingBudget } from "./pacing-policy.js";
import { countWords } from "./pacing-policy.js";
import type { ContentPlan } from "./content-plan-schema.js";
import { hasConcreteFact, hasGenericMotionIntent } from "./content-plan-normalize.js";

export type ContentPlanQualityCheck =
  | "hook"
  | "viewer-promise"
  | "payoff"
  | "claim-ledger"
  | "pacing"
  | "layout-diversity"
  | "motion-progression";
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

function contentPlanQualitySeverity(check: ContentPlanQualityCheck): ContentPlanQualitySeverity {
  return check === "layout-diversity" || check === "motion-progression" ? "advisory" : "blocking";
}

/**
 * Deterministic local review for content planning. Blocking issues protect
 * factual safety and pacing; advisory issues are fed into TSX authoring instead
 * of stopping creative plans before visual code exists.
 */
export function evaluateContentPlanQuality(plan: ContentPlan, pacing?: PacingBudget): ContentPlanQualityResult {
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
