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
};

export type TTSRequest = {
  text: string;
  voiceId: string;
  speed: number;
  outputPath: string;
};

export type TTSResult = {
  audioPath: string;
  duration: number;
  raw: unknown;
};

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
      resolved = await this.pollExportStatus(exportId);
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
        resolved = await this.pollExportStatus(audio.id);
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

  private async pollExportStatus(projectExportId: string): Promise<Extract<NormalizedAudio, { kind: "url" | "base64" }>> {
    const deadline = Date.now() + this.pollTimeoutMs;
    let lastResult: unknown = null;
    while (Date.now() < deadline) {
      const result = await this.call<unknown>("getExportStatus", { projectExportId });
      lastResult = result;
      try {
        const normalized = normalizeAudioResponse(result, { allowJob: false });
        if (normalized.kind === "url" || normalized.kind === "base64") {
          return normalized;
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

export function ttsCacheKey(text: string, voiceId: string, speed: number): string {
  return createHash("sha256").update(JSON.stringify({ text, voiceId, speed })).digest("hex").slice(0, 20);
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
  volume = 0.1,
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
