import type {
  AiAccountState,
  AiProviderId,
  ConnectedAccount,
  GatewayState,
  ModelInfo,
  ProviderInfo,
} from "../../shared/types.js";
import { aiReady } from "../../shared/ai-ready.js";
import { createLogger } from "@motionreal/pipeline";

const log = createLogger("gateway");

// Re-export the pure gate so existing importers of this module keep working,
// while the source of truth lives in `shared/` (renderer-safe).
export { aiReady } from "../../shared/ai-ready.js";

/**
 * 9router gateway manager.
 *
 * Owns the bundled 9router child + the AI-account connections. Providers are
 * DISCOVERED dynamically; login is DELEGATED to the gateway's own UI (the
 * dashboard never reimplements OAuth/device-code/api-key screens); multiple
 * connections may be active; the user selects a model. The local gateway key is
 * generated + wired internally and never leaves the main process.
 */

export const GATEWAY_BASE_URL = "http://localhost:20128/v1";

export const MAX_START_ATTEMPTS = 3;

/** The process/discovery/login effects the manager drives — injected so it is testable. */
export type GatewayDeps = {
  /** Start ONE gateway child attempt on localhost (no window/console). */
  launch: () => Promise<boolean>;
  /** Discover the provider catalog + connection counts from the gateway. */
  listProviders: () => Promise<ProviderInfo[]>;
  /** Delegate provider login to the gateway UI; report where it appears. */
  beginConnect: (providerId: AiProviderId) => Promise<{ loginSurface: "external-browser" | "in-app" }>;
  /** Read the currently completed connections from the gateway. */
  pollConnections: () => Promise<ConnectedAccount[]>;
  /** List models the gateway reports as available. */
  listModels: () => Promise<ModelInfo[]>;
  /** Generate the internal Local_Gateway_Key (never returned over IPC). */
  generateKey?: () => string;
  /** Auto-wire the local key into the gateway/client. */
  wireKey?: (key: string) => void | Promise<void>;
  maxStartAttempts?: number;
};

/**
 * Owns the 9router child + AI-account connections (/6.4,
 * Req 2). Concrete gateway is 9router on localhost:20128. Vivibe stays the
 * default voice — the gateway's TTS is unused.
 */
export class ModelGatewayManager {
  private gw: GatewayState = { kind: "starting", attempt: 0 };
  private accounts: ConnectedAccount[] = [];
  private selected: ModelInfo | undefined;
  private localKey: string | null = null;
  private readonly deps: GatewayDeps;

  constructor(deps: GatewayDeps) {
    this.deps = deps;
  }

  state(): GatewayState {
    return this.gw;
  }

  /** The set of completed connections + selected model as a view-model. */
  account(): AiAccountState {
    if (this.accounts.length === 0) return { kind: "disconnected" };
    return { kind: "connected", accounts: [...this.accounts], selectedModel: this.selected };
  }

  selectedModel(): ModelInfo | undefined {
    return this.selected;
  }

  aiReady(): boolean {
    return aiReady(this.gw, this.account());
  }

  /** Generate + auto-wire the local key. Returns void — the key never leaves main. */
  async ensureLocalKey(): Promise<void> {
    if (this.localKey) return;
    this.localKey = this.deps.generateKey ? this.deps.generateKey() : `lgk_${Math.random().toString(36).slice(2)}`;
    await this.deps.wireKey?.(this.localKey);
  }

  /** Start the gateway, retrying up to 3 attempts before surfacing `unavailable`. */
  private startInFlight: Promise<GatewayState> | null = null;

  /** Start the gateway; deduped so concurrent callers share ONE in-flight run. */
  start(): Promise<GatewayState> {
    if (this.startInFlight) return this.startInFlight;
    this.startInFlight = this.runStart().finally(() => {
      this.startInFlight = null;
    });
    return this.startInFlight;
  }

  private async runStart(): Promise<GatewayState> {
    const max = this.deps.maxStartAttempts ?? MAX_START_ATTEMPTS;
    for (let attempt = 1; attempt <= max; attempt++) {
      this.gw = { kind: "starting", attempt };
      const ok = await this.deps.launch().catch((error) => {
        log.warn({ err: error, attempt }, "gateway launch attempt failed; retrying if budget remains");
        return false;
      });
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
   * Self-healing state read for the UI poll: returns the CURRENT state right
   * away and, when NOT ready (and no start already running), kicks a background
   * (re)start. This lets a gateway that was down at app launch — or quit/
   * restarted by the user mid-session — recover to `ready` on its own, without
   * needing an app restart. (`launch` no-ops when 9router is already up, so
   * this never spawns a duplicate.)
   */
  ensureReady(): GatewayState {
    if (this.gw.kind !== "ready" && !this.startInFlight) void this.start();
    return this.gw;
  }

  /** Discover providers (name, login-type, connected count) from the gateway. */
  async listProviders(): Promise<ProviderInfo[]> {
    return this.deps.listProviders();
  }

  /** List available models for selection. */
  async listModels(): Promise<ModelInfo[]> {
    return this.deps.listModels();
  }

  /** Begin connecting a provider — delegated to the gateway's own login UI. */
  async beginConnect(providerId: AiProviderId): Promise<{ loginSurface: "external-browser" | "in-app" }> {
    return this.deps.beginConnect(providerId);
  }

  /** Poll the gateway for completed connections and refresh state. */
  async refreshConnections(): Promise<AiAccountState> {
    this.accounts = await this.deps.pollConnections();
    return this.account();
  }

  /** Select the model used for generation. */
  selectModel(model: ModelInfo): AiAccountState {
    this.selected = model;
    return this.account();
  }
}
