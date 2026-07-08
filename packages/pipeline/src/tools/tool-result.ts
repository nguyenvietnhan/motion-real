import type { SerializedPipelineError } from "../errors.js";

/**
 * The one result shape every engine tool returns.
 *
 * A discriminated union: success carries typed `data`; failure carries the
 * SAME structured `SerializedPipelineError` (stage/cause/check/sceneId/
 * remediation/severity) the CLI renders as text — there is no second,
 * surface-specific error path.
 */
export type ToolResult<T> = { ok: true; data: T } | { ok: false; error: SerializedPipelineError };

/** Wrap a value as a success result. */
export function ok<T>(data: T): ToolResult<T> {
  return { ok: true, data };
}

/** Wrap a serialized error as a failure result. */
export function err<T>(error: SerializedPipelineError): ToolResult<T> {
  return { ok: false, error };
}
