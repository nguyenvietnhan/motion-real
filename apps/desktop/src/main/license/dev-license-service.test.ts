import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { LicenseManager } from "./license-manager.js";
import { DevLicenseService } from "./dev-license-service.js";

/**
 * Feature: reconcile-main-controllers — DevLicenseService + LicenseManager.
 * Reproduces the inline Current_Behavior of index.ts license:activate (R3.2/R3.3).
 */

function manager(now = "2026-01-01T00:00:00.000Z") {
  return new LicenseManager({ service: new DevLicenseService(), machineId: "dev", now: () => now });
}

// Property 1: License activate mapping
describe("Property 1: License activate mapping", () => {
  it("trim==='123' → active with ISO lastVerifiedAt; otherwise → error invalid (never active)", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), async (key) => {
        const state = await manager().activate(key);
        if (key.trim() === "123") {
          expect(state.kind).toBe("active");
          if (state.kind === "active") {
            expect(state.machineLocked).toBe(true);
            expect(Number.isNaN(Date.parse(state.lastVerifiedAt))).toBe(false);
          }
        } else {
          expect(state).toEqual({ kind: "error", reason: "invalid" });
        }
      }),
      { numRuns: 100 },
    );
  });

  it("known cases", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    expect(await manager(now).activate("123")).toEqual({ kind: "active", machineLocked: true, lastVerifiedAt: now });
    expect(await manager(now).activate("  123  ")).toEqual({ kind: "active", machineLocked: true, lastVerifiedAt: now });
    expect(await manager(now).activate("")).toEqual({ kind: "error", reason: "invalid" });
    expect(await manager(now).activate("nope")).toEqual({ kind: "error", reason: "invalid" });
  });
});
