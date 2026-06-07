import type { AiAccountState, AiProviderId, GatewayState } from "../../shared/types.js";

/**
 * Model_Gateway (9Router) manager module (web-dashboard design §Model_Gateway).
 *
 * This file currently owns only the PURE AI-ready gate (Task 4.5, Req 2.4/2.9);
 * the network/child-process lifecycle (`start` retry, OAuth `connectAccount`,
 * `ensureLocalKey`) lands in tasks 6.3/6.4. Keeping the gate pure lets the
 * Create action and silent-draft start be tested without any process spawn.
 */

export const GATEWAY_BASE_URL = "http://localhost:20128/v1";

/**
 * Pure gate (Property 3): silent draft generation may start IFF the local
 * gateway is `ready` AND an AI account is `connected`. Any other combination
 * (starting/unavailable gateway, or disconnected/connecting account) is false,
 * which blocks the Create action with a "connect an account first" prompt.
 */
export function aiReady(gw: GatewayState, acc: AiAccountState): boolean {
  return gw.kind === "ready" && acc.kind === "connected";
}

export const MAX_START_ATTEMPTS = 3;
export const CONNECT_TIMEOUT_MS = 120_000;

/** The process/OAuth/key effects the manager drives — injected so it is testable. */
export type GatewayDeps = {
  /** Start ONE gateway child attempt on localhost (no window/console). */
  launch: () => Promise<boolean>;
  /** OAuth connect for an AI account; resolves ok + a display label, or not-ok. */
  oauth: (provider: AiProviderId, signal: AbortSignal) => Promise<{ ok: boolean; label?: string }>;
  /** Generate the internal Local_Gateway_Key (never returned over IPC). */
  generateKey?: () => string;
  /** Auto-wire the local key into the gateway/client. */
  wireKey?: (key: string) => void | Promise<void>;
  maxStartAttempts?: number;
  connectTimeoutMs?: number;
};

/** Run an OAuth call with a hard timeout; abort/throw ⇒ not connected. */
async function connectWithTimeout(
  call: (signal: AbortSignal) => Promise<{ ok: boolean; label?: string }>,
  ms: number,
): Promise<{ ok: boolean; label?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await call(controller.signal);
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Owns the 9Router child + the AI-account connection (web-dashboard Task 6.3/6.4,
 * Req 2). The `Local_Gateway_Key` is generated + wired INTERNALLY and never
 * leaves the main process; the UI never sees the term "API key". Vivibe stays the
 * default voice — the gateway's TTS is unused.
 */
export class ModelGatewayManager {
  private gw: GatewayState = { kind: "starting", attempt: 0 };
  private acc: AiAccountState = { kind: "disconnected" };
  private lastConnected: AiAccountState | null = null;
  private localKey: string | null = null;
  private readonly deps: GatewayDeps;

  constructor(deps: GatewayDeps) {
    this.deps = deps;
  }

  state(): GatewayState {
    return this.gw;
  }

  account(): AiAccountState {
    return this.acc;
  }

  aiReady(): boolean {
    return aiReady(this.gw, this.acc);
  }

  /** Generate + auto-wire the local key. Returns void — the key never leaves main. */
  async ensureLocalKey(): Promise<void> {
    if (this.localKey) return;
    this.localKey = this.deps.generateKey ? this.deps.generateKey() : `lgk_${Math.random().toString(36).slice(2)}`;
    await this.deps.wireKey?.(this.localKey);
  }

  /** Start the gateway, retrying up to 3 attempts before surfacing `unavailable`. */
  async start(): Promise<GatewayState> {
    const max = this.deps.maxStartAttempts ?? MAX_START_ATTEMPTS;
    for (let attempt = 1; attempt <= max; attempt++) {
      this.gw = { kind: "starting", attempt };
      const ok = await this.deps.launch().catch(() => false);
      if (ok) {
        await this.ensureLocalKey();
        this.gw = { kind: "ready", baseUrl: GATEWAY_BASE_URL };
        return this.gw;
      }
    }
    this.gw = { kind: "unavailable" };
    return this.gw;
  }

  /**
   * Connect an AI account (default kiro, 120s timeout). Success records + enables
   * AI; failure/cancel/timeout RETAINS any previously connected account (Req 2.8).
   */
  async connectAccount(provider: AiProviderId = "kiro"): Promise<AiAccountState> {
    this.acc = { kind: "connecting", provider };
    const result = await connectWithTimeout(
      (signal) => this.deps.oauth(provider, signal),
      this.deps.connectTimeoutMs ?? CONNECT_TIMEOUT_MS,
    );
    if (result.ok) {
      this.acc = { kind: "connected", provider, label: result.label ?? provider };
      this.lastConnected = this.acc;
    } else {
      this.acc = this.lastConnected ?? { kind: "disconnected" };
    }
    return this.acc;
  }
}
