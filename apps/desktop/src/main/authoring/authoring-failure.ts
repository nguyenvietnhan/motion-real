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

/** Safe payload for project diagnostics — enum class/level/project id only. */
export type SafeAuthoringDiagnostic = {
  type: "authoring.failure";
  failureClass: AuthoringFailureClass;
  level: "warning" | "error";
  projectId?: string;
};

type FailureLogger = {
  error: (obj: object, msg: string) => void;
  warn?: (obj: object, msg: string) => void;
};

export type AuthoringDiagnosticObserver = (payload: SafeAuthoringDiagnostic) => void;

let diagnosticObserver: AuthoringDiagnosticObserver | undefined;

/** Optional non-blocking fan-out for project diagnostics (never blocks authoring). */
export function setAuthoringDiagnosticObserver(observer: AuthoringDiagnosticObserver | undefined): void {
  diagnosticObserver = observer;
}

export function safeAuthoringDiagnostic(
  event: AuthoringFailureEvent,
  level: "error" | "warn",
): SafeAuthoringDiagnostic {
  return {
    type: "authoring.failure",
    failureClass: event.class,
    level: level === "warn" ? "warning" : "error",
    ...(typeof event.projectId === "string" && event.projectId.trim()
      ? { projectId: event.projectId.trim() }
      : {}),
  };
}

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
  } else {
    logger.error(payload, message);
  }
  if (diagnosticObserver) {
    try {
      diagnosticObserver(safeAuthoringDiagnostic(event, level));
    } catch (_observerError) {
      // observability must never block authoring
    }
  }
}
