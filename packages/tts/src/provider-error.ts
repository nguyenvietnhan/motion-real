import type { VoiceProvider } from "./types.js";

export type VoiceProviderFailureCode =
  | "not_configured"
  | "invalid_api_key"
  | "insufficient_credits"
  | "plan_required"
  | "rate_limited"
  | "voice_not_found"
  | "invalid_request"
  | "provider_unavailable"
  | "unknown";

export type VoiceProviderFailure = {
  provider: VoiceProvider;
  code: VoiceProviderFailureCode;
  retryable: boolean;
  retryAfterMs?: number;
};

export class VoiceProviderError extends Error {
  readonly failure: VoiceProviderFailure;

  constructor(failure: VoiceProviderFailure, safeMessage?: string) {
    super(safeMessage ?? `${failure.provider} voice provider failed: ${failure.code}`);
    this.name = "VoiceProviderError";
    this.failure = failure;
  }
}

export function isVoiceProviderError(value: unknown): value is VoiceProviderError {
  return value instanceof VoiceProviderError;
}

export function asVoiceProviderError(
  provider: VoiceProvider,
  value: unknown,
): VoiceProviderError {
  if (isVoiceProviderError(value)) return value;
  return new VoiceProviderError({ provider, code: "unknown", retryable: false });
}

/** Provider adapters pass only parsed error fields here; raw responses stay local. */
export function voiceProviderErrorFrom(
  provider: VoiceProvider,
  input: { status?: number; details?: unknown; retryAfterMs?: number },
): VoiceProviderError {
  const haystack = collectStrings(input.details).join(" ").toLowerCase();
  let code: VoiceProviderFailureCode;

  if (/insufficient_credits|quota_exceeded|insufficient quota|h[eế]t credit/.test(haystack)) {
    code = "insufficient_credits";
  } else if (/paid_plan_required|plan_required|payment_required|model_access_denied|authorization_error/.test(haystack)) {
    code = "plan_required";
  } else if (/invalid_api_key|authentication_error|invalid api key|unauthorized|missing api key/.test(haystack)) {
    code = "invalid_api_key";
  } else if (/voice_not_found|voice id.+(?:incorrect|invalid|not found)|invalid voice/.test(haystack)) {
    code = "voice_not_found";
  } else if (/rate_limit_exceeded|concurrent_limit_exceeded|too_many_concurrent_requests|system_busy|rate.limit/.test(haystack)) {
    code = "rate_limited";
  } else if (/service_unavailable|maintenance|temporarily unavailable/.test(haystack)) {
    code = "provider_unavailable";
  } else if (/invalid_request|validation_error|invalid_voice_settings|max_character_limit_exceeded/.test(haystack)) {
    code = "invalid_request";
  } else if (input.status === 401) {
    code = "invalid_api_key";
  } else if (input.status === 402) {
    code = "insufficient_credits";
  } else if (input.status === 429) {
    code = "rate_limited";
  } else if (input.status !== undefined && input.status >= 500) {
    code = "provider_unavailable";
  } else {
    code = "unknown";
  }

  const retryable = code === "rate_limited" || code === "provider_unavailable";
  return new VoiceProviderError({
    provider,
    code,
    retryable,
    ...(input.retryAfterMs !== undefined ? { retryAfterMs: input.retryAfterMs } : {}),
  });
}

export function retryAfterMs(response: Response): number | undefined {
  const raw = response.headers.get("retry-after")?.trim();
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => {
    if (item && typeof item === "object") return collectStrings(item);
    return /^(?:code|type|status|message|detail)$/i.test(key) ? collectStrings(item) : [];
  });
}
