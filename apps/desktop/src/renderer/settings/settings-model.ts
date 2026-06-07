import type { AiAccountState, SettingsModel } from "../../shared/types.js";
import { clampAttempts, DEFAULT_MAX_ATTEMPTS } from "../../main/agent/repair-loop.js";

/**
 * Settings defaults + normalization (web-dashboard Task 10.1, design §Settings,
 * Req 11.3/11.4/11.7/11.8). Every L3 setting is PRE-POPULATED so a user can run
 * the whole flow without ever opening Settings: Vivibe voice, a default output
 * dir, repair budget 3 (clamped [1,10]), and the script gate ON. `outputDir` is
 * supplied by the main process (the `.video-tool` home) to keep this module pure.
 */

export function defaultSettings(outputDir: string): SettingsModel {
  return {
    aiAccount: { kind: "disconnected" },
    voiceProvider: "vivibe",
    outputDir,
    maxRepairAttempts: DEFAULT_MAX_ATTEMPTS,
    scriptGateEnabled: true,
  };
}

/**
 * Apply a partial update, keeping the invariants: voice stays Vivibe (the engine
 * authority; never downgraded here), the repair budget is clamped to [1,10], and
 * the live AI-account state is preserved unless explicitly replaced.
 */
export function normalizeSettings(
  current: SettingsModel,
  patch: Partial<SettingsModel>,
  liveAccount?: AiAccountState,
): SettingsModel {
  const merged: SettingsModel = { ...current, ...patch };
  return {
    ...merged,
    voiceProvider: "vivibe",
    maxRepairAttempts: clampAttempts(merged.maxRepairAttempts),
    aiAccount: liveAccount ?? merged.aiAccount,
  };
}
