import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { PipelineError } from "../errors.js";

/**
 * SSRF guard for outbound article fetches (audit P1-2). User-pasted URLs are
 * fetched server-side (Electron main), so without a guard a brief could reach
 * the bundled localhost gateway (127.0.0.1:20128), cloud metadata
 * (169.254.169.254), or LAN hosts, and capture the response into a file + the
 * authoring prompt — an exfiltration channel. This module:
 * 1. resolves the target host and REJECTS loopback / private / link-local /
 * ULA / unspecified addresses (literal IPs are checked directly; hostnames
 * via DNS so a public name that resolves inward is still blocked),
 * 2. follows redirects MANUALLY and re-validates every hop (a public URL that
 * 302-redirects to an internal target is blocked at the hop),
 * 3. caps the response body so a huge response can't exhaust memory, and
 * 4. supports optional AbortSignal + timeout so hung CDNs cannot block create forever.
 * The `fetchImpl`/`lookupImpl` seams keep it unit-testable with no live network.
 */

const MAX_REDIRECTS = 5;
const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MB — articles are text; this is generous.

/** Default deadline for HTML page fetches (article text + crawl page). */
export const DEFAULT_PAGE_FETCH_TIMEOUT_MS = 15_000;
/** Default deadline for per-image binary downloads. */
export const DEFAULT_IMAGE_FETCH_TIMEOUT_MS = 10_000;

/**
 * Browser-like request headers. Without a real User-Agent, news sites behind a
 * CDN (Cloudflare etc.) routinely answer Node's default agent with 403/429 or a
 * bot-challenge page, so the article never reaches Readability and authoring
 * falls back to the model's own (often stale/wrong) knowledge. Sending a normal
 * desktop-Chrome UA + Accept headers gets static article HTML through; JS-only
 * pages still need a headless browser (out of scope) and fail gracefully.
 */
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "vi,en-US;q=0.9,en;q=0.8",
};

/** The minimal result shape the ingest path consumes (matches `FetchLike`). */
export type SafeFetchResult = { ok: boolean; status: number; text: () => Promise<string> };

export type FetchImpl = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

export type SafeFetchOptions = {
  /** Underlying fetch (defaults to global fetch with manual redirects). Test seam. */
  fetchImpl?: FetchImpl;
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
  const records = await lookup(host, { all: true });
  return records.map((r) => r.address);
}

/** Extract the embedded IPv4 from an IPv4-mapped IPv6 address, else null. */
function mappedV4(ip: string): string | null {
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  return m ? m[1]! : null;
}

/**
 * True if `ip` is a non-public address we must never fetch: loopback, private
 * (RFC 1918), link-local, carrier-grade NAT, ULA, or unspecified. Handles
 * IPv4, IPv6, and IPv4-mapped IPv6.
 */
export function isPrivateAddress(ip: string): boolean {
  const v4 = isIP(ip) === 4 ? ip : mappedV4(ip);
  if (v4) {
    const parts = v4.split(".").map((n) => Number(n));
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true; // malformed → deny
    const [a, b] = parts as [number, number, number, number];
    if (a === 0) return true; // 0.0.0.0/8 (incl. unspecified)
    if (a === 10) return true; // 10/8
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 192 && b === 168) return true; // 192.168/16
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
    return false;
  }
  if (isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true; // loopback / unspecified
    if (lower.startsWith("fe80")) return true; // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA fc00::/7
    return false;
  }
  // Not a recognizable IP literal — deny (defensive).
  return true;
}

/**
 * Validate a URL's protocol and that its host does not resolve to a non-public
 * address. Throws a `PipelineError(stage:"ingest")` on any violation.
 */
export async function assertPublicUrl(
  rawUrl: string,
  lookupImpl: (host: string) => Promise<string[]> = defaultLookup,
): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new PipelineError({
      stage: "ingest",
      cause: `invalid URL: ${rawUrl}`,
      remediation: "Provide a full http(s) URL to a public article.",
    });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new PipelineError({
      stage: "ingest",
      cause: `unsupported URL scheme "${url.protocol}" for ${rawUrl}`,
      remediation: "Only http(s) article URLs are allowed.",
    });
  }
  const host = url.hostname;
  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = await lookupImpl(host);
    } catch {
      throw new PipelineError({
        stage: "ingest",
        cause: `could not resolve host "${host}"`,
        remediation: "Check the URL host is correct and reachable.",
      });
    }
  }
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a))) {
    throw new PipelineError({
      stage: "ingest",
      cause: `refusing to fetch a private/loopback/link-local address for ${rawUrl}`,
      remediation: "Use a public article URL — internal, localhost, and LAN addresses are not allowed.",
    });
  }
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

function rethrowFetchFailure(error: unknown, url: string, signal: AbortSignal | undefined, timeoutMs?: number): never {
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

function defaultFetchImpl(url: string, init?: { signal?: AbortSignal }): Promise<Response> {
  return fetch(url, { redirect: "manual", headers: BROWSER_HEADERS, ...(init?.signal ? { signal: init.signal } : {}) });
}

/**
 * Build an SSRF-guarded fetcher: validates the host (and every redirect hop) and
 * caps the body. Returns a function compatible with the ingest `FetchLike`.
 */
export function makeSafeFetch(opts: SafeFetchOptions = {}): (url: string) => Promise<SafeFetchResult> {
  const fetchImpl = opts.fetchImpl ?? defaultFetchImpl;
  const lookupImpl = opts.lookupImpl ?? defaultLookup;
  const maxRedirects = opts.maxRedirects ?? MAX_REDIRECTS;
  const maxBodyBytes = opts.maxBodyBytes ?? MAX_BODY_BYTES;
  const timeoutMs = opts.timeoutMs;

  return async (url: string): Promise<SafeFetchResult> => {
    const signal = mergeFetchSignals(opts.signal, timeoutMs);
    let current = url;
    try {
      for (let hop = 0; hop <= maxRedirects; hop++) {
        if (signal?.aborted) {
          throw new PipelineError({
            stage: "ingest",
            cause: `fetch aborted for ${url}`,
            remediation: "The request was cancelled.",
          });
        }
        await assertPublicUrl(current, lookupImpl);
        const res = await fetchImpl(current, signal ? { signal } : undefined);
        const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
        if (location) {
          current = new URL(location, current).toString();
          continue;
        }
        const text = await readCapped(res, maxBodyBytes);
        return { ok: res.ok, status: res.status, text: async () => text };
      }
      throw new PipelineError({
        stage: "ingest",
        cause: `too many redirects (>${maxRedirects}) starting at ${url}`,
        remediation: "The URL redirects too many times; try the final article URL directly.",
      });
    } catch (error) {
      rethrowFetchFailure(error, url, signal, timeoutMs);
    }
  };
}

/** Per-image download cap (10 MB) — matches the importer's MAX_IMAGE_BYTES. */
const MAX_IMAGE_FETCH_BYTES = 10 * 1024 * 1024;

/** The byte result shape for image downloads (binary-safe, unlike SafeFetchResult). */
export type SafeFetchBytesResult = { ok: boolean; status: number; bytes: Uint8Array };

export type SafeFetchBytesOptions = {
  /** Underlying fetch (defaults to global fetch with manual redirects). Test seam. */
  fetchImpl?: FetchImpl;
  /** DNS resolver returning candidate addresses for a hostname. Test seam. */
  lookupImpl?: (host: string) => Promise<string[]>;
  maxRedirects?: number;
  maxBodyBytes?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
};

/**
 * Build an SSRF-guarded BINARY fetcher for article image downloads.
 * Same host/redirect-hop validation as `makeSafeFetch`, but reads the body into
 * a byte-capped Buffer instead of utf8 text — so an image's bytes are never
 * corrupted by a string decode. The body cap defaults to the importer's 10 MB.
 */
export function makeSafeFetchBytes(opts: SafeFetchBytesOptions = {}): (url: string) => Promise<SafeFetchBytesResult> {
  const fetchImpl = opts.fetchImpl ?? defaultFetchImpl;
  const lookupImpl = opts.lookupImpl ?? defaultLookup;
  const maxRedirects = opts.maxRedirects ?? MAX_REDIRECTS;
  const maxBodyBytes = opts.maxBodyBytes ?? MAX_IMAGE_FETCH_BYTES;
  const timeoutMs = opts.timeoutMs;

  return async (url: string): Promise<SafeFetchBytesResult> => {
    const signal = mergeFetchSignals(opts.signal, timeoutMs);
    let current = url;
    try {
      for (let hop = 0; hop <= maxRedirects; hop++) {
        if (signal?.aborted) {
          throw new PipelineError({
            stage: "ingest",
            cause: `fetch aborted for ${url}`,
            remediation: "The request was cancelled.",
          });
        }
        await assertPublicUrl(current, lookupImpl);
        const res = await fetchImpl(current, signal ? { signal } : undefined);
        const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
        if (location) {
          current = new URL(location, current).toString();
          continue;
        }
        const bytes = await readCappedBytes(res, maxBodyBytes);
        return { ok: res.ok, status: res.status, bytes };
      }
      throw new PipelineError({
        stage: "ingest",
        cause: `too many redirects (>${maxRedirects}) starting at ${url}`,
        remediation: "The image URL redirects too many times; skip it.",
      });
    } catch (error) {
      rethrowFetchFailure(error, url, signal, timeoutMs);
    }
  };
}
