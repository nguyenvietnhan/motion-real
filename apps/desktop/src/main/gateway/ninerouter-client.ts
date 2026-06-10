import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ConnectedAccount, ModelInfo, ProviderInfo } from "../../shared/types.js";

/**
 * Real 9router HTTP client (web-dashboard — concrete Model_Gateway integration).
 *
 * 9router runs on http://localhost:20128. The OpenAI-compatible surface is at
 * /v1/*; the management surface is at /api/* and is authenticated with the
 * `x-9r-cli-token` header = sha256(machineId + "9r-cli-auth" + cliSecret)[:16],
 * where machineId + cliSecret live in the 9router data dir. The provider CATALOG
 * (which providers exist + their login method) is 9router's known set; CONNECTION
 * state + models are read live from the gateway.
 */

const BASE = "http://localhost:20128";
const CLI_TOKEN_HEADER = "x-9r-cli-token";
const CLI_TOKEN_SALT = "9r-cli-auth";

/** Quick management/poll calls (models, providers, reachability). */
const QUICK_TIMEOUT_MS = 10_000;
/** A chat completion can legitimately take a while (large authored output + first-run gateway/model cold start). */
const CHAT_TIMEOUT_MS = 300_000;

/** Chat is retried on TRANSIENT failures (gateway/upstream hiccups): total tries. */
const MAX_CHAT_ATTEMPTS = 3;
/** Linear backoff base between chat retries: waits 1s, then 2s. */
const CHAT_RETRY_BASE_MS = 1_000;

/** A 9router/upstream status worth retrying: rate-limit or any 5xx (502/503/504…). */
function isTransientStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/** Backoff before the next chat attempt (attempt is 1-indexed; 1→1s, 2→2s). */
function chatBackoffMs(attempt: number): number {
  return CHAT_RETRY_BASE_MS * attempt;
}

/**
 * A typed chat failure so the UI can phrase the RIGHT message instead of one
 * generic "timeout or lost connection" line:
 *  - "timeout"   — the request ran past CHAT_TIMEOUT_MS (model too slow/overloaded);
 *                  NOT retried (retrying a full timeout would just multiply the wait).
 *  - "transient" — a gateway/upstream hiccup (HTTP 429/5xx, or a network drop) that
 *                  is usually self-healing; chat() retries these with backoff before
 *                  giving up, and only throws this after exhausting attempts.
 *  - "http"      — a non-retryable HTTP error (e.g. 4xx: model rejected / not found /
 *                  unauthorized) — retrying won't help; surfaced as-is.
 */
export type GatewayChatErrorKind = "timeout" | "transient" | "http";

export class GatewayChatError extends Error {
  readonly kind: GatewayChatErrorKind;
  readonly status?: number;
  readonly attempts: number;
  constructor(kind: GatewayChatErrorKind, message: string, opts: { status?: number; attempts?: number } = {}) {
    super(message);
    this.name = "GatewayChatError";
    this.kind = kind;
    if (typeof opts.status === "number") this.status = opts.status;
    this.attempts = opts.attempts ?? 1;
  }
}

/** The minimal fetch surface the client needs (global fetch satisfies it). Test seam. */
export type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;

/**
 * `fetch` with a hard timeout (and optional external abort). Without this a hung
 * gateway/model would leave a request pending FOREVER — e.g. authoring stuck on
 * "writing" with no way out. On timeout it throws a `GatewayChatError("timeout")`
 * so callers can distinguish a slow model from a transient drop; a network-level
 * failure is rethrown as-is for the caller to classify.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  fetchImpl: FetchImpl,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (externalSignal) {
    if (externalSignal.aborted) ctrl.abort();
    else externalSignal.addEventListener("abort", onAbort, { once: true });
  }
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if (timedOut) {
      throw new GatewayChatError("timeout", `request to ${url} timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener("abort", onAbort);
  }
}

/** A text part or an inline image (data URL) — OpenAI multimodal content shape. */
export type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

/** A chat message whose content may be plain text or multimodal parts (vision). */
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string | ContentPart[] };

/** 9router data dir (Windows: %APPDATA%/9router; else ~/.9router). */
function dataDir(): string {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (process.platform === "win32") {
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "9router");
  }
  return join(homedir(), ".9router");
}

function readFileSafe(path: string): string {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return "";
  }
}

/** Compute the CLI token the way 9router's own CLI does. */
function cliToken(): string {
  const machineId = readFileSafe(join(dataDir(), "machine-id"));
  const secret = readFileSafe(join(dataDir(), "auth", "cli-secret"));
  if (!machineId) return "";
  return createHash("sha256").update(machineId + CLI_TOKEN_SALT + secret).digest("hex").slice(0, 16);
}

/**
 * The known 9router provider catalog (name + login method). Mirrors 9router's
 * own CLI catalog; connection counts are merged in from the live API.
 */
const CATALOG: { id: string; name: string; loginType: ProviderInfo["loginType"] }[] = [
  // OAuth authorization-code → external browser sign-in
  { id: "claude", name: "Claude Code", loginType: "browser" },
  { id: "codex", name: "OpenAI Codex", loginType: "browser" },
  { id: "gemini-cli", name: "Gemini CLI", loginType: "browser" },
  { id: "antigravity", name: "Antigravity", loginType: "browser" },
  { id: "iflow", name: "iFlow AI", loginType: "browser" },
  // OAuth device-code → enter a code
  { id: "github", name: "GitHub Copilot", loginType: "device" },
  { id: "qwen", name: "Qwen Code", loginType: "device" },
  { id: "kiro", name: "Kiro AI", loginType: "device" },
  // API key
  { id: "openrouter", name: "OpenRouter", loginType: "api-key" },
  { id: "glm", name: "GLM Coding", loginType: "api-key" },
  { id: "minimax", name: "Minimax", loginType: "api-key" },
  { id: "kimi", name: "Kimi", loginType: "api-key" },
  { id: "openai", name: "OpenAI", loginType: "api-key" },
  { id: "anthropic", name: "Anthropic", loginType: "api-key" },
  { id: "gemini", name: "Gemini", loginType: "api-key" },
];

type ApiConnection = { provider?: string; providerId?: string; name?: string; email?: string; displayName?: string; isActive?: boolean };

export class NineRouterClient {
  /**
   * `fetchImpl`/`sleep` are injectable test seams so the retry/backoff logic is
   * unit-testable with no live network and no real wall-clock delay. Production
   * uses global `fetch` and a real timer.
   */
  constructor(
    private readonly base: string = BASE,
    private readonly seams: { fetchImpl?: FetchImpl; sleep?: (ms: number) => Promise<void> } = {},
  ) {}

  private get fetchImpl(): FetchImpl {
    return this.seams.fetchImpl ?? ((url, init) => fetch(url, init));
  }

  private sleep(ms: number): Promise<void> {
    return this.seams.sleep ? this.seams.sleep(ms) : new Promise((r) => setTimeout(r, ms));
  }

  get rootUrl(): string {
    return this.base;
  }

  private async api<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetchWithTimeout(
      `${this.base}${path}`,
      {
        method,
        headers: { "content-type": "application/json", [CLI_TOKEN_HEADER]: cliToken() },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
      QUICK_TIMEOUT_MS,
      this.fetchImpl,
    );
    if (!res.ok) throw new Error(`9router ${method} ${path} → HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  /** Reachable iff GET /v1/models responds 200. */
  async isReachable(): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(`${this.base}/v1/models`, {}, QUICK_TIMEOUT_MS, this.fetchImpl);
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Live connections grouped by provider id. */
  private async connections(): Promise<ApiConnection[]> {
    try {
      const data = await this.api<{ connections?: ApiConnection[] }>("GET", "/api/providers");
      return data.connections ?? [];
    } catch {
      return [];
    }
  }

  /** Provider catalog merged with live connection counts (Req 2.4). */
  async listProviders(): Promise<ProviderInfo[]> {
    const conns = await this.connections();
    const counts = new Map<string, number>();
    for (const c of conns) {
      const id = c.provider ?? c.providerId ?? "";
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return CATALOG.map((p) => ({
      id: p.id,
      name: p.name,
      loginType: p.loginType,
      connectedCount: counts.get(p.id) ?? 0,
    }));
  }

  /** Completed connections as account view-models (Req 2.7/2.8). */
  async connectedAccounts(): Promise<ConnectedAccount[]> {
    const conns = await this.connections();
    return conns.map((c) => ({
      provider: c.provider ?? c.providerId ?? "unknown",
      label: c.name || c.email || c.displayName || (c.provider ?? c.providerId ?? "Đã kết nối"),
      // 9router marks the connection it actually routes through as `isActive`; the
      // UI uses it to show only the account in use (and hide the rest), so a stale
      // prior login (e.g. a Gemini Gmail) no longer masquerades as the active one.
      ...(typeof c.isActive === "boolean" ? { active: c.isActive } : {}),
    }));
  }

  /** Available models from the OpenAI-compatible surface (Req 2.11). */
  async listModels(): Promise<ModelInfo[]> {
    try {
      const data = await this.api<{ data?: { id: string }[] }>("GET", "/v1/models");
      return (data.data ?? []).map((m) => ({ id: m.id, label: m.id }));
    } catch {
      return [];
    }
  }

  /** Create + return an OpenAI-compatible key for the Agent_Worker (internal). */
  async createApiKey(name: string): Promise<string | null> {
    try {
      const data = await this.api<{ key?: string }>("POST", "/api/keys", { name });
      return data.key ?? null;
    } catch {
      return null;
    }
  }

  /**
   * One OpenAI-compatible chat completion, retried on TRANSIENT failures.
   *
   * 9router talks to an upstream provider (Codex/Gemini/Kiro/…); during a cold
   * start or a provider hiccup it can answer 502/503/504 (or 429), or the socket
   * can drop — all usually self-healing within a second or two. Rather than throw
   * that straight at the user (who then has to hand-retry, and may hit the gateway
   * mid-recovery and wait out the full timeout), we retry up to MAX_CHAT_ATTEMPTS
   * with a short linear backoff. A non-retryable HTTP error (4xx) is thrown at
   * once; a hard timeout is NOT retried (the model is simply too slow — retrying
   * would just multiply the already-long wait). All failures surface as a typed
   * `GatewayChatError` so the UI phrases the right message.
   */
  async chat(
    model: string,
    messages: ChatMessage[],
    opts: { apiKey?: string; signal?: AbortSignal } = {},
  ): Promise<string> {
    let last: GatewayChatError | undefined;
    for (let attempt = 1; attempt <= MAX_CHAT_ATTEMPTS; attempt++) {
      try {
        return await this.chatOnce(model, messages, opts);
      } catch (e) {
        const err = this.toChatError(e, attempt);
        last = err;
        // Only transient gateway/upstream failures are worth another try; a
        // timeout or a non-retryable HTTP status fails fast.
        const canRetry = err.kind === "transient" && attempt < MAX_CHAT_ATTEMPTS && !opts.signal?.aborted;
        if (!canRetry) throw err;
        await this.sleep(chatBackoffMs(attempt));
      }
    }
    // Unreachable (the loop either returns or throws), but keeps the type total.
    throw last ?? new GatewayChatError("transient", "9router chat failed");
  }

  /** A single chat attempt: throws a typed `GatewayChatError` on any failure. */
  private async chatOnce(
    model: string,
    messages: ChatMessage[],
    opts: { apiKey?: string; signal?: AbortSignal },
  ): Promise<string> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`;
    const res = await fetchWithTimeout(
      `${this.base}/v1/chat/completions`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ model, messages, stream: false }),
      },
      CHAT_TIMEOUT_MS,
      this.fetchImpl,
      opts.signal,
    );
    if (!res.ok) {
      const kind = isTransientStatus(res.status) ? "transient" : "http";
      throw new GatewayChatError(kind, `9router chat → HTTP ${res.status}`, { status: res.status });
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? "";
  }

  /** Normalize any thrown value from one chat attempt into a typed GatewayChatError. */
  private toChatError(e: unknown, attempt: number): GatewayChatError {
    if (e instanceof GatewayChatError) {
      // Carry the attempt count through (fetchWithTimeout builds it with attempts:1).
      return new GatewayChatError(e.kind, e.message, { ...(e.status ? { status: e.status } : {}), attempts: attempt });
    }
    // A network-level failure (socket drop, DNS, gateway not up) — treat as
    // transient so a brief blip self-heals on the next attempt.
    const reason = e instanceof Error ? e.message : String(e);
    return new GatewayChatError("transient", `9router chat failed: ${reason}`, { attempts: attempt });
  }
}
