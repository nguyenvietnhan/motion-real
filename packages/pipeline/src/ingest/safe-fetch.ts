import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { PipelineError } from "../errors.js";

/**
 * SSRF guard for outbound article fetches (audit P1-2). User-pasted URLs are
 * fetched server-side (Electron main), so without a guard a brief could reach
 * the bundled localhost gateway (127.0.0.1:20128), cloud metadata
 * (169.254.169.254), or LAN hosts, and capture the response into a file + the
 * authoring prompt — an exfiltration channel. This module:
 *   1. resolves the target host and REJECTS loopback / private / link-local /
 *      ULA / unspecified addresses (literal IPs are checked directly; hostnames
 *      via DNS so a public name that resolves inward is still blocked),
 *   2. follows redirects MANUALLY and re-validates every hop (a public URL that
 *      302-redirects to an internal target is blocked at the hop), and
 *   3. caps the response body so a huge response can't exhaust memory.
 * The `fetchImpl`/`lookupImpl` seams keep it unit-testable with no live network.
 */

const MAX_REDIRECTS = 5;
const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MB — articles are text; this is generous.

/** The minimal result shape the ingest path consumes (matches `FetchLike`). */
export type SafeFetchResult = { ok: boolean; status: number; text: () => Promise<string> };

export type SafeFetchOptions = {
  /** Underlying fetch (defaults to global fetch with manual redirects). Test seam. */
  fetchImpl?: (url: string) => Promise<Response>;
  /** DNS resolver returning candidate addresses for a hostname. Test seam. */
  lookupImpl?: (host: string) => Promise<string[]>;
  maxRedirects?: number;
  maxBodyBytes?: number;
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

/**
 * Build an SSRF-guarded fetcher: validates the host (and every redirect hop) and
 * caps the body. Returns a function compatible with the ingest `FetchLike`.
 */
export function makeSafeFetch(opts: SafeFetchOptions = {}): (url: string) => Promise<SafeFetchResult> {
  const fetchImpl = opts.fetchImpl ?? ((u: string) => fetch(u, { redirect: "manual" }));
  const lookupImpl = opts.lookupImpl ?? defaultLookup;
  const maxRedirects = opts.maxRedirects ?? MAX_REDIRECTS;
  const maxBodyBytes = opts.maxBodyBytes ?? MAX_BODY_BYTES;

  return async (url: string): Promise<SafeFetchResult> => {
    let current = url;
    for (let hop = 0; hop <= maxRedirects; hop++) {
      await assertPublicUrl(current, lookupImpl);
      const res = await fetchImpl(current);
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
  };
}
