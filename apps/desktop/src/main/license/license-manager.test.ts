import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { canCreate } from "./license-manager.js";
import type { LicenseState } from "../../shared/types.js";

/**
 * Property 2: License gates new creation iff active.
 * canCreate(state) is true if and only if state.kind === "active"; in
 * particular a lapsed (revoked/expired) state returns false.
 */

const licenseStateArb: fc.Arbitrary<LicenseState> = fc.oneof(
  fc.constant<LicenseState>({ kind: "unactivated" }),
  fc.constant<LicenseState>({ kind: "activating" }),
  fc
    .date({ min: new Date("2020-01-01"), max: new Date("2030-01-01") })
    .map<LicenseState>((d) => ({ kind: "active", machineLocked: true, lastVerifiedAt: d.toISOString() })),
  fc
    .constantFrom("revoked", "expired")
    .map<LicenseState>((reason) => ({ kind: "lapsed", reason: reason as "revoked" | "expired" })),
  fc
    .constantFrom("timeout", "offline", "invalid", "limit", "revoked")
    .map<LicenseState>((reason) => ({
      kind: "error",
      reason: reason as "timeout" | "offline" | "invalid" | "limit" | "revoked",
    })),
);

describe("Property 2: license gates new creation iff active", () => {
  it("canCreate ⇔ state.kind === 'active'", () => {
    fc.assert(
      fc.property(licenseStateArb, (state) => {
        expect(canCreate(state)).toBe(state.kind === "active");
      }),
      { numRuns: 300 },
    );
  });

  it("a lapsed license blocks new creation", () => {
    fc.assert(
      fc.property(fc.constantFrom<"revoked" | "expired">("revoked", "expired"), (reason) => {
        expect(canCreate({ kind: "lapsed", reason })).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
