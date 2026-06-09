import { describe, expect, it } from "vitest";
import { assertPublicUrl, isPrivateAddress, makeSafeFetch } from "./safe-fetch.js";
import { isPipelineError } from "../errors.js";

/**
 * SSRF guard tests (audit P1-2). The default ingest egress must refuse to fetch
 * private/loopback/link-local targets, re-validate every redirect hop, and cap
 * the response body — so a user-pasted URL cannot reach the bundled localhost
 * gateway, cloud metadata, or LAN hosts, directly or via a redirect.
 */

/** A Response-like stub for the underlying fetch seam. */
function res(opts: { status?: number; location?: string; body?: string }): Response {
  const { status = 200, location, body = "<html></html>" } = opts;
  const headers = new Headers();
  if (location) headers.set("location", location);
  return new Response(status >= 300 && status < 400 ? null : body, { status, headers });
}

describe("isPrivateAddress", () => {
  it("flags loopback, private, link-local, CGNAT, ULA, and unspecified", () => {
    for (const ip of ["127.0.0.1", "10.0.0.5", "172.16.3.4", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "::", "fe80::1", "fd00::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it("allows ordinary public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
});

describe("assertPublicUrl", () => {
  const lookup = (addr: string) => async () => [addr];

  it("rejects a non-http(s) scheme", async () => {
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toSatisfy(isPipelineError);
  });

  it("rejects a literal loopback IP without any DNS", async () => {
    await expect(assertPublicUrl("http://127.0.0.1:20128/api/providers")).rejects.toSatisfy(isPipelineError);
  });

  it("rejects cloud-metadata link-local", async () => {
    await expect(assertPublicUrl("http://169.254.169.254/latest/meta-data/")).rejects.toSatisfy(isPipelineError);
  });

  it("rejects a public hostname that resolves to a private address", async () => {
    await expect(assertPublicUrl("http://evil.example.com/", lookup("10.1.2.3"))).rejects.toSatisfy(isPipelineError);
  });

  it("allows a public hostname that resolves to a public address", async () => {
    await expect(assertPublicUrl("https://example.com/article", lookup("93.184.216.34"))).resolves.toBeUndefined();
  });
});

describe("makeSafeFetch", () => {
  it("fetches a public URL and returns the body", async () => {
    const fetcher = makeSafeFetch({
      fetchImpl: async () => res({ body: "<html>ok</html>" }),
      lookupImpl: async () => ["93.184.216.34"],
    });
    const out = await fetcher("https://example.com/a");
    expect(out.ok).toBe(true);
    expect(await out.text()).toContain("ok");
  });

  it("blocks a redirect hop into a private target", async () => {
    const fetcher = makeSafeFetch({
      fetchImpl: async (u) => (u.includes("start") ? res({ status: 302, location: "http://127.0.0.1/secret" }) : res({ body: "leak" })),
      lookupImpl: async () => ["93.184.216.34"],
    });
    await expect(fetcher("https://start.example.com/")).rejects.toSatisfy(isPipelineError);
  });

  it("aborts when the body exceeds the cap", async () => {
    const big = "x".repeat(1024);
    const fetcher = makeSafeFetch({
      fetchImpl: async () => res({ body: big }),
      lookupImpl: async () => ["93.184.216.34"],
      maxBodyBytes: 100,
    });
    await expect(fetcher("https://example.com/big")).rejects.toSatisfy(isPipelineError);
  });

  it("rejects after too many redirects", async () => {
    let n = 0;
    const fetcher = makeSafeFetch({
      fetchImpl: async () => res({ status: 302, location: `https://example.com/hop${n++}` }),
      lookupImpl: async () => ["93.184.216.34"],
      maxRedirects: 3,
    });
    await expect(fetcher("https://example.com/start")).rejects.toSatisfy(isPipelineError);
  });
});
