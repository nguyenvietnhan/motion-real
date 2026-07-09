/**
 * Typed authoring failure classes for structured logs.
 * Keeps existing log message strings for grep/test continuity while always
 * attaching `failureClass` for filtering.
 */

export type AuthoringFailureClass =
  | "content-plan-parse"
  | "content-plan-repair"
  | "content-plan-quality"
  | "content-plan-provider"
  | "author-reply-parse"
  | "author-reply-provider"
  | "author-batch-parse"
  | "author-batch-provider"
  | "missing-tsx-recovery"
  | "admission"
  | "reauthor-parse"
  | "reauthor-provider"
  | "image-filter-parse"
  | "image-filter-provider"
  | "visual-qa-parse"
  | "visual-qa-provider";

export type AuthoringFailureEvent = {
  class: AuthoringFailureClass;
  projectId?: string;
  reason?: string;
  detail?: string;
  violationCounts?: Record<string, number>;
  parseSummary?: unknown;
  [key: string]: unknown;
};

type FailureLogger = {
  error: (obj: object, msg: string) => void;
  warn?: (obj: object, msg: string) => void;
};

/**
 * Emit a structured authoring failure. Preserves `message` exactly so existing
 * log anchors and tests keep matching.
 */
export function logAuthoringFailure(
  logger: FailureLogger,
  event: AuthoringFailureEvent,
  message: string,
  level: "error" | "warn" = "error",
): void {
  const { class: failureClass, ...rest } = event;
  const payload = { failureClass, ...rest };
  if (level === "warn" && logger.warn) {
    logger.warn(payload, message);
    return;
  }
  logger.error(payload, message);
}
