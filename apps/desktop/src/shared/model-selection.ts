/**
 * Pure preferred-model decision helpers (no Electron/Node imports).
 * Restores a saved generation-model preference without silently falling back
 * when that model is no longer listed by the gateway.
 */

/** Cap for a persisted model id — modest enough to reject arbitrary IPC blobs. */
export const PREFERRED_AI_MODEL_ID_MAX_LEN = 256;

export type PreferredModelDecision =
  | { kind: "select-and-persist"; modelId: string }
  | { kind: "select-runtime"; modelId: string }
  | { kind: "unavailable"; modelId: string }
  | { kind: "wait" };

/**
 * Normalize a candidate preferred model id for persistence / decision input.
 * Accepts only strings; trims; returns undefined for empty/non-string/overlong.
 */
export function normalizePreferredAiModelId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > PREFERRED_AI_MODEL_ID_MAX_LEN) return undefined;
  return trimmed;
}

/**
 * Decide how the renderer should reconcile saved preference, runtime selection,
 * and the current gateway model list.
 *
 * | Condition | Decision |
 * | no available models | wait |
 * | saved available, differs from runtime | select-runtime saved id |
 * | saved available and already selected | wait |
 * | saved absent from available models | unavailable saved id |
 * | no saved, runtime selection available | select-and-persist runtime id |
 * | no saved, no runtime selection | select-and-persist first available id |
 */
export function preferredModelDecision(input: {
  preferredModelId?: string;
  runtimeModelId?: string;
  availableModelIds: readonly string[];
}): PreferredModelDecision {
  const available = input.availableModelIds.filter((id) => typeof id === "string" && id.trim().length > 0);
  if (available.length === 0) return { kind: "wait" };

  const preferred = normalizePreferredAiModelId(input.preferredModelId);
  const runtime = normalizePreferredAiModelId(input.runtimeModelId);
  const availableSet = new Set(available);

  if (preferred) {
    if (!availableSet.has(preferred)) {
      return { kind: "unavailable", modelId: preferred };
    }
    if (runtime === preferred) return { kind: "wait" };
    return { kind: "select-runtime", modelId: preferred };
  }

  if (runtime && availableSet.has(runtime)) {
    return { kind: "select-and-persist", modelId: runtime };
  }

  return { kind: "select-and-persist", modelId: available[0]! };
}
