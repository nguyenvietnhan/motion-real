import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import {
  assertPublicUrl,
  isFetchAbortError,
  isPrivateAddress,
  makeSafeFetch,
  makeSafeFetchBytes,
  requestPinnedWithUndici,
  type ResolvedPublicTarget,
} from "./safe-fetch.js";
import { isPipelineError } from "../errors.js";

/**
 * SSRF guard tests. The default ingest egress must refuse private targets,
 * re-validate every redirect hop, pin DNS for the transport, and cap bodies.
 */

/** A Response-like stub for the underlying fetch seam. */
function res(opts: { status?: number; location?: string; body?: string }): Response {
  const { status = 200, location, body = "<html></html>" } = opts;
  const headers = new Headers();
  if (location) headers.set("location", location);
  return new Response(status >= 300 && status < 400 ? null : body, { status, headers });
}

describe("isPrivateAddress (compat re-export)", () => {
  it("flags loopback, private, link-local, CGNAT, ULA, mapped, and unspecified", () => {
    for (const ip of [
      "127.0.0.1",
      "10.0.0.5",
      "172.16.3.4",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "::",
      "fe80::1",
      "fe90::1",
      "fd00::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
    ]) {
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
    await expect(assertPublicUrl("http://127.0.0.1:20128/api/providers")).rejects.toSatisfy(
      isPipelineError,
    );
  });

  it("rejects cloud-metadata link-local", async () => {
    await expect(assertPublicUrl("http://169.254.169.254/latest/meta-data/")).rejects.toSatisfy(
      isPipelineError,
    );
  });

  it("rejects a public hostname that resolves to a private address", async () => {
    await expect(assertPublicUrl("http://evil.example.com/", lookup("10.1.2.3"))).rejects.toSatisfy(
      isPipelineError,
    );
  });

  it("allows a public hostname that resolves to a public address", async () => {
    await expect(
      assertPublicUrl("https://example.com/article", lookup("93.184.216.34")),
    ).resolves.toBeUndefined();
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

  it("blocks a redirect hop into a private target before the second request", async () => {
    const requested: string[] = [];
    const fetcher = makeSafeFetch({
      fetchImpl: async (u) => {
        requested.push(u);
        return u.includes("start")
          ? res({ status: 302, location: "http://127.0.0.1/secret" })
          : res({ body: "leak" });
      },
      lookupImpl: async (host) => {
        if (host === "127.0.0.1") return ["127.0.0.1"];
        return ["93.184.216.34"];
      },
    });
    await expect(fetcher("https://start.example.com/")).rejects.toSatisfy(isPipelineError);
    expect(requested).toEqual(["https://start.example.com/"]);
  });

  it("repins a public → public redirect with a fresh resolved target", async () => {
    const pinnedHosts: string[] = [];
    const fetcher = makeSafeFetch({
      requestPinned: async (target: ResolvedPublicTarget) => {
        pinnedHosts.push(target.url.hostname);
        if (target.url.hostname === "start.example.com") {
          return res({ status: 302, location: "https://final.example.com/page" });
        }
        return res({ body: "<html>final</html>" });
      },
      lookupImpl: async (host) => {
        if (host === "start.example.com") return ["93.184.216.34"];
        if (host === "final.example.com") return ["1.1.1.1"];
        return ["8.8.8.8"];
      },
    });
    const out = await fetcher("https://start.example.com/");
    expect(await out.text()).toContain("final");
    expect(pinnedHosts).toEqual(["start.example.com", "final.example.com"]);
  });

  it("proves the transport receives only the pinned public target (rebinding seam)", async () => {
    const seen: ResolvedPublicTarget[] = [];
    const fetcher = makeSafeFetch({
      requestPinned: async (target) => {
        seen.push(target);
        return res({ body: "ok" });
      },
      // Guard resolves public; a rebinding world would re-resolve private —
      // our seam only ever gets the pinned public list from resolvePublicTarget.
      lookupImpl: async () => ["93.184.216.34"],
    });
    await fetcher("https://rebind.example.com/");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.addresses).toEqual([{ address: "93.184.216.34", family: 4 }]);
    expect(seen[0]!.addresses.every((a) => !isPrivateAddress(a.address))).toBe(true);
  });

  it("still classifies dual-stack hosts as public while dial prefers IPv4", async () => {
    const { addressesForPinnedConnect } = await import("./public-address.js");
    const fetcher = makeSafeFetch({
      requestPinned: async (target) => {
        // Policy list may include AAAA; connect list must prefer A.
        expect(target.addresses.some((a) => a.family === 6)).toBe(true);
        expect(addressesForPinnedConnect(target.addresses).every((a) => a.family === 4)).toBe(true);
        return res({ body: "ok" });
      },
      lookupImpl: async () => ["2607:6bc0::10", "160.79.104.10"],
    });
    const out = await fetcher("https://dual.example.com/");
    expect(await out.text()).toContain("ok");
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

  it("rejects an oversized declared body before reading it", async () => {
    const fetcher = makeSafeFetch({
      fetchImpl: async () => new Response("x".repeat(1024), { headers: { "content-length": "1024" } }),
      lookupImpl: async () => ["93.184.216.34"],
      maxBodyBytes: 100,
    });
    await expect(fetcher("https://example.com/declared-big")).rejects.toSatisfy(isPipelineError);
  });

  it("caps chunked bodies on the production pinned Undici path", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "transfer-encoding": "chunked" });
      response.write("x".repeat(128));
      response.end("x".repeat(128));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      expect(address).not.toBeNull();
      if (!address || typeof address === "string") throw new Error("test server did not bind a TCP port");

      await expect(
        requestPinnedWithUndici(
          { url: new URL(`http://localhost:${address.port}/big`), addresses: [{ address: "127.0.0.1", family: 4 }] },
          undefined,
          100,
        ),
      ).rejects.toSatisfy(isPipelineError);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
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

  it("times out when fetch never resolves", async () => {
    const fetcher = makeSafeFetch({
      fetchImpl: async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
      lookupImpl: async () => ["93.184.216.34"],
      timeoutMs: 30,
    });
    await expect(fetcher("https://example.com/slow")).rejects.toSatisfy(
      (e) => isPipelineError(e) && isFetchAbortError(e),
    );
  });

  it("aborts when the caller signal fires", async () => {
    const ac = new AbortController();
    const fetcher = makeSafeFetch({
      fetchImpl: async (_url, init) => {
        if (init?.signal?.aborted) {
          const err = new Error("aborted");
          err.name = "AbortError";
          throw err;
        }
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              const err = new Error("aborted");
              err.name = "AbortError";
              reject(err);
            },
            { once: true },
          );
        });
      },
      lookupImpl: async () => ["93.184.216.34"],
      signal: ac.signal,
      timeoutMs: 0,
    });
    ac.abort();
    await expect(fetcher("https://example.com/x")).rejects.toSatisfy(isPipelineError);
  });
});

describe("makeSafeFetchBytes", () => {
  /** A Response carrying binary bytes (so a utf8 decode would corrupt them). */
  const binRes = (bytes: Uint8Array, opts: { status?: number; location?: string } = {}): Response => {
    const { status = 200, location } = opts;
    const headers = new Headers();
    if (location) headers.set("location", location);
    return new Response(status >= 300 && status < 400 ? null : (bytes as unknown as BodyInit), {
      status,
      headers,
    });
  };

  it("returns the raw bytes intact (no utf8 corruption)", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x10, 0x80]);
    const fetcher = makeSafeFetchBytes({
      fetchImpl: async () => binRes(bytes),
      lookupImpl: async () => ["93.184.216.34"],
    });
    const out = await fetcher("https://example.com/x.png");
    expect(out.ok).toBe(true);
    expect(Array.from(out.bytes)).toEqual(Array.from(bytes));
  });

  it("still blocks a private host on the bytes path", async () => {
    const fetcher = makeSafeFetchBytes({
      fetchImpl: async () => binRes(new Uint8Array([1, 2, 3])),
      lookupImpl: async () => ["10.1.2.3"],
    });
    await expect(fetcher("https://evil.example.com/x.png")).rejects.toSatisfy(isPipelineError);
  });

  it("re-validates a redirect hop into a private target (parity with text path)", async () => {
    const fetcher = makeSafeFetchBytes({
      fetchImpl: async (u) =>
        u.includes("start")
          ? binRes(new Uint8Array(), { status: 302, location: "http://127.0.0.1/secret.png" })
          : binRes(new Uint8Array([9])),
      lookupImpl: async () => ["93.184.216.34"],
    });
    await expect(fetcher("https://start.example.com/")).rejects.toSatisfy(isPipelineError);
  });

  it("aborts when the image body exceeds the cap", async () => {
    const fetcher = makeSafeFetchBytes({
      fetchImpl: async () => binRes(new Uint8Array(1024)),
      lookupImpl: async () => ["93.184.216.34"],
      maxBodyBytes: 100,
    });
    await expect(fetcher("https://example.com/big.png")).rejects.toSatisfy(isPipelineError);
  });

  it("uses the same requestPinned pinning seam as text fetch", async () => {
    const seen: string[] = [];
    const bytes = new Uint8Array([1, 2, 3]);
    const fetcher = makeSafeFetchBytes({
      requestPinned: async (target) => {
        seen.push(target.addresses.map((a) => a.address).join(","));
        return binRes(bytes);
      },
      lookupImpl: async () => ["1.1.1.1"],
    });
    const out = await fetcher("https://cdn.example.com/a.png");
    expect(Array.from(out.bytes)).toEqual([1, 2, 3]);
    expect(seen).toEqual(["1.1.1.1"]);
  });
});
