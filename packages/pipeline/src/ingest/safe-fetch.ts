import { lookup as dnsLookup } from "node:dns/promises";
import { Agent, fetch as undiciFetch } from "undici";
import { PipelineError } from "../errors.js";
import {
  addressesForPinnedConnect,
  resolvePublicTarget,
  type PublicAddress,
  type ResolvedPublicTarget,
} from "./public-address.js";

/**
 * SSRF guard for outbound article/image fetches. User-pasted URLs are fetched
 * server-side (Electron main), so without a guard a brief could reach the
 * bundled localhost gateway, cloud metadata, or LAN hosts.
 *
 * Policy:
 * 1. Resolve the host once per hop and classify every candidate address
 *    (`public-address.ts` / `net.BlockList`).
 * 2. Pin the transport DNS lookup to vetted addresses (undici Agent), preferring
 *    IPv4 when available so broken AAAA routes cannot hang image downloads.
 * 3. Follow redirects manually and re-resolve/pin every hop.
 * 4. Cap response bodies; honour AbortSignal + optional timeout.
 * 5. Buffer the response before closing the per-request dispatcher so large
 *    image bodies are not cancelled mid-stream.
 *
 * Corporate HTTP proxies are intentionally unsupported here — do not silently
 * route pinned fetches through an unvetted proxy.
 */

export { isPrivateAddress, resolvePublicTarget, addressesForPinnedConnect } from "./public-address.js";
export type { PublicAddress, ResolvedPublicTarget } from "./public-address.js";

const MAX_REDIRECTS = 5;
const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MB — articles are text; this is generous.

/** Default deadline for HTML page fetches (article text + crawl page). */
export const DEFAULT_PAGE_FETCH_TIMEOUT_MS = 15_000;
/** Default deadline for per-image binary downloads. */
export const DEFAULT_IMAGE_FETCH_TIMEOUT_MS = 10_000;

/**
 * Browser-like request headers. Without a real User-Agent, news sites behind a
 * CDN routinely answer Node's default agent with 403/429 or a bot challenge.
 */
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  // Include image types: the same pin path serves article HTML and crawl images.
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
  "Accept-Language": "vi,en-US;q=0.9,en;q=0.8",
};

/** The minimal result shape the ingest path consumes (matches `FetchLike`). */
export type SafeFetchResult = { ok: boolean; status: number; text: () => Promise<string> };

export type FetchImpl = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

/** Production/test seam: request a already-resolved public target (DNS-pinned). */
export type PinnedRequestImpl = (
  target: ResolvedPublicTarget,
  signal?: AbortSignal,
  maxBodyBytes?: number,
) => Promise<Response>;

export type SafeFetchOptions = {
  /**
   * Legacy test seam: plain URL fetch after public-target resolution.
   * Prefer `requestPinned` when proving transport pinning. When set without
   * `requestPinned`, the resolved target is still computed first (SSRF gate)
   * then this impl is called with the URL string only.
   */
  fetchImpl?: FetchImpl;
  /** DNS-pinned request seam. Production default uses undici with pinned lookup. */
  requestPinned?: PinnedRequestImpl;
  /** DNS resolver returning candidate addresses for a hostname. Test seam. */
  lookupImpl?: (host: string) => Promise<string[]>;
  maxRedirects?: number;
  maxBodyBytes?: number;
  /** Caller cancel (e.g. workspace job abort). */
  signal?: AbortSignal;
  /**
   * Hard deadline in ms. When set (including defaults at call sites), hung
   * network cannot block forever. `0` / negative disables timeout.
   */
  timeoutMs?: number;
};

/** Default DNS lookup: every A/AAAA address for the host (so we check them all). */
async function defaultLookup(host: string): Promise<string[]> {
  const records = await dnsLookup(host, { all: true });
  return records.map((r) => r.address);
}

/**
 * Validate a URL's protocol and that its host does not resolve to a non-public
 * address. Throws a `PipelineError(stage:"ingest")` on any violation.
 */
export async function assertPublicUrl(
  rawUrl: string,
  lookupImpl: (host: string) => Promise<string[]> = defaultLookup,
): Promise<void> {
  await resolvePublicTarget(rawUrl, lookupImpl);
}

/** True when fetch failed because the caller cancelled or the deadline elapsed. */
export function isFetchAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: string }).name;
  if (name === "AbortError" || name === "TimeoutError") return true;
  if (error instanceof PipelineError) {
    return /timed out|aborted/i.test(error.cause);
  }
  return false;
}

/** True when the abort is from a deadline (vs user cancel). */
export function isFetchTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: string }).name;
  if (name === "TimeoutError") return true;
  if (error instanceof PipelineError) return /timed out/i.test(error.cause);
  return false;
}

/** Combine optional user cancel + optional timeout into one signal. */
export function mergeFetchSignals(user?: AbortSignal, timeoutMs?: number): AbortSignal | undefined {
  const signals: AbortSignal[] = [];
  if (user) signals.push(user);
  if (typeof timeoutMs === "number" && timeoutMs > 0) {
    signals.push(AbortSignal.timeout(timeoutMs));
  }
  if (signals.length === 0) return undefined;
  if (signals.length === 1) return signals[0];
  return AbortSignal.any(signals);
}

function abortPipelineError(url: string, timedOut: boolean, timeoutMs?: number): PipelineError {
  return new PipelineError({
    stage: "ingest",
    cause: timedOut
      ? `fetch timed out${timeoutMs ? ` after ${timeoutMs}ms` : ""} for ${url}`
      : `fetch aborted for ${url}`,
    remediation: timedOut
      ? "The page or image took too long to respond; try again or use another URL."
      : "The request was cancelled.",
  });
}

function reasonLooksLikeTimeout(reason: unknown, error: unknown): boolean {
  if (isFetchTimeoutError(error) || isFetchTimeoutError(reason)) return true;
  if (reason instanceof Error && /timeout/i.test(reason.message)) return true;
  return false;
}

function rethrowFetchFailure(
  error: unknown,
  url: string,
  signal: AbortSignal | undefined,
  timeoutMs?: number,
): never {
  if (error instanceof PipelineError) throw error;
  if (signal?.aborted || isFetchAbortError(error)) {
    throw abortPipelineError(url, reasonLooksLikeTimeout(signal?.reason, error), timeoutMs);
  }
  throw error;
}

/** Read a response body, aborting if it exceeds `max` bytes. */
async function readCapped(res: Response, max: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return res.text();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => {});
        throw new PipelineError({
          stage: "ingest",
          cause: `response body exceeded ${max} bytes`,
          remediation: "The page is unexpectedly large; try a different source URL.",
        });
      }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Read a response body into a byte-capped Buffer (binary-safe; for images). */
async function readCappedBytes(res: Response, max: number): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(await res.arrayBuffer());
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => {});
        throw new PipelineError({
          stage: "ingest",
          cause: `response body exceeded ${max} bytes`,
          remediation: "The image is unexpectedly large; skip it.",
        });
      }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks);
}

function createPinnedLookup(addresses: readonly PublicAddress[]) {
  return (
    _hostname: string,
    options: { all?: boolean } | undefined,
    callback: (...args: any[]) => void,
  ): void => {
    if (!addresses.length) {
      const err = Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
      callback(err);
      return;
    }
    if (options && (options as { all?: boolean }).all) {
      callback(
        null,
        addresses.map((a) => ({ address: a.address, family: a.family })),
      );
      return;
    }
    const first = addresses[0]!;
    callback(null, first.address, first.family);
  };
}

/**
 * Production pinned request: undici Agent whose connector DNS lookup returns
 * only the already-vetted addresses (IPv4 preferred). Host header / TLS SNI
 * keep the original hostname via the request URL.
 *
 * The response body is fully buffered before the dispatcher closes — closing
 * first cancels open streams and was hanging/ truncating large image crawls.
 */
export async function requestPinnedWithUndici(
  target: ResolvedPublicTarget,
  signal?: AbortSignal,
  maxBodyBytes = MAX_BODY_BYTES,
): Promise<Response> {
  const dialAddresses = addressesForPinnedConnect(target.addresses);
  const dispatcher = new Agent({
    connect: {
      lookup: createPinnedLookup(dialAddresses) as never,
    },
  });
  try {
    const nativeResponse = await undiciFetch(target.url.toString(), {
      dispatcher,
      redirect: "manual",
      headers: BROWSER_HEADERS,
      ...(signal ? { signal } : {}),
    });
    const res = toStandardResponse(nativeResponse);
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (location) {
      await discardBody(res);
      return new Response(null, { status: res.status, statusText: res.statusText, headers: res.headers });
    }
    await assertContentLength(res, maxBodyBytes);
    // Buffer a capped stream before close so callers can still read it after we return.
    const body = await readCappedBytes(res, maxBodyBytes);
    const headers = new Headers();
    res.headers.forEach((value, key) => {
      headers.set(key, value);
    });
    const exactBody = new Uint8Array(body.byteLength);
    exactBody.set(body);
    return new Response(exactBody.buffer, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  } finally {
    // Close/destroy even on abort or throw so sockets do not leak.
    try {
      await dispatcher.close();
    } catch {
      dispatcher.destroy();
    }
  }
}

/** Convert Undici's package-local DOM types to the runtime's global Response. */
function toStandardResponse(res: {
  status: number;
  statusText: string;
  headers: { forEach(callback: (value: string, key: string) => void): void };
  body: unknown;
}): Response {
  const headers = new Headers();
  res.headers.forEach((value, key) => headers.set(key, value));
  return new Response(res.body as ReadableStream<Uint8Array> | null, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

function resolveRequestPinned(opts: SafeFetchOptions): PinnedRequestImpl {
  if (opts.requestPinned) return opts.requestPinned;
  if (opts.fetchImpl) {
    const fetchImpl = opts.fetchImpl;
    return async (target, signal) => fetchImpl(target.url.toString(), signal ? { signal } : undefined);
  }
  return requestPinnedWithUndici;
}

async function discardBody(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    // ignore — redirect hop is discarded either way
  }
}

async function assertContentLength(res: Response, maxBodyBytes: number): Promise<void> {
  const raw = res.headers.get("content-length");
  if (!raw) return;
  const length = Number(raw);
  if (!Number.isFinite(length) || length < 0 || length <= maxBodyBytes) return;
  await discardBody(res);
  throw new PipelineError({
    stage: "ingest",
    cause: `response body exceeded ${maxBodyBytes} bytes`,
    remediation: "The source is unexpectedly large; try a different URL.",
  });
}

/**
 * Shared redirect + pin engine for text and binary fetchers.
 */
export async function followPublicRedirects<T>(
  url: string,
  signal: AbortSignal | undefined,
  requestPinned: PinnedRequestImpl,
  readBody: (response: Response, maxBytes: number) => Promise<T>,
  opts: {
    lookupImpl: (host: string) => Promise<string[]>;
    maxRedirects: number;
    maxBodyBytes: number;
  },
): Promise<{ ok: boolean; status: number; body: T }> {
  let current = url;
  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    if (signal?.aborted) {
      throw new PipelineError({
        stage: "ingest",
        cause: `fetch aborted for ${url}`,
        remediation: "The request was cancelled.",
      });
    }
    const target = await resolvePublicTarget(current, opts.lookupImpl);
    const res = await requestPinned(target, signal, opts.maxBodyBytes);
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (location) {
      await discardBody(res);
      current = new URL(location, current).toString();
      continue;
    }
    await assertContentLength(res, opts.maxBodyBytes);
    const body = await readBody(res, opts.maxBodyBytes);
    return { ok: res.ok, status: res.status, body };
  }
  throw new PipelineError({
    stage: "ingest",
    cause: `too many redirects (>${opts.maxRedirects}) starting at ${url}`,
    remediation: "The URL redirects too many times; try the final article URL directly.",
  });
}

/**
 * Build an SSRF-guarded fetcher: validates the host (and every redirect hop),
 * pins DNS for the transport, and caps the body.
 */
export function makeSafeFetch(opts: SafeFetchOptions = {}): (url: string) => Promise<SafeFetchResult> {
  const lookupImpl = opts.lookupImpl ?? defaultLookup;
  const maxRedirects = opts.maxRedirects ?? MAX_REDIRECTS;
  const maxBodyBytes = opts.maxBodyBytes ?? MAX_BODY_BYTES;
  const timeoutMs = opts.timeoutMs;
  const requestPinned = resolveRequestPinned(opts);

  return async (url: string): Promise<SafeFetchResult> => {
    const signal = mergeFetchSignals(opts.signal, timeoutMs);
    try {
      const out = await followPublicRedirects(url, signal, requestPinned, readCapped, {
        lookupImpl,
        maxRedirects,
        maxBodyBytes,
      });
      return { ok: out.ok, status: out.status, text: async () => out.body };
    } catch (error) {
      rethrowFetchFailure(error, url, signal, timeoutMs);
    }
  };
}

/** Per-image download cap (10 MB) — matches the importer's MAX_IMAGE_BYTES. */
const MAX_IMAGE_FETCH_BYTES = 10 * 1024 * 1024;

/** The byte result shape for image downloads (binary-safe, unlike SafeFetchResult). */
export type SafeFetchBytesResult = { ok: boolean; status: number; bytes: Uint8Array };

export type SafeFetchBytesOptions = SafeFetchOptions;

/**
 * Build an SSRF-guarded BINARY fetcher for article image downloads.
 * Shares the same redirect/pinning engine as `makeSafeFetch`.
 */
export function makeSafeFetchBytes(
  opts: SafeFetchBytesOptions = {},
): (url: string) => Promise<SafeFetchBytesResult> {
  const lookupImpl = opts.lookupImpl ?? defaultLookup;
  const maxRedirects = opts.maxRedirects ?? MAX_REDIRECTS;
  const maxBodyBytes = opts.maxBodyBytes ?? MAX_IMAGE_FETCH_BYTES;
  const timeoutMs = opts.timeoutMs;
  const requestPinned = resolveRequestPinned(opts);

  return async (url: string): Promise<SafeFetchBytesResult> => {
    const signal = mergeFetchSignals(opts.signal, timeoutMs);
    try {
      const out = await followPublicRedirects(url, signal, requestPinned, readCappedBytes, {
        lookupImpl,
        maxRedirects,
        maxBodyBytes,
      });
      return { ok: out.ok, status: out.status, bytes: out.body };
    } catch (error) {
      rethrowFetchFailure(error, url, signal, timeoutMs);
    }
  };
}
