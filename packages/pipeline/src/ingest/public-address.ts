import { isIP, BlockList } from "node:net";
import { PipelineError } from "../errors.js";

/**
 * Globally-routable address policy for outbound URL/image fetches.
 *
 * Uses Node's `net.BlockList` (CIDR-correct) rather than string-prefix parsers.
 * The deny table covers IANA/RFC special-purpose ranges the product must never
 * reach from user-pasted article/image URLs: loopback, RFC1918, link-local,
 * CGNAT, documentation/test nets, multicast, unspecified, reserved, ULA, and
 * IPv4-mapped forms of any blocked IPv4.
 *
 * Do not silently shrink this table because one public site misbehaved — change
 * requires an explicit policy decision and tests.
 */

export type PublicAddress = {
  address: string;
  family: 4 | 6;
};

export type ResolvedPublicTarget = {
  url: URL;
  addresses: readonly PublicAddress[];
};

/** Shared block lists — built once, immutable after init. */
const V4_BLOCKS = new BlockList();
const V6_BLOCKS = new BlockList();

function initBlocks(): void {
  // IPv4 special-purpose (non-globally reachable for our egress policy)
  V4_BLOCKS.addSubnet("0.0.0.0", 8, "ipv4"); // "this" network / unspecified
  V4_BLOCKS.addSubnet("10.0.0.0", 8, "ipv4"); // RFC1918
  V4_BLOCKS.addSubnet("100.64.0.0", 10, "ipv4"); // CGNAT
  V4_BLOCKS.addSubnet("127.0.0.0", 8, "ipv4"); // loopback
  V4_BLOCKS.addSubnet("169.254.0.0", 16, "ipv4"); // link-local / metadata
  V4_BLOCKS.addSubnet("172.16.0.0", 12, "ipv4"); // RFC1918
  V4_BLOCKS.addSubnet("192.0.0.0", 24, "ipv4"); // IETF protocol assignments
  V4_BLOCKS.addSubnet("192.0.2.0", 24, "ipv4"); // TEST-NET-1 documentation
  V4_BLOCKS.addSubnet("192.168.0.0", 16, "ipv4"); // RFC1918
  V4_BLOCKS.addSubnet("198.18.0.0", 15, "ipv4"); // benchmarking
  V4_BLOCKS.addSubnet("198.51.100.0", 24, "ipv4"); // TEST-NET-2
  V4_BLOCKS.addSubnet("203.0.113.0", 24, "ipv4"); // TEST-NET-3
  V4_BLOCKS.addSubnet("224.0.0.0", 4, "ipv4"); // multicast
  V4_BLOCKS.addSubnet("240.0.0.0", 4, "ipv4"); // reserved / future use
  V4_BLOCKS.addAddress("255.255.255.255", "ipv4"); // limited broadcast

  // IPv6 special-purpose
  V6_BLOCKS.addAddress("::", "ipv6"); // unspecified
  V6_BLOCKS.addAddress("::1", "ipv6"); // loopback
  V6_BLOCKS.addSubnet("fc00::", 7, "ipv6"); // ULA
  V6_BLOCKS.addSubnet("fe80::", 10, "ipv6"); // link-local (full fe80::/10)
  V6_BLOCKS.addSubnet("ff00::", 8, "ipv6"); // multicast
  V6_BLOCKS.addSubnet("2001:db8::", 32, "ipv6"); // documentation
}

initBlocks();

/** Extract embedded IPv4 from IPv4-mapped IPv6 (`::ffff:a.b.c.d` or `::ffff:7f00:1`). */
export function extractMappedIpv4(ip: string): string | null {
  const lower = ip.toLowerCase();
  // Dotted form: ::ffff:127.0.0.1
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(lower);
  if (dotted) return dotted[1]!;

  // Hex form: ::ffff:7f00:1 → 127.0.0.1
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(lower);
  if (!hex) return null;
  const hi = Number.parseInt(hex[1]!, 16);
  const lo = Number.parseInt(hex[2]!, 16);
  if (!Number.isFinite(hi) || !Number.isFinite(lo) || hi > 0xffff || lo > 0xffff) return null;
  const a = (hi >> 8) & 0xff;
  const b = hi & 0xff;
  const c = (lo >> 8) & 0xff;
  const d = lo & 0xff;
  return `${a}.${b}.${c}.${d}`;
}

/**
 * Classify a single IP literal. Malformed input is blocked (fail closed).
 * Does not perform DNS — callers resolve hostnames first.
 */
export function classifyPublicAddress(address: string): "public" | "blocked" {
  if (typeof address !== "string" || address.length === 0) return "blocked";
  const kind = isIP(address);
  if (kind === 4) {
    return V4_BLOCKS.check(address, "ipv4") ? "blocked" : "public";
  }
  if (kind === 6) {
    const mapped = extractMappedIpv4(address);
    if (mapped) {
      return V4_BLOCKS.check(mapped, "ipv4") ? "blocked" : "public";
    }
    // Normalize for BlockList — Node accepts compressed forms.
    return V6_BLOCKS.check(address, "ipv6") ? "blocked" : "public";
  }
  return "blocked";
}

/**
 * Compatibility: true when the address is not globally routable (or malformed).
 * Name kept for existing call sites; policy is "deny non-public", not only RFC1918.
 */
export function isPrivateAddress(ip: string): boolean {
  return classifyPublicAddress(ip) === "blocked";
}

function publicAddressFromLiteral(ip: string): PublicAddress | null {
  const kind = isIP(ip);
  if (kind === 4) return { address: ip, family: 4 };
  if (kind === 6) return { address: ip, family: 6 };
  return null;
}

/** Stable sort: family 4 before 6, then address string. */
export function sortPublicAddresses(addresses: readonly PublicAddress[]): PublicAddress[] {
  return [...addresses].sort((a, b) => {
    if (a.family !== b.family) return a.family - b.family;
    return a.address.localeCompare(b.address);
  });
}

function deny(rawUrl: string, cause: string, remediation: string): never {
  throw new PipelineError({ stage: "ingest", cause, remediation });
}

/**
 * Resolve a URL to a list of public IP addresses that the transport may use.
 * Any blocked candidate (or empty result) fails closed.
 */
export async function resolvePublicTarget(
  rawUrl: string,
  lookup: (hostname: string) => Promise<string[]>,
): Promise<ResolvedPublicTarget> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    deny(rawUrl, `invalid URL: ${rawUrl}`, "Provide a full http(s) URL to a public article.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    deny(
      rawUrl,
      `unsupported URL scheme "${url.protocol}" for ${rawUrl}`,
      "Only http(s) article URLs are allowed.",
    );
  }

  const host = url.hostname;
  let candidates: string[];
  if (isIP(host)) {
    candidates = [host];
  } else {
    try {
      candidates = await lookup(host);
    } catch {
      deny(
        rawUrl,
        `could not resolve host "${host}"`,
        "Check the URL host is correct and reachable.",
      );
    }
  }

  if (candidates.length === 0) {
    deny(
      rawUrl,
      `could not resolve host "${host}"`,
      "Check the URL host is correct and reachable.",
    );
  }

  const publicList: PublicAddress[] = [];
  for (const addr of candidates) {
    if (classifyPublicAddress(addr) === "blocked") {
      deny(
        rawUrl,
        `refusing to fetch a private/loopback/link-local address for ${rawUrl}`,
        "Use a public article URL — internal, localhost, and LAN addresses are not allowed.",
      );
    }
    const lit = publicAddressFromLiteral(addr);
    if (!lit) {
      deny(
        rawUrl,
        `refusing to fetch a private/loopback/link-local address for ${rawUrl}`,
        "Use a public article URL — internal, localhost, and LAN addresses are not allowed.",
      );
    }
    publicList.push(lit);
  }

  // Deduplicate by address string after classification.
  const seen = new Set<string>();
  const unique = publicList.filter((a) => {
    if (seen.has(a.address)) return false;
    seen.add(a.address);
    return true;
  });

  return { url, addresses: sortPublicAddresses(unique) };
}
