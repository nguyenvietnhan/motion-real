import type { LicenseState } from "../../shared/types.js";

/**
 * License manager (web-dashboard Task 4.1, design §License manager, Req 1).
 *
 * Runs ONLY in the main process; the renderer sees license STATE, never the key
 * or network details. This file owns the pure gate `canCreate` (Property 2) and
 * the pure `outcomeToState` mapping plus the `LicenseManager` lifecycle over an
 * INJECTED `LicenseService` (the concrete network client lands in task 6.1) and
 * an injected clock — so activation timeout/retry and the node-locked launch
 * skip are testable without any network.
 */

export const ACTIVATION_TIMEOUT_MS = 30_000;

export type ActivationOutcome =
  | { ok: true; nodeLocked: true }
  | { ok: false; reason: "invalid" | "limit" | "revoked" | "timeout" | "offline" };

export interface LicenseService {
  activate(key: string, machineId: string, signal: AbortSignal): Promise<ActivationOutcome>;
  verify(machineId: string, signal: AbortSignal): Promise<ActivationOutcome>;
}

/** A previously-persisted, node-locked activation read at launch (Req 1.8). */
export type PersistedLicense = { nodeLocked: boolean; lastVerifiedAt: string } | null;

export type LicenseManagerDeps = {
  service: LicenseService;
  machineId: string;
  now?: () => string;
  loadPersisted?: () => PersistedLicense;
  timeoutMs?: number;
};

/** Single source of truth for Req 1.7/1.9/12: may the user create a NEW video? */
export function canCreate(state: LicenseState): boolean {
  return state.kind === "active";
}

/** Pure map: an activation/verify outcome → the resulting `LicenseState`. */
export function outcomeToState(outcome: ActivationOutcome, nowIso: string): LicenseState {
  if (outcome.ok) {
    return { kind: "active", machineLocked: true, lastVerifiedAt: nowIso };
  }
  return { kind: "error", reason: outcome.reason };
}

/** Run a signal-aware call with a hard timeout; abort ⇒ timeout, throw ⇒ offline. */
async function withTimeout(
  call: (signal: AbortSignal) => Promise<ActivationOutcome>,
  ms: number,
): Promise<ActivationOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await call(controller.signal);
  } catch {
    return controller.signal.aborted
      ? { ok: false, reason: "timeout" }
      : { ok: false, reason: "offline" };
  } finally {
    clearTimeout(timer);
  }
}

export class LicenseManager {
  private state: LicenseState = { kind: "unactivated" };
  private lastKey: string | null = null;
  private readonly deps: Required<Omit<LicenseManagerDeps, "service" | "machineId">> &
    Pick<LicenseManagerDeps, "service" | "machineId">;

  constructor(deps: LicenseManagerDeps) {
    this.deps = {
      now: () => new Date().toISOString(),
      loadPersisted: () => null,
      timeoutMs: ACTIVATION_TIMEOUT_MS,
      ...deps,
    };
  }

  current(): LicenseState {
    return this.state;
  }

  canCreate(): boolean {
    return canCreate(this.state);
  }

  /** Activate with a 30s timeout. Retains the key so a retry reuses it (Req 1.3). */
  async activate(key?: string): Promise<LicenseState> {
    if (key !== undefined) this.lastKey = key;
    const useKey = this.lastKey;
    if (!useKey) return this.state;
    this.state = { kind: "activating" };
    const outcome = await withTimeout(
      (signal) => this.deps.service.activate(useKey, this.deps.machineId, signal),
      this.deps.timeoutMs,
    );
    this.state = outcomeToState(outcome, this.deps.now());
    return this.state;
  }

  /** At launch a node-locked license skips re-entry and is trusted (Req 1.8). */
  async verifyAtLaunch(): Promise<LicenseState> {
    const persisted = this.deps.loadPersisted();
    if (persisted?.nodeLocked) {
      this.state = { kind: "active", machineLocked: true, lastVerifiedAt: persisted.lastVerifiedAt };
      return this.state;
    }
    return this.state;
  }
}
