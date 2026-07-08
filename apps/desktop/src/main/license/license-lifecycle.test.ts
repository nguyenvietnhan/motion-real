import { describe, expect, it } from "vitest";
import { LicenseManager, outcomeToState, type ActivationOutcome, type LicenseService } from "./license-manager.js";
import { HttpLicenseService } from "./license-service.js";

/**
 * activation outcome → state table + the
 * node-locked launch skip, with a stubbed LicenseService.
 */

function service(outcome: ActivationOutcome): LicenseService {
  return { activate: async () => outcome, verify: async () => outcome };
}

const NOW = "2026-06-07T00:00:00.000Z";

describe("outcomeToState table", () => {
  it("maps a valid outcome to active", () => {
    expect(outcomeToState({ ok: true, nodeLocked: true }, NOW)).toEqual({
      kind: "active",
      machineLocked: true,
      lastVerifiedAt: NOW,
    });
  });

  it("maps each failure reason to an error state", () => {
    for (const reason of ["invalid", "limit", "revoked", "timeout", "offline"] as const) {
      expect(outcomeToState({ ok: false, reason }, NOW)).toEqual({ kind: "error", reason });
    }
  });
});

describe("LicenseManager.activate", () => {
  it("reaches active on a valid key and can create", async () => {
    const mgr = new LicenseManager({ service: service({ ok: true, nodeLocked: true }), machineId: "m", now: () => NOW });
    const state = await mgr.activate("KEY");
    expect(state).toEqual({ kind: "active", machineLocked: true, lastVerifiedAt: NOW });
    expect(mgr.canCreate()).toBe(true);
  });

  it("surfaces invalid/limit/revoked as error states without creation", async () => {
    for (const reason of ["invalid", "limit", "revoked"] as const) {
      const mgr = new LicenseManager({ service: service({ ok: false, reason }), machineId: "m" });
      const state = await mgr.activate("KEY");
      expect(state).toEqual({ kind: "error", reason });
      expect(mgr.canCreate()).toBe(false);
    }
  });

  it("classifies an aborted call as timeout (30s budget) and a thrown call as offline", async () => {
    const hangs: LicenseService = {
      activate: (_k, _m, signal) =>
        new Promise((_res, rej) => signal.addEventListener("abort", () => rej(new Error("aborted")))),
      verify: async () => ({ ok: true, nodeLocked: true }),
    };
    const timeoutMgr = new LicenseManager({ service: hangs, machineId: "m", timeoutMs: 10 });
    expect(await timeoutMgr.activate("KEY")).toEqual({ kind: "error", reason: "timeout" });

    const throws: LicenseService = {
      activate: async () => {
        throw new Error("ENOTFOUND");
      },
      verify: async () => ({ ok: true, nodeLocked: true }),
    };
    const offlineMgr = new LicenseManager({ service: throws, machineId: "m", timeoutMs: 1000 });
    expect(await offlineMgr.activate("KEY")).toEqual({ kind: "error", reason: "offline" });
  });

  it("retries with the same key when none is supplied on retry", async () => {
    let calls = 0;
    const flaky: LicenseService = {
      activate: async () => {
        calls++;
        return calls === 1 ? { ok: false, reason: "offline" } : { ok: true, nodeLocked: true };
      },
      verify: async () => ({ ok: true, nodeLocked: true }),
    };
    const mgr = new LicenseManager({ service: flaky, machineId: "m", now: () => NOW });
    await mgr.activate("KEY-123");
    const retried = await mgr.activate(); // no key → reuse KEY-123
    expect(retried.kind).toBe("active");
    expect(calls).toBe(2);
  });
});

describe("LicenseManager.verifyAtLaunch", () => {
  it("trusts a persisted node-locked license and skips re-entry", async () => {
    const mgr = new LicenseManager({
      service: service({ ok: false, reason: "offline" }),
      machineId: "m",
      loadPersisted: () => ({ nodeLocked: true, lastVerifiedAt: NOW }),
    });
    const state = await mgr.verifyAtLaunch();
    expect(state).toEqual({ kind: "active", machineLocked: true, lastVerifiedAt: NOW });
    expect(mgr.canCreate()).toBe(true);
  });

  it("stays unactivated when nothing is persisted", async () => {
    const mgr = new LicenseManager({ service: service({ ok: true, nodeLocked: true }), machineId: "m" });
    expect(await mgr.verifyAtLaunch()).toEqual({ kind: "unactivated" });
  });
});

describe("HttpLicenseService", () => {
  function fakeFetch(status: number, body: { status?: string }) {
    return async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  }

  it("maps a valid body to a node-locked success", async () => {
    const svc = new HttpLicenseService({ endpoint: "https://lic/", fetchImpl: fakeFetch(200, { status: "valid" }) });
    expect(await svc.activate("k", "m", new AbortController().signal)).toEqual({ ok: true, nodeLocked: true });
  });

  it("maps revoked/limit bodies and HTTP error codes", async () => {
    const revoked = new HttpLicenseService({ endpoint: "https://lic", fetchImpl: fakeFetch(200, { status: "revoked" }) });
    expect(await revoked.activate("k", "m", new AbortController().signal)).toEqual({ ok: false, reason: "revoked" });

    const conflict = new HttpLicenseService({ endpoint: "https://lic", fetchImpl: fakeFetch(409, {}) });
    expect(await conflict.activate("k", "m", new AbortController().signal)).toEqual({ ok: false, reason: "limit" });

    const gone = new HttpLicenseService({ endpoint: "https://lic", fetchImpl: fakeFetch(410, {}) });
    expect(await gone.verify("m", new AbortController().signal)).toEqual({ ok: false, reason: "revoked" });
  });
});
