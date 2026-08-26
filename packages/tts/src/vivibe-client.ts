import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { measureAudioDuration } from "./audio-ops.js";
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
  stripDataPrefix,
  type NormalizedAudio,
} from "./provider-http.js";
import type { TTSRequest, TTSResult, TTSVoice, TtsClient } from "./types.js";
import { VoiceProviderError, retryAfterMs, voiceProviderErrorFrom } from "./provider-error.js";

export type VivibeClientOptions = {
  apiKey?: string;
  baseUrl?: string;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  retryAttempts?: number;
  retryBaseDelayMs?: number;
  fetch?: typeof fetch;
  measureDuration?: (audioPath: string) => Promise<number>;
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
  private fetchImpl: typeof fetch;
  private measureDuration: (audioPath: string) => Promise<number>;

  constructor(options: VivibeClientOptions = {}) {
    this.apiKey = options.apiKey ?? vivibeApiKey();
    this.baseUrl = options.baseUrl ?? vivibeBaseUrl();
    this.pollIntervalMs = options.pollIntervalMs ?? Number(process.env.LUCYLAB_POLL_INTERVAL_MS ?? 2000);
    this.pollTimeoutMs = options.pollTimeoutMs ?? Number(process.env.LUCYLAB_POLL_TIMEOUT_MS ?? 300000);
    this.retryAttempts = options.retryAttempts ?? vivibeRetryAttempts();
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? vivibeRetryBaseDelayMs();
    this.fetchImpl = options.fetch ?? fetch;
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

  async synthesize(input: TTSRequest, resumeExportId?: string): Promise<TTSResult & { exportId?: string }> {
    await mkdir(dirname(input.outputPath), { recursive: true });

    let resolved: Extract<NormalizedAudio, { kind: "url" | "base64" }>;
    let raw: unknown = null;
    let pollRaw: unknown = null;
    let exportId = resumeExportId;
    const sidecarPath = `${input.outputPath}.export-id`;

    if (!exportId && existsSync(sidecarPath)) {
      try {
        exportId = (await readFile(sidecarPath, "utf8")).trim();
      } catch {
        /* ignore */
      }
    }

    if (exportId && exportId.length > 0) {
      const polled = await this.pollExportStatus(exportId);
      resolved = polled.audio;
      pollRaw = polled.raw;
      raw = { resumedExportId: exportId };
    } else {
      raw = await this.call<unknown>("ttsLongText", {
        text: input.text,
        userVoiceId: input.voiceId,
        speed: input.speed,
      });
      const audio = normalizeAudioResponse(raw);
      if (audio.kind === "job") {
        exportId = audio.id;
        await writeFile(sidecarPath, exportId, "utf8");
        const polled = await this.pollExportStatus(audio.id);
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
        fetchImpl: this.fetchImpl,
      });
    } else {
      await writeFile(finalPath, Buffer.from(stripDataPrefix(resolved.data), "base64"));
    }

    let srtPath: string | undefined;
    const srtUrl = findSrtUrl(pollRaw) ?? findSrtUrl(raw);
    if (srtUrl) {
      const candidate = `${finalPath}.srt`;
      try {
        await downloadText(srtUrl, candidate, {
          attempts: this.retryAttempts,
          baseDelayMs: this.retryBaseDelayMs,
          fetchImpl: this.fetchImpl,
        });
        srtPath = candidate;
      } catch (error) {
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
      duration: await this.measureDuration(finalPath),
      raw,
      exportId,
      srtPath,
    };
  }

  async probe(voiceId?: string): Promise<{ voices: TTSVoice[]; sample?: TTSResult }> {
    const voices = await this.listVoices(10, 1);
    const selectedVoiceId = voiceId ?? voices.find((voice) => voice.isActive)?.id ?? voices[0]?.id;
    if (!selectedVoiceId) {
      return { voices };
    }
    const samplePath = join(process.cwd(), ".vivibe-probe", `sample-${Date.now()}.mp3`);
    const sample = await this.synthesize({
      text: "Xin chào, đây là kiểm tra giọng nói AI.",
      voiceId: selectedVoiceId,
      speed: 1.0,
      outputPath: samplePath,
    });
    return { voices, sample };
  }

  private async call<T>(method: string, input: unknown): Promise<T> {
    if (!this.apiKey) {
      throw new VoiceProviderError({ provider: "vivibe", code: "not_configured", retryable: false });
    }

    const res = await fetchWithRetry(
      () =>
        this.fetchImpl(this.baseUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ method, input }),
        }),
      {
        attempts: this.retryAttempts,
        baseDelayMs: this.retryBaseDelayMs,
        label: `Vivibe ${method}`,
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
  ): Promise<{ audio: Extract<NormalizedAudio, { kind: "url" | "base64" }>; raw: unknown }> {
    const deadline = Date.now() + this.pollTimeoutMs;
    let lastResult: unknown = null;
    while (Date.now() < deadline) {
      const result = await this.call<unknown>("getExportStatus", { projectExportId });
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
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
    throw new Error(`Timed out waiting for Vivibe export ${projectExportId}: ${JSON.stringify(lastResult)}`);
  }
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
