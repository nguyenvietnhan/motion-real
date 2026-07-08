import type { ProjectStage } from "../../shared/types.js";

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
