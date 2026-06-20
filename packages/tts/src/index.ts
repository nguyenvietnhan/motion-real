import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { spawn } from "node:child_process";
import { parseFile } from "music-metadata";

const require = createRequire(import.meta.url);
const ffprobeStatic = require("ffprobe-static") as { path: string };
const ffmpegStatic = require("ffmpeg-static") as string | null;

export type TTSVoice = {
  id: string;
  name: string;
  isActive: boolean;
  previewUrl?: string;
};

export type TTSRequest = {
  text: string;
  voiceId: string;
  speed: number;
  outputPath: string;
  modelId?: string;
  languageCode?: string;
};

export type TTSResult = {
  audioPath: string;
  duration: number;
  raw: unknown;
  /** Absolute path to the downloaded SRT sidecar, when the provider returns one. */
  srtPath?: string;
};

export type CloudTtsProvider = "vivibe" | "elevenlabs";

export interface TtsClient {
  readonly provider: CloudTtsProvider;
  isConfigured(): boolean;
  listVoices(): Promise<TTSVoice[]>;
  synthesize(input: TTSRequest): Promise<TTSResult>;
}

export const ELEVENLABS_DEFAULT_MODEL_ID = "eleven_multilingual_v2";
export const ELEVENLABS_OUTPUT_FORMAT = "mp3_44100_128";
export const TTS_NORMALIZER_VERSION = "vi-v1";

export type VivibeClientOptions = {
  apiKey?: string;
  baseUrl?: string;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  retryAttempts?: number;
  retryBaseDelayMs?: number;
};

type JsonRpcResponse<T = unknown> = {
  result?: T;
  error?: unknown;
};

type NormalizedAudio =
  | { kind: "url"; url: string }
  | { kind: "base64"; data: string; extension: string }
  | { kind: "job"; id: string };

export class VivibeClient {
  readonly provider = "vivibe" as const;
  private apiKey: string;
  private baseUrl: string;
  private pollIntervalMs: number;
  private pollTimeoutMs: number;
  private retryAttempts: number;
  private retryBaseDelayMs: number;

  constructor(options: VivibeClientOptions = {}) {
    this.apiKey = options.apiKey ?? vivibeApiKey();
    this.baseUrl = options.baseUrl ?? vivibeBaseUrl();
    this.pollIntervalMs = options.pollIntervalMs ?? Number(process.env.LUCYLAB_POLL_INTERVAL_MS ?? 2000);
    this.pollTimeoutMs = options.pollTimeoutMs ?? Number(process.env.LUCYLAB_POLL_TIMEOUT_MS ?? 300000);
    this.retryAttempts = options.retryAttempts ?? vivibeRetryAttempts();
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? vivibeRetryBaseDelayMs();
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
      await downloadAudio(resolved.url, finalPath);
    } else {
      await writeFile(finalPath, Buffer.from(stripDataPrefix(resolved.data), "base64"));
    }

    // Capture the SRT sidecar (for captions) when the provider returns one.
    // Best-effort: a missing/failed SRT never blocks synthesis.
    let srtPath: string | undefined;
    const srtUrl = findSrtUrl(pollRaw) ?? findSrtUrl(raw);
    if (srtUrl) {
      const candidate = `${finalPath}.srt`;
      try {
        await downloadText(srtUrl, candidate);
        srtPath = candidate;
      } catch (error) {
        // Non-fatal: captions fall back to even-split timing. Warn so a
        // persistently missing SRT (degraded caption sync) is visible.
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
      duration: await measureAudioDuration(finalPath),
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
      throw new Error("Missing VIVIBE_API_KEY. Add it to .env or your shell environment.");
    }

    const res = await fetchWithRetry(
      () =>
        fetch(this.baseUrl, {
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
      const suffix = retrySuffix(res.status, this.retryAttempts);
      throw new Error(`Vivibe request failed${suffix}: ${res.status} ${res.statusText}`);
    }

    const json = (await res.json()) as JsonRpcResponse<T>;
    if (json.error) {
      throw new Error(`Vivibe JSON-RPC error: ${JSON.stringify(json.error)}`);
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

export type TtsCacheIdentity = {
  provider: CloudTtsProvider | "mock";
  text: string;
  voiceId: string;
  speed: number;
  modelId?: string;
  outputFormat?: string;
  normalizerVersion?: string;
};

export function ttsCacheKey(identity: TtsCacheIdentity): string {
  return createHash("sha256")
    .update(JSON.stringify(identity))
    .digest("hex")
    .slice(0, 20);
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

export function elevenLabsApiKey(): string {
  return process.env.ELEVENLABS_API_KEY ?? "";
}

export function defaultElevenLabsVoiceId(): string | undefined {
  return process.env.ELEVENLABS_VOICE_ID;
}

export function elevenLabsBaseUrl(): string {
  return process.env.ELEVENLABS_BASE_URL ?? "https://api.elevenlabs.io";
}

export type ElevenLabsClientOptions = {
  apiKey?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  measureDuration?: (audioPath: string) => Promise<number>;
};

type ElevenLabsAlignment = {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
};

type ElevenLabsTimestampResponse = {
  audio_base64: string;
  alignment?: ElevenLabsAlignment | null;
  normalized_alignment?: ElevenLabsAlignment | null;
};

/** REST adapter for ElevenLabs. Synthesis is deliberately not auto-retried. */
export class ElevenLabsClient implements TtsClient {
  readonly provider = "elevenlabs" as const;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly measureDuration: (audioPath: string) => Promise<number>;

  constructor(options: ElevenLabsClientOptions = {}) {
    this.apiKey = options.apiKey ?? elevenLabsApiKey();
    this.baseUrl = (options.baseUrl ?? elevenLabsBaseUrl()).replace(/\/$/, "");
    this.fetchImpl = options.fetch ?? fetch;
    this.measureDuration = options.measureDuration ?? measureAudioDuration;
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async listVoices(): Promise<TTSVoice[]> {
    this.assertConfigured();
    const voices: TTSVoice[] = [];
    let nextPageToken: string | undefined;
    do {
      const url = new URL(`${this.baseUrl}/v2/voices`);
      url.searchParams.set("page_size", "100");
      url.searchParams.set("include_total_count", "false");
      if (nextPageToken) url.searchParams.set("next_page_token", nextPageToken);
      const res = await fetchWithRetry(
        () => this.fetchImpl(url, { headers: { "xi-api-key": this.apiKey } }),
        { attempts: 3, baseDelayMs: 500, label: "ElevenLabs voice list" },
      );
      if (!res.ok) throw await elevenLabsHttpError(res, "list voices");
      const body = (await res.json()) as {
        voices?: Array<{ voice_id?: unknown; name?: unknown; preview_url?: unknown }>;
        has_more?: unknown;
        next_page_token?: unknown;
      };
      for (const voice of body.voices ?? []) {
        const id = typeof voice.voice_id === "string" ? voice.voice_id : "";
        if (!id) continue;
        voices.push({
          id,
          name: typeof voice.name === "string" ? voice.name : "Unnamed voice",
          isActive: true,
          ...(typeof voice.preview_url === "string" ? { previewUrl: voice.preview_url } : {}),
        });
      }
      nextPageToken = body.has_more === true && typeof body.next_page_token === "string"
        ? body.next_page_token
        : undefined;
    } while (nextPageToken);
    return voices;
  }

  async synthesize(input: TTSRequest): Promise<TTSResult> {
    this.assertConfigured();
    await mkdir(dirname(input.outputPath), { recursive: true });
    const modelId = input.modelId ?? ELEVENLABS_DEFAULT_MODEL_ID;
    const languageCode = input.languageCode ?? "vi";
    const url = new URL(`${this.baseUrl}/v1/text-to-speech/${encodeURIComponent(input.voiceId)}/with-timestamps`);
    url.searchParams.set("output_format", ELEVENLABS_OUTPUT_FORMAT);
    const body: Record<string, unknown> = {
      text: input.text,
      model_id: modelId,
      language_code: languageCode,
    };
    if (input.speed !== 1) body.voice_settings = { speed: input.speed };

    // A failed/ambiguous generation can consume quota, so the user controls retries.
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", "xi-api-key": this.apiKey },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await elevenLabsHttpError(res, "synthesize speech");
    const json = (await res.json()) as ElevenLabsTimestampResponse;
    if (!json.audio_base64) throw new Error("ElevenLabs response did not contain audio_base64.");

    const audioPath = ensureAudioExtension(input.outputPath, ".mp3");
    await writeFile(audioPath, Buffer.from(stripDataPrefix(json.audio_base64), "base64"));
    const alignment = json.alignment ?? json.normalized_alignment;
    let srtPath: string | undefined;
    if (alignment) {
      const srt = alignmentToSrt(alignment);
      if (srt) {
        srtPath = `${audioPath}.srt`;
        await writeFile(srtPath, srt, "utf8");
      }
    }
    return {
      audioPath,
      duration: await this.measureDuration(audioPath),
      raw: { provider: "elevenlabs", modelId, languageCode, hasAlignment: Boolean(alignment) },
      ...(srtPath ? { srtPath } : {}),
    };
  }

  private assertConfigured(): void {
    if (!this.apiKey) throw new Error("Missing ELEVENLABS_API_KEY.");
  }
}

export function alignmentToSrt(alignment: ElevenLabsAlignment): string {
  const { characters, character_start_times_seconds: starts, character_end_times_seconds: ends } = alignment;
  const size = Math.min(characters.length, starts.length, ends.length);
  const words: Array<{ text: string; start: number; end: number }> = [];
  let text = "";
  let start = 0;
  let end = 0;
  const flush = () => {
    if (text) words.push({ text, start, end });
    text = "";
  };
  for (let i = 0; i < size; i += 1) {
    const char = characters[i]!;
    if (/\s/u.test(char)) {
      flush();
      continue;
    }
    if (!text) start = Math.max(0, starts[i]!);
    text += char;
    end = Math.max(start, ends[i]!);
  }
  flush();
  return words
    .map((word, i) => `${i + 1}\n${srtTimestamp(word.start)} --> ${srtTimestamp(word.end)}\n${word.text}\n`)
    .join("\n");
}

async function elevenLabsHttpError(res: Response, operation: string): Promise<Error> {
  let detail = "";
  try {
    const body = (await res.json()) as { detail?: unknown };
    detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? body);
  } catch {
    detail = res.statusText;
  }
  return new Error(`ElevenLabs ${operation} failed (${res.status}): ${detail}`);
}

function srtTimestamp(seconds: number): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const sec = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const min = totalMinutes % 60;
  const hour = Math.floor(totalMinutes / 60);
  return `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

export async function measureAudioDuration(audioPath: string): Promise<number> {
  try {
    const metadata = await parseFile(audioPath);
    if (metadata.format.duration && Number.isFinite(metadata.format.duration)) {
      return metadata.format.duration;
    }
  } catch {
    /* fall through to ffprobe */
  }
  return measureAudioDurationWithFfprobe(audioPath);
}

export async function synthesizeMockAudio(text: string, outputPath: string): Promise<TTSResult> {
  await mkdir(dirname(outputPath), { recursive: true });
  const seconds = Math.max(2.5, Math.min(12, text.length / 18));
  const wav = createSilentWav(seconds);
  await writeFile(outputPath, wav);
  return { audioPath: outputPath, duration: seconds, raw: { provider: "mock", seconds } };
}

export async function concatAudio(inputs: string[], outputPath: string): Promise<void> {
  if (!inputs.length) {
    throw new Error("Cannot concatenate zero audio files.");
  }
  await mkdir(dirname(outputPath), { recursive: true });
  const listPath = join(dirname(outputPath), "concat-list.txt");
  await writeFile(listPath, inputs.map((input) => `file '${input.replace(/'/g, "'\\''")}'`).join("\n"));
  await runProcess(ffmpegStatic ?? "ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outputPath]);
}

/**
 * Concatenate narration clips with a SILENT BREATH GAP between consecutive
 * clips (author-mode-v2 R4). Re-encodes through a filtergraph so the inserted
 * `anullsrc` silence and the (possibly mixed-codec) clips share one sample
 * format. The total length is `Σ clip_i + (n−1)·gap`, which the lock mirrors so
 * each transition overlap lands on a gap. `gapSeconds <= 0` or a single clip
 * falls back to a plain re-encode/concat.
 */
export async function concatAudioWithGaps(
  inputs: string[],
  gapSeconds: number,
  outputPath: string,
): Promise<void> {
  if (!inputs.length) {
    throw new Error("Cannot concatenate zero audio files.");
  }
  await mkdir(dirname(outputPath), { recursive: true });
  if (inputs.length === 1 || gapSeconds <= 0) {
    await concatAudio(inputs, outputPath);
    return;
  }

  const sr = 48000;
  const args: string[] = ["-y"];
  for (const input of inputs) args.push("-i", input);
  const gapCount = inputs.length - 1;
  for (let i = 0; i < gapCount; i += 1) {
    args.push("-f", "lavfi", "-t", gapSeconds.toFixed(4), "-i", `anullsrc=channel_layout=stereo:sample_rate=${sr}`);
  }

  const norm = (label: string, out: string) =>
    `[${label}]aresample=${sr},aformat=sample_fmts=fltp:channel_layouts=stereo[${out}]`;
  const parts: string[] = [];
  const order: string[] = [];
  inputs.forEach((_, i) => {
    parts.push(norm(`${i}:a`, `c${i}`));
    order.push(`[c${i}]`);
    if (i < gapCount) {
      const silenceIdx = inputs.length + i;
      parts.push(norm(`${silenceIdx}:a`, `g${i}`));
      order.push(`[g${i}]`);
    }
  });
  const filter = `${parts.join(";")};${order.join("")}concat=n=${order.length}:v=0:a=1[outa]`;

  await runProcess(ffmpegStatic ?? "ffmpeg", [
    ...args,
    "-filter_complex",
    filter,
    "-map",
    "[outa]",
    "-ar",
    String(sr),
    "-ac",
    "2",
    outputPath,
  ]);
}

export async function normalizeAudioDuration(
  inputPath: string,
  outputPath: string,
  durationSeconds: number,
  startDelaySeconds = 0.25,
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  const actualDuration = await measureAudioDuration(inputPath);

  const filters: string[] = [];
  const speechDuration = actualDuration;

  if (speechDuration > 0) {
    const fadeDuration = Math.min(0.01, speechDuration / 2);
    if (fadeDuration > 0.001) {
      filters.push(`afade=t=in:ss=0:d=${fadeDuration.toFixed(4)}`);
      const fadeOutStart = speechDuration - fadeDuration;
      filters.push(`afade=t=out:st=${fadeOutStart.toFixed(4)}:d=${fadeDuration.toFixed(4)}`);
    }
  }

  if (startDelaySeconds > 0) {
    const delayMs = Math.round(startDelaySeconds * 1000);
    filters.push(`adelay=${delayMs}|${delayMs}`);
  }

  filters.push("apad");

  await runProcess(ffmpegStatic ?? "ffmpeg", [
    "-y",
    "-i",
    inputPath,
    "-filter_complex",
    `[0:a]${filters.length ? filters.join(",") : "anull"}[outa]`,
    "-map",
    "[outa]",
    "-t",
    String(durationSeconds),
    "-ar",
    "48000",
    "-ac",
    "2",
    outputPath,
  ]);
}

export async function mixBgm(
  voicePath: string,
  bgmPath: string,
  outputPath: string,
  volume = 0.2,
  fadeDurationSeconds = 3.0,
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  const voiceDuration = await measureAudioDuration(voicePath);
  const bgmFadeStart = Math.max(0, voiceDuration - fadeDurationSeconds);

  const filterComplex =
    `[0:a]volume=1.0[voice];` +
    `[1:a]volume=${volume.toFixed(4)},afade=t=out:st=${bgmFadeStart.toFixed(4)}:d=${fadeDurationSeconds.toFixed(4)}[bgm];` +
    `[voice][bgm]amix=inputs=2:duration=first:dropout_transition=3[outa]`;

  await runProcess(ffmpegStatic ?? "ffmpeg", [
    "-y",
    "-i",
    voicePath,
    "-stream_loop",
    "-1",
    "-i",
    bgmPath,
    "-filter_complex",
    filterComplex,
    "-map",
    "[outa]",
    "-t",
    String(voiceDuration),
    "-ar",
    "48000",
    "-ac",
    "2",
    outputPath,
  ]);
}

function normalizeAudioResponse(raw: unknown, options: { allowJob?: boolean } = { allowJob: true }): NormalizedAudio {
  const candidates = collectObjects(raw);
  for (const item of candidates) {
    for (const key of ["audioUrl", "url", "fileUrl", "downloadUrl", "mediaUrl"]) {
      const value = item[key];
      if (typeof value === "string" && /^https?:\/\//i.test(value)) {
        return { kind: "url", url: value };
      }
    }
    for (const key of ["audioBase64", "base64", "data"]) {
      const value = item[key];
      if (typeof value === "string" && value.length > 64) {
        return { kind: "base64", data: value, extension: detectBase64Extension(value) };
      }
    }
    if (options.allowJob === false) continue;
    for (const key of ["projectExportId", "taskId", "jobId", "id"]) {
      const value = item[key];
      if (typeof value === "string" && value.length > 0) {
        return { kind: "job", id: value };
      }
    }
  }
  throw new Error(`Could not find audio URL/base64/job id in Vivibe result: ${JSON.stringify(raw)}`);
}

async function downloadAudio(url: string, outputPath: string): Promise<void> {
  const attempts = vivibeRetryAttempts();
  const res = await fetchWithRetry(() => fetch(url), {
    attempts,
    baseDelayMs: vivibeRetryBaseDelayMs(),
    label: "Vivibe audio download",
  });
  if (!res.ok) {
    const suffix = retrySuffix(res.status, attempts);
    throw new Error(`Failed to download Vivibe audio${suffix}: ${res.status} ${res.statusText}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  await writeFile(outputPath, buffer);
}

/** Find an SRT subtitle URL anywhere in a Vivibe response (used for captions). */
function findSrtUrl(raw: unknown): string | null {
  for (const item of collectObjects(raw)) {
    for (const key of ["srtUrl", "subtitleUrl", "captionUrl", "srt"]) {
      const value = item[key];
      if (typeof value === "string" && /^https?:\/\//i.test(value)) return value;
    }
    // Any string field that points at a .srt file.
    for (const value of Object.values(item)) {
      if (typeof value === "string" && /^https?:\/\/\S+\.srt(\?|$)/i.test(value)) return value;
    }
  }
  return null;
}

/** Download a text resource (e.g. an SRT file) to disk. Best-effort, with retry. */
async function downloadText(url: string, outputPath: string): Promise<void> {
  const attempts = vivibeRetryAttempts();
  const res = await fetchWithRetry(() => fetch(url), {
    attempts,
    baseDelayMs: vivibeRetryBaseDelayMs(),
    label: "Vivibe SRT download",
  });
  if (!res.ok) {
    throw new Error(`Failed to download SRT: ${res.status} ${res.statusText}`);
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, await res.text(), "utf8");
}

const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

async function fetchWithRetry(
  fetcher: () => Promise<Response>,
  options: { attempts: number; baseDelayMs: number; label: string },
): Promise<Response> {
  const attempts = Math.max(1, Math.floor(options.attempts));
  const baseDelayMs = Math.max(0, Math.floor(options.baseDelayMs));
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetcher();
      if (res.ok || !isRetryableStatus(res.status) || attempt === attempts) {
        return res;
      }
    } catch (error) {
      if (attempt === attempts) {
        throw new Error(
          `${options.label} failed after ${attempts} attempt${attempts === 1 ? "" : "s"}: ${errorMessage(error)}`,
        );
      }
    }
    await sleep(backoffDelayMs(baseDelayMs, attempt));
  }
  throw new Error(`${options.label} failed before receiving a response.`);
}

function isRetryableStatus(status: number): boolean {
  return RETRYABLE_HTTP_STATUSES.has(status);
}

function retrySuffix(status: number, attempts: number): string {
  return isRetryableStatus(status) && attempts > 1 ? ` after ${attempts} attempts` : "";
}

function backoffDelayMs(baseDelayMs: number, attempt: number): number {
  return Math.min(10_000, baseDelayMs * 2 ** Math.max(0, attempt - 1));
}

function sleep(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

function integerEnv(names: string[], fallback: number, range: { min: number; max: number }): number {
  for (const name of names) {
    const raw = process.env[name];
    if (!raw) continue;
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed >= range.min && parsed <= range.max) {
      return parsed;
    }
  }
  return fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function extensionFromUrl(url: string): string {
  const clean = url.split("?")[0] ?? url;
  const ext = extname(clean);
  return ext || ".mp3";
}

function readState(raw: unknown): string | null {
  const [first] = collectObjects(raw);
  const state = first?.state ?? first?.status;
  return typeof state === "string" ? state.toLowerCase() : null;
}

function collectObjects(raw: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    out.push(value as Record<string, unknown>);
    Object.values(value as Record<string, unknown>).forEach(visit);
  };
  visit(raw);
  return out;
}

function ensureAudioExtension(path: string, extension = ".mp3"): string {
  return extname(path) ? path : `${path}${extension}`;
}

function detectBase64Extension(value: string): string {
  if (value.startsWith("data:audio/wav") || value.startsWith("data:audio/x-wav")) return ".wav";
  if (value.startsWith("data:audio/mpeg") || value.startsWith("data:audio/mp3")) return ".mp3";
  return ".mp3";
}

function stripDataPrefix(value: string): string {
  const comma = value.indexOf(",");
  return value.startsWith("data:") && comma !== -1 ? value.slice(comma + 1) : value;
}

async function measureAudioDurationWithFfprobe(audioPath: string): Promise<number> {
  const ffprobePath = ffprobeStatic.path;
  const output = await runProcess(ffprobePath, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=nw=1:nk=1",
    audioPath,
  ]);
  const duration = Number(output.trim());
  if (!Number.isFinite(duration)) {
    throw new Error(`Unable to measure duration for ${basename(audioPath)}.`);
  }
  return duration;
}

function runProcess(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} exited ${code}: ${stderr}`));
    });
  });
}

function createSilentWav(durationSeconds: number): Buffer {
  const sampleRate = 48_000;
  const channels = 1;
  const bitsPerSample = 16;
  const samples = Math.ceil(durationSeconds * sampleRate);
  const dataSize = samples * channels * (bitsPerSample / 8);
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
  buffer.writeUInt16LE(channels * (bitsPerSample / 8), 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}
