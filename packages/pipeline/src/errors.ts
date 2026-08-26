import type { Severity } from "./types.js";
import type { VoiceProviderFailure } from "@motionreal/tts";

/**
 * Structured, surface-agnostic pipeline errors.
 *
 * One error vocabulary for CLI, in-process `createTools`, desktop, and bulk:
 * failing STAGE, specific CAUSE, safety-check id when a grid check tripped,
 * affected scene id when applicable, hard-vs-advisory SEVERITY, and a known
 * REMEDIATION. Callers serialize the same object for their transport — there is
 * no second, surface-specific error path.
 */

/** The pipeline stage a failure originates from. */
export type PipelineStage =
  | "ingest"
  | "admission"
  | "static-grid"
  | "build-gate"
  | "determinism"
  | "render-lock"
  | "render"
  | "render-oracle"
  | "review"
  | "tts"
  | "config";

/** Plain, JSON-serializable form for tools/IPC/CLI JSON output. */
export type SerializedPipelineError = {
  /** Human-readable one-line message (stage + cause [+ check/scene]). */
  message: string;
  stage: PipelineStage;
  /** The specific cause of the failure. */
  cause: string;
  /** Safety-check id when a grid check tripped, e.g. "N9", "N14". */
  check?: string;
  /** Affected scene id when applicable. */
  sceneId?: string;
  /** Known remediation step when one exists. */
  remediation?: string;
  /** Hard error (blocks) vs advisory warning. */
  severity: Severity;
  voiceFailure?: VoiceProviderFailure;
};

export type PipelineErrorInit = {
  stage: PipelineStage;
  cause: string;
  check?: string;
  sceneId?: string;
  remediation?: string;
  /** Defaults to "error" (hard, blocking). */
  severity?: Severity;
  voiceFailure?: VoiceProviderFailure;
};

/** Compose the one-line message: `[stage] cause (check, sceneId)`. */
function buildMessage(init: PipelineErrorInit): string {
  const tags = [init.check, init.sceneId].filter(Boolean).join(", ");
  const suffix = tags ? ` (${tags})` : "";
  return `[${init.stage}] ${init.cause}${suffix}`;
}

/**
 * A failure tagged with its pipeline stage and (when relevant) the safety-check
 * id + affected scene. Identified by the technical check id ONLY — it does not
 * embed a verbose description of the check's purpose; remediation, when known,
 * lives in the separate `remediation` field.
 */
export class PipelineError extends Error {
  readonly stage: PipelineStage;
  /** The specific cause (kept as a string; coincides with the built-in `Error.cause`). */
  override readonly cause: string;
  readonly check?: string;
  readonly sceneId?: string;
  readonly remediation?: string;
  readonly severity: Severity;
  readonly voiceFailure?: VoiceProviderFailure;

  constructor(init: PipelineErrorInit) {
    super(buildMessage(init));
    this.name = "PipelineError";
    this.stage = init.stage;
    this.cause = init.cause;
    this.check = init.check;
    this.sceneId = init.sceneId;
    this.remediation = init.remediation;
    this.severity = init.severity ?? "error";
    this.voiceFailure = init.voiceFailure;
  }

  /** Structured form for transport (identical detail to the CLI text). */
  toSerialized(): SerializedPipelineError {
    return {
      message: this.message,
      stage: this.stage,
      cause: this.cause,
      ...(this.check !== undefined ? { check: this.check } : {}),
      ...(this.sceneId !== undefined ? { sceneId: this.sceneId } : {}),
      ...(this.remediation !== undefined ? { remediation: this.remediation } : {}),
      severity: this.severity,
      ...(this.voiceFailure !== undefined ? { voiceFailure: this.voiceFailure } : {}),
    };
  }
}

/** Type guard: is this value a PipelineError? */
export function isPipelineError(value: unknown): value is PipelineError {
  return value instanceof PipelineError;
}

/**
 * A render aborted on purpose by the user ("Dừng render"), NOT a failure. Thrown
 * when the caller's AbortSignal fires mid-render so every layer can tell an
 * intentional stop apart from a real error: the project state is left untouched
 * (no `state: "failed"` bookkeeping) and the UI returns to its prior reviewable
 * stage instead of an error screen.
 */
export class RenderCancelledError extends Error {
  constructor(message = "render cancelled by user") {
    super(message);
    this.name = "RenderCancelledError";
  }
}

/** Type guard: was this thrown because the user cancelled the render? */
export function isRenderCancelledError(value: unknown): value is RenderCancelledError {
  return value instanceof RenderCancelledError;
}

/**
 * Normalize any thrown value into a SerializedPipelineError so a surface always
 * has the structured shape. A raw (non-pipeline) error is wrapped as a generic
 * failure at the given fallback stage.
 */
export function serializeError(value: unknown, fallbackStage: PipelineStage = "config"): SerializedPipelineError {
  if (isPipelineError(value)) return value.toSerialized();
  const cause = value instanceof Error ? value.message : String(value);
  return { message: `[${fallbackStage}] ${cause}`, stage: fallbackStage, cause, severity: "error" };
}
