import type { SettingsModel } from "../../shared/types.js";
import { DEFAULT_MAX_ATTEMPTS } from "../../main/agent/repair-loop.js";

/**
 * Settings defaults (web-dashboard Task 10.1, design §Settings,
 * Req 11.3/11.4/11.7/11.8). Every L3 setting is PRE-POPULATED so a user can run
 * the whole flow without ever opening Settings: Vivibe voice, a default output
 * dir, repair budget 3, and the script gate ON. `outputDir` is supplied by the
 * main process (the `.video-tool` home) to keep this module pure.
 *
 * NOTE (reconcile-main-controllers S2): `normalizeSettings` was removed. It was
 * never on the production path — `index.ts` merged settings inline WITHOUT
 * clamping `maxRepairAttempts`, so the clamp was a divergence (R4.4). The real
 * persistence/merge now lives in the tested `SettingsStore` (main/settings).
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
