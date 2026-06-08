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
/** A chat completion can legitimately take a while (large authored output). */
const CHAT_TIMEOUT_MS = 240_000;

/**
 * `fetch` with a hard timeout (and optional external abort). Without this a hung
 * gateway/model would leave a request pending FOREVER — e.g. authoring stuck on
 * "writing" with no way out. On timeout the promise rejects so callers can fail
 * cleanly and surface a friendly error.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
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
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if (timedOut) throw new Error(`request to ${url} timed out after ${Math.round(timeoutMs / 1000)}s`);
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

type ApiConnection = { provider?: string; providerId?: string; name?: string; email?: string; displayName?: string };

export class NineRouterClient {
  constructor(private readonly base: string = BASE) {}

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
    );
    if (!res.ok) throw new Error(`9router ${method} ${path} → HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  /** Reachable iff GET /v1/models responds 200. */
  async isReachable(): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(`${this.base}/v1/models`, {}, QUICK_TIMEOUT_MS);
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

  /** One OpenAI-compatible chat completion; returns the assistant message text. */
  async chat(
    model: string,
    messages: ChatMessage[],
    opts: { apiKey?: string; signal?: AbortSignal } = {},
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
      opts.signal,
    );
    if (!res.ok) throw new Error(`9router chat → HTTP ${res.status}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? "";
  }
}
