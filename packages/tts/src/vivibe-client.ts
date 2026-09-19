import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { measureAudioDuration, type ProcessOptions } from "./audio-ops.js";
import {
  downloadAudio,
  downloadText,
  ensureAudioExtension,
  extensionFromUrl,
  fetchWithRetry,
  findSrtUrl,
  integerEnv,
  normalizeAudioResponse,
  readState,
  decodeBase64Audio,
  writeFileAtomically,
  type NormalizedAudio,
} from "./provider-http.js";
import type { TTSRequest, TTSResult, TTSVoice, TtsCallOptions, TtsClient } from "./types.js";
import { VoiceProviderError, retryAfterMs, voiceProviderErrorFrom } from "./provider-error.js";

export type VivibeClientOptions = {
  apiKey?: string;
  baseUrl?: string;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  retryAttempts?: number;
  retryBaseDelayMs?: number;
  apiFetch?: typeof fetch;
  audioFetch?: typeof fetch;
  textFetch?: typeof fetch;
  fetch?: typeof fetch;
  measureDuration?: (audioPath: string, options?: ProcessOptions) => Promise<number>;
};

type JsonRpcResponse<T = unknown> = {
  result?: T;
  error?: unknown;
};

export class VivibeClient implements TtsClient {
  readonly provider = "vivibe" as const;
  private apiKey: string;
  private baseUrl: string;
  private pollIntervalMs: number;
  private pollTimeoutMs: number;
  private retryAttempts: number;
  private retryBaseDelayMs: number;
  private apiFetch: typeof fetch;
  private audioFetch: typeof fetch;
  private textFetch: typeof fetch;
  private measureDuration: (audioPath: string, options?: ProcessOptions) => Promise<number>;

  constructor(options: VivibeClientOptions = {}) {
    this.apiKey = options.apiKey ?? vivibeApiKey();
    this.baseUrl = options.baseUrl ?? vivibeBaseUrl();
    this.pollIntervalMs = options.pollIntervalMs ?? Number(process.env.LUCYLAB_POLL_INTERVAL_MS ?? 2000);
    this.pollTimeoutMs = options.pollTimeoutMs ?? Number(process.env.LUCYLAB_POLL_TIMEOUT_MS ?? 300000);
    this.retryAttempts = options.retryAttempts ?? vivibeRetryAttempts();
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? vivibeRetryBaseDelayMs();
    const fallbackFetch = options.fetch ?? fetch;
    this.apiFetch = options.apiFetch ?? fallbackFetch;
    this.audioFetch = options.audioFetch ?? fallbackFetch;
    this.textFetch = options.textFetch ?? fallbackFetch;
    this.measureDuration = options.measureDuration ?? measureAudioDuration;
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async listVoices(limit = 100, page = 1): Promise<TTSVoice[]> {
    const result = await this.call<{ items?: unknown[] }>("getUserVoices", { limit, page });
    const items = Array.isArray(result.items) ? result.items : [];
    return items.map((item) => {
      const value = item as Record<string, unknown>;
      return {
        id: String(value.id ?? ""),
        name: String(value.name ?? "Unnamed voice"),
        isActive: Boolean(value.isActive),
      };
    });
  }

  async synthesize(input: TTSRequest, options: TtsCallOptions = {}): Promise<TTSResult & { exportId?: string }> {
    await mkdir(dirname(input.outputPath), { recursive: true });

    let resolved: Extract<NormalizedAudio, { kind: "url" | "base64" }>;
    let raw: unknown = null;
    let pollRaw: unknown = null;
    let exportId: string | undefined;
    const sidecarPath = `${input.outputPath}.export-id`;

    if (!exportId && existsSync(sidecarPath)) {
      try {
        exportId = (await readFile(sidecarPath, "utf8")).trim();
      } catch {
        /* ignore */
      }
    }

    if (exportId && exportId.length > 0) {
      const polled = await this.pollExportStatus(exportId, options.signal);
      resolved = polled.audio;
      pollRaw = polled.raw;
      raw = { resumedExportId: exportId };
    } else {
      // This POST may already have created a billable export if the connection
      // breaks. Do not retry it without an idempotency key.
      raw = await this.call<unknown>("ttsLongText", {
        text: input.text,
        userVoiceId: input.voiceId,
        speed: input.speed,
      }, { signal: options.signal, attempts: 1 });
      const audio = normalizeAudioResponse(raw);
      if (audio.kind === "job") {
        exportId = audio.id;
        await writeFileAtomically(sidecarPath, exportId);
        const polled = await this.pollExportStatus(audio.id, options.signal);
        resolved = polled.audio;
        pollRaw = polled.raw;
      } else {
        resolved = audio;
      }
    }

    const finalPath = ensureAudioExtension(
      input.outputPath,
      resolved.kind === "base64" ? resolved.extension : extensionFromUrl(resolved.url),
    );
    if (resolved.kind === "url") {
      await downloadAudio(resolved.url, finalPath, {
        attempts: this.retryAttempts,
        baseDelayMs: this.retryBaseDelayMs,
        fetchImpl: this.audioFetch,
        signal: options.signal,
      });
    } else {
      await writeFileAtomically(finalPath, decodeBase64Audio(resolved.data));
    }

    let srtPath: string | undefined;
    const srtUrl = findSrtUrl(pollRaw) ?? findSrtUrl(raw);
    if (srtUrl) {
      const candidate = `${finalPath}.srt`;
      try {
        await downloadText(srtUrl, candidate, {
          attempts: this.retryAttempts,
          baseDelayMs: this.retryBaseDelayMs,
          fetchImpl: this.textFetch,
          signal: options.signal,
        });
        srtPath = candidate;
      } catch (error) {
        if (options.signal?.aborted) throw error;
        console.warn(
          `[tts] SRT caption download failed; captions will use even-split timing: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (existsSync(sidecarPath)) {
      try {
        await rm(sidecarPath, { force: true });
      } catch {
        /* ignore */
      }
    }

    return {
      audioPath: finalPath,
      duration: await this.measureDuration(finalPath, { signal: options.signal }),
      raw,
      exportId,
      srtPath,
    };
  }

  private async call<T>(
    method: string,
    input: unknown,
    options: { signal?: AbortSignal; attempts?: number } = {},
  ): Promise<T> {
    if (!this.apiKey) {
      throw new VoiceProviderError({ provider: "vivibe", code: "not_configured", retryable: false });
    }

    const res = await fetchWithRetry(
      () =>
        this.apiFetch(this.baseUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ method, input }),
          signal: options.signal,
        }),
      {
        attempts: options.attempts ?? this.retryAttempts,
        baseDelayMs: this.retryBaseDelayMs,
        label: `Vivibe ${method}`,
        signal: options.signal,
      },
    );

    if (!res.ok) {
      let details: unknown = res.statusText;
      try {
        details = await res.json();
      } catch (_error) {}
      const wait = retryAfterMs(res);
      throw voiceProviderErrorFrom("vivibe", {
        status: res.status,
        details,
        ...(wait !== undefined ? { retryAfterMs: wait } : {}),
      });
    }

    const json = (await res.json()) as JsonRpcResponse<T>;
    if (json.error) {
      throw voiceProviderErrorFrom("vivibe", { details: json.error });
    }
    if (!("result" in json)) {
      throw new Error(`Vivibe response missing result: ${JSON.stringify(json)}`);
    }
    return json.result as T;
  }

  private async pollExportStatus(
    projectExportId: string,
    signal?: AbortSignal,
  ): Promise<{ audio: Extract<NormalizedAudio, { kind: "url" | "base64" }>; raw: unknown }> {
    const deadline = Date.now() + this.pollTimeoutMs;
    let lastResult: unknown = null;
    while (Date.now() < deadline) {
      const result = await this.call<unknown>("getExportStatus", { projectExportId }, { signal });
      lastResult = result;
      try {
        const normalized = normalizeAudioResponse(result, { allowJob: false });
        if (normalized.kind === "url" || normalized.kind === "base64") {
          return { audio: normalized, raw: result };
        }
      } catch {
        /* intermediate state without audio yet */
      }
      const state = readState(result);
      if (state && ["failed", "error", "canceled", "cancelled"].includes(state)) {
        throw new Error(`Vivibe export ${projectExportId} failed with state=${state}: ${JSON.stringify(result)}`);
      }
      await sleep(this.pollIntervalMs, signal);
    }
    throw new Error(`Timed out waiting for Vivibe export ${projectExportId}: ${JSON.stringify(lastResult)}`);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    function done() {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function abortError(): Error {
  const error = new Error("TTS request was cancelled.");
  error.name = "AbortError";
  return error;
}

export function vivibeApiKey(): string {
  return process.env.VIVIBE_API_KEY ?? process.env.VIETNAMESE_API_KEY ?? "";
}

export function vivibeBaseUrl(): string {
  return process.env.VIVIBE_BASE_URL ?? process.env.LUCYLAB_ENDPOINT ?? "https://api.lucylab.io/json-rpc";
}

export function vivibeRetryAttempts(): number {
  return integerEnv(["VIVIBE_RETRY_ATTEMPTS", "LUCYLAB_RETRY_ATTEMPTS"], 3, { min: 1, max: 8 });
}

export function vivibeRetryBaseDelayMs(): number {
  return integerEnv(["VIVIBE_RETRY_BASE_DELAY_MS", "LUCYLAB_RETRY_BASE_DELAY_MS"], 750, { min: 0, max: 10_000 });
}

export function defaultVivibeVoiceId(): string | undefined {
  return process.env.VIVIBE_VOICE_ID ?? process.env.VIETNAMESE_VOICEID;
}
