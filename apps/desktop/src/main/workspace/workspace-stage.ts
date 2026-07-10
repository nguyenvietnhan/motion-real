import type { ProjectStage } from "../../shared/types.js";

/** Top-level workspace stage kind (phase lives inside writing/rendering). */
export type StageKind = ProjectStage["kind"];

export type StageKindOrNone = StageKind | "none";

export type StageKindTransitionClass = "documented" | "allowed-other" | "unknown";

/**
 * Stable stage identity for transition logging.
 * Ignores progress percent, still paths, notices, and media URLs so percent
 * ticks do not spam logs. Includes kind + phase + error retry + qa pass index.
 */
export function stageFingerprint(stage: ProjectStage | undefined): string {
  if (!stage) return "none";
  switch (stage.kind) {
    case "writing":
      return stage.phase ? `writing:${stage.phase}` : "writing";
    case "image-review":
      return "image-review";
    case "script":
      return "script";
    case "rendering": {
      const phase = stage.phase ?? "draft";
      if (phase === "qa" && stage.qaPass !== undefined) {
        return `rendering:qa:${stage.qaPass}${stage.qaTotal !== undefined ? `/${stage.qaTotal}` : ""}`;
      }
      return `rendering:${phase}`;
    }
    case "ready":
      return "ready";
    case "draft-recovery":
      return "draft-recovery";
    case "published":
      return "published";
    case "error":
      return stage.retry ? `error:${stage.retry}` : "error";
    default: {
      const _exhaustive: never = stage;
      return _exhaustive;
    }
  }
}

/** Whether a stage update should emit a transition log (kind/phase change only). */
export function shouldLogStageTransition(
  previous: ProjectStage | undefined,
  next: ProjectStage,
): boolean {
  return stageFingerprint(previous) !== stageFingerprint(next);
}

export function stageKindOf(stage: ProjectStage | undefined): StageKindOrNone {
  return stage?.kind ?? "none";
}

/**
 * Happy-path kind edges observed in production and controller code.
 * Phase changes within the same kind (writing:crawl→author, rendering:prepare→draft)
 * are not listed here — same-kind hops are always documented.
 */
export const DOCUMENTED_STAGE_KIND_EDGES: ReadonlyArray<readonly [StageKindOrNone, StageKind]> = [
  ["none", "writing"],
  ["writing", "image-review"],
  ["writing", "script"],
  ["image-review", "writing"],
  ["script", "rendering"],
  ["rendering", "ready"],
  ["rendering", "published"],
  ["ready", "rendering"],
] as const;

/**
 * Recovery, cancel, retry, and error edges that are valid but not the main
 * create→draft→full story.
 */
export const ALLOWED_OTHER_STAGE_KIND_EDGES: ReadonlyArray<readonly [StageKindOrNone, StageKind]> = [
  ["none", "script"],
  ["none", "ready"],
  ["none", "published"],
  ["none", "rendering"],
  ["none", "image-review"],
  ["none", "error"],
  ["writing", "error"],
  ["writing", "ready"],
  ["writing", "rendering"],
  ["image-review", "error"],
  ["image-review", "script"],
  ["script", "error"],
  ["script", "writing"],
  ["rendering", "error"],
  ["rendering", "script"],
  ["rendering", "writing"],
  ["ready", "error"],
  ["ready", "script"],
  ["ready", "writing"],
  ["error", "writing"],
  ["error", "rendering"],
  ["error", "script"],
  ["error", "ready"],
  ["error", "image-review"],
  ["published", "ready"],
  ["published", "rendering"],
  ["published", "writing"],
] as const;

const documentedSet = new Set(DOCUMENTED_STAGE_KIND_EDGES.map(([from, to]) => `${from}->${to}`));
const allowedOtherSet = new Set(ALLOWED_OTHER_STAGE_KIND_EDGES.map(([from, to]) => `${from}->${to}`));

/**
 * Classify a kind-level hop for docs/tests/debug.
 * Same-kind transitions (phase-only) are always "documented".
 * Unknown hops must not hard-fail production — log at debug only if wired.
 */
export function classifyStageKindTransition(
  from: StageKindOrNone,
  to: StageKind,
): StageKindTransitionClass {
  if (from === to) return "documented";
  const key = `${from}->${to}`;
  if (documentedSet.has(key)) return "documented";
  if (allowedOtherSet.has(key)) return "allowed-other";
  return "unknown";
}
