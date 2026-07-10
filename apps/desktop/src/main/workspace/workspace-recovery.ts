/**
 * Pure artifact-first restart recovery decision (Phase 6).
 */

export type ArtifactHealth = "missing" | "invalid" | "healthy";

export type RecoveryFacts = {
  full: ArtifactHealth;
  draft: ArtifactHealth;
  manifest: "missing" | "unreadable" | { sceneCount: number; hasAnyStill: boolean };
};

export type RecoveryDecision =
  | { kind: "published" }
  | { kind: "ready" }
  | { kind: "draft-recovery" }
  | { kind: "script" }
  | { kind: "error"; reason: "empty" | "unreadable" };

/**
 * Derive the most useful safe stage from on-disk artifact health.
 * Safety-first: invalid MP4s never become authoritative.
 */
export function recoveryDecision(facts: RecoveryFacts): RecoveryDecision {
  if (facts.full === "healthy") return { kind: "published" };

  if (facts.manifest === "missing" || facts.manifest === "unreadable") {
    if (facts.draft === "healthy") return { kind: "draft-recovery" };
    return { kind: "error", reason: facts.manifest === "unreadable" ? "unreadable" : "empty" };
  }

  const { sceneCount, hasAnyStill } = facts.manifest;
  if (sceneCount === 0) {
    if (facts.draft === "healthy") return { kind: "draft-recovery" };
    return { kind: "error", reason: "empty" };
  }

  // Readable nonempty manifest:
  if (facts.draft === "healthy") return { kind: "ready" }; // draft wins even with zero stills
  if (hasAnyStill) return { kind: "ready" };
  return { kind: "script" };
}

export function isHealthyMediaFile(stat: { isFile: boolean; size: number } | null): ArtifactHealth {
  if (!stat || !stat.isFile || stat.size <= 0) return stat ? "invalid" : "missing";
  return "healthy";
}
