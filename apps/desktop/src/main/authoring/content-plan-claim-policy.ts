/**
 * Pure claim-provenance recovery for URL-grounded content plans.
 * Quality and demote share provenanceVerdict (content-plan-provenance.ts).
 */

import type { ContentPlan } from "./content-plan-schema.js";
import {
  evaluateContentPlanQuality,
  type ContentPlanQualityOptions,
  type ContentPlanQualityIssue,
  type ContentPlanQualityResult,
} from "./content-plan-quality.js";
import type { ResearchSource } from "./content-evidence.js";
import type { PacingBudget } from "./pacing-policy.js";
import { provenanceVerdict, shouldDemoteForProvenance } from "./content-plan-provenance.js";

export {
  provenanceVerdict,
  provenanceQualityMessages,
  shouldDemoteForProvenance,
  type ProvenanceProblem,
} from "./content-plan-provenance.js";

/**
 * Deterministic recovery: unusable source_material claims become omit/uncertain
 * and are stripped from scene evidenceClaimIds. Does not invent excerpts.
 */
export function demoteInvalidProvenanceClaims(
  plan: ContentPlan,
  sources: readonly ResearchSource[],
): { plan: ContentPlan; demotedClaimIds: string[] } {
  const demotedClaimIds: string[] = [];
  const claims = plan.claims.map((claim) => {
    const problem = provenanceVerdict(claim, sources);
    if (!shouldDemoteForProvenance(problem)) return claim;
    demotedClaimIds.push(claim.id);
    return { ...claim, confidence: "uncertain" as const, action: "omit" as const, sourceRef: undefined };
  });
  if (demotedClaimIds.length === 0) return { plan, demotedClaimIds };
  const demoted = new Set(demotedClaimIds);
  return {
    demotedClaimIds,
    plan: {
      ...plan,
      claims,
      scenes: plan.scenes.map((scene) => ({
        ...scene,
        evidenceClaimIds: scene.evidenceClaimIds.filter((id) => !demoted.has(id)),
      })),
    },
  };
}

function softenBlockingChecks(
  quality: ContentPlanQualityResult,
  check: ContentPlanQualityIssue["check"],
  reason: string,
): ContentPlanQualityResult {
  const issues = quality.issues.map((issue) =>
    issue.check === check && issue.severity === "blocking"
      ? {
          ...issue,
          severity: "advisory" as const,
          message: `${issue.message} (${reason})`,
        }
      : issue,
  );
  return {
    issues,
    blockingIssues: issues.filter((issue) => issue.severity === "blocking"),
    advisoryIssues: issues.filter((issue) => issue.severity === "advisory"),
  };
}

/**
 * Deterministic recovery for URL-grounded plans (`sources` provided, including []).
 *
 * Order (never invents excerpts):
 * 1. Demote unusable source_material claims.
 * 2. Re-evaluate.
 * 3. If *only* claim-ledger remains blocking → advisory (after one optional AI repair
 *    attempt at the call site). Other blockers stay hard.
 *
 * Text-only (`sources === undefined`) must not call this for softening; caller skips.
 */
export function finalizeAfterClaimRepair(
  plan: ContentPlan,
  sources: readonly ResearchSource[] | undefined,
  pacing?: PacingBudget,
  qualityOptions?: ContentPlanQualityOptions,
): {
  plan: ContentPlan;
  quality: ContentPlanQualityResult;
  demotedClaimIds: string[];
  softenedClaimLedger: boolean;
} {
  if (sources === undefined) {
    return {
      plan,
      quality: evaluateContentPlanQuality(plan, pacing, sources, qualityOptions),
      demotedClaimIds: [],
      softenedClaimLedger: false,
    };
  }

  const demoted = demoteInvalidProvenanceClaims(plan, sources);
  const nextPlan = demoted.demotedClaimIds.length > 0 ? demoted.plan : plan;
  let quality = evaluateContentPlanQuality(nextPlan, pacing, sources, qualityOptions);
  let softenedClaimLedger = false;

  if (
    quality.blockingIssues.length > 0 &&
    quality.blockingIssues.every((issue) => issue.check === "claim-ledger")
  ) {
    quality = softenBlockingChecks(
      quality,
      "claim-ledger",
      demoted.demotedClaimIds.length > 0
        ? "advisory after demoting unusable source claims"
        : "advisory after claim repair (no inventing evidence)",
    );
    softenedClaimLedger = true;
  }

  return {
    plan: nextPlan,
    quality,
    demotedClaimIds: demoted.demotedClaimIds,
    softenedClaimLedger,
  };
}
