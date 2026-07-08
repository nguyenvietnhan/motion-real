import type { ActivationOutcome, LicenseService } from "./license-manager.js";

/**
 * Dev licensing service . Implements the SAME
 * `LicenseService` seam as `HttpLicenseService`, so the production wiring can
 * swap to online licensing later with a one-line change. Reproduces the inline
 * Current_Behavior of `index.ts` (`DEV_LICENSE_CODE = "123"`):
 * - `activate(key)`: trimmed key === "123" ⇒ ok/node-locked; else ⇒ invalid.
 * - `verify`: dev has no persisted online check ⇒ invalid (the node-locked
 * launch skip is handled by `LicenseManager.verifyAtLaunch`, not here).
 */
export class DevLicenseService implements LicenseService {
  async activate(key: string): Promise<ActivationOutcome> {
    return key.trim() === "123" ? { ok: true, nodeLocked: true } : { ok: false, reason: "invalid" };
  }

  async verify(): Promise<ActivationOutcome> {
    return { ok: false, reason: "invalid" };
  }
}
