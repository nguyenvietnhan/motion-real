import { mkdir, writeFile } from "node:fs/promises";
import { dirname, extname } from "node:path";

export type NormalizedAudio =
  | { kind: "url"; url: string }
  | { kind: "base64"; data: string; extension: string }
  | { kind: "job"; id: string };

type DownloadOptions = {
  attempts: number;
  baseDelayMs: number;
  fetchImpl?: typeof fetch;
};

export function normalizeAudioResponse(
  raw: unknown,
  options: { allowJob?: boolean } = { allowJob: true },
): NormalizedAudio {
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

export async function downloadAudio(url: string, outputPath: string, options: DownloadOptions): Promise<void> {
  const attempts = Math.max(1, Math.floor(options.attempts));
  const fetchImpl = options.fetchImpl ?? fetch;
  const res = await fetchWithRetry(() => fetchImpl(url), {
    attempts,
    baseDelayMs: options.baseDelayMs,
    label: "Vivibe audio download",
  });
  if (!res.ok) {
    const suffix = retrySuffix(res.status, attempts);
    throw new Error(`Failed to download Vivibe audio${suffix}: ${res.status} ${res.statusText}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, buffer);
}

/** Find an SRT subtitle URL anywhere in a Vivibe response (used for captions). */
export function findSrtUrl(raw: unknown): string | null {
  for (const item of collectObjects(raw)) {
    for (const key of ["srtUrl", "subtitleUrl", "captionUrl", "srt"]) {
      const value = item[key];
      if (typeof value === "string" && /^https?:\/\//i.test(value)) return value;
    }
    for (const value of Object.values(item)) {
      if (typeof value === "string" && /^https?:\/\/\S+\.srt(\?|$)/i.test(value)) return value;
    }
  }
  return null;
}

/** Download a text resource (e.g. an SRT file) to disk. Best-effort, with retry. */
export async function downloadText(url: string, outputPath: string, options: DownloadOptions): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const res = await fetchWithRetry(() => fetchImpl(url), {
    attempts: options.attempts,
    baseDelayMs: options.baseDelayMs,
    label: "Vivibe SRT download",
  });
  if (!res.ok) {
    throw new Error(`Failed to download SRT: ${res.status} ${res.statusText}`);
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, await res.text(), "utf8");
}

const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export async function fetchWithRetry(
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

export function retrySuffix(status: number, attempts: number): string {
  return isRetryableStatus(status) && attempts > 1 ? ` after ${attempts} attempts` : "";
}

function backoffDelayMs(baseDelayMs: number, attempt: number): number {
  return Math.min(10_000, baseDelayMs * 2 ** Math.max(0, attempt - 1));
}

function sleep(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

export function integerEnv(names: string[], fallback: number, range: { min: number; max: number }): number {
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

export function extensionFromUrl(url: string): string {
  const clean = url.split("?")[0] ?? url;
  const ext = extname(clean);
  return ext || ".mp3";
}

export function readState(raw: unknown): string | null {
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

export function ensureAudioExtension(path: string, extension = ".mp3"): string {
  return extname(path) ? path : `${path}${extension}`;
}

function detectBase64Extension(value: string): string {
  if (value.startsWith("data:audio/wav") || value.startsWith("data:audio/x-wav")) return ".wav";
  if (value.startsWith("data:audio/mpeg") || value.startsWith("data:audio/mp3")) return ".mp3";
  return ".mp3";
}

export function stripDataPrefix(value: string): string {
  const comma = value.indexOf(",");
  return value.startsWith("data:") && comma !== -1 ? value.slice(comma + 1) : value;
}
