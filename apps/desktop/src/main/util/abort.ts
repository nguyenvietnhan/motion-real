/**
 * Shared cancel helpers for desktop main-process authoring / workspace jobs.
 * Prefer these over ad-hoc `name === "AbortError"` checks and duplicated locals.
 */

/** True when an error is a user/job AbortError (not a generic failure). */
export function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { name?: string }).name === "AbortError");
}

/** Throw a named AbortError when the signal has already fired. */
export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const err = new Error("Operation aborted");
  err.name = "AbortError";
  throw err;
}

/** True when the signal is aborted or the error is an AbortError. */
export function isCancelled(signal?: AbortSignal, error?: unknown): boolean {
  if (signal?.aborted) return true;
  if (error !== undefined) return isAbortError(error);
  return false;
}
