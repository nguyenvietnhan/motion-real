/**
 * Single provenance decision for content-plan claims.
 * Shared by quality evaluation and demote recovery so rules cannot drift.
 */

import type { ContentPlanClaim } from "./content-plan-schema.js";
import { excerptMatchesSource, type ResearchSource } from "./content-evidence.js";

export type ProvenanceProblem =
  | { kind: "ok" }
  | { kind: "no-readable-sources" }
  | { kind: "missing-source-ref" }
  | { kind: "unknown-source"; sourceId: string }
  | { kind: "excerpt-mismatch"; sourceId: string }
  | { kind: "spurious-source-ref"; support: "user_brief" | "common_knowledge" };

/**
 * Single provenance decision for one claim when sources is defined (including []).
 * When sources is undefined, returns ok (caller skips provenance enforcement).
 */
export function provenanceVerdict(
  claim: ContentPlanClaim,
  sources: readonly ResearchSource[] | undefined,
): ProvenanceProblem {
  if (sources === undefined) return { kind: "ok" };

  if ((claim.support === "user_brief" || claim.support === "common_knowledge") && claim.sourceRef) {
    return { kind: "spurious-source-ref", support: claim.support };
  }

  const usable = claim.confidence === "supported" && claim.action === "use";
  if (!usable || claim.support !== "source_material") return { kind: "ok" };

  if (sources.length === 0) return { kind: "no-readable-sources" };
  if (!claim.sourceRef) return { kind: "missing-source-ref" };

  const sourceId = claim.sourceRef.sourceId;
  const src = sources.find((s) => s.id === sourceId);
  if (!src) return { kind: "unknown-source", sourceId };
  if (!excerptMatchesSource(claim.sourceRef.excerpt, src.body)) {
    return { kind: "excerpt-mismatch", sourceId };
  }
  return { kind: "ok" };
}

/** True when demote should omit this usable source_material claim. */
export function shouldDemoteForProvenance(problem: ProvenanceProblem): boolean {
  return (
    problem.kind === "no-readable-sources" ||
    problem.kind === "missing-source-ref" ||
    problem.kind === "unknown-source" ||
    problem.kind === "excerpt-mismatch"
  );
}

/**
 * Map a provenance problem to quality issue messages (identical to historical copy).
 * May return 0–2 issues (empty sources + present sourceRef yields two).
 */
export function provenanceQualityMessages(
  claim: ContentPlanClaim,
  problem: ProvenanceProblem,
): Array<{ check: "claim-provenance"; message: string }> {
  switch (problem.kind) {
    case "ok":
      return [];
    case "no-readable-sources": {
      const msgs: Array<{ check: "claim-provenance"; message: string }> = [
        {
          check: "claim-provenance",
          message: `usable source_material claim ${claim.id} has no readable sources; use user_brief/common_knowledge or omit`,
        },
      ];
      if (claim.sourceRef) {
        msgs.push({
          check: "claim-provenance",
          message: `claim ${claim.id} cannot cite a source when no readable sources exist`,
        });
      }
      return msgs;
    }
    case "missing-source-ref":
      return [
        {
          check: "claim-provenance",
          message: `usable source_material claim ${claim.id} requires sourceRef`,
        },
      ];
    case "unknown-source":
      return [
        {
          check: "claim-provenance",
          message: `claim ${claim.id} references unknown source ${problem.sourceId}`,
        },
      ];
    case "excerpt-mismatch":
      return [
        {
          check: "claim-provenance",
          message: `claim ${claim.id} excerpt does not match source ${problem.sourceId}`,
        },
      ];
    case "spurious-source-ref":
      return [
        {
          check: "claim-provenance",
          message: `claim ${claim.id} with support ${problem.support} must not carry sourceRef`,
        },
      ];
  }
}
