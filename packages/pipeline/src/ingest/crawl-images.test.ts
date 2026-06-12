import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crawlArticleImages, extractImageCandidates, MAX_CRAWL_IMAGES } from "./crawl-images.js";
import { encodePngRGBA } from "../safety/png.js";
import type { SafeFetchBytesResult } from "./safe-fetch.js";

/**
 * Crawl self-tests (Phase 2 Block B). `extractImageCandidates` is PURE over the
 * HTML string (no network), so it carries the bulk of the coverage; the
 * `crawlArticleImages` integration uses an injected byte-fetcher seam so it never
 * touches the network. The crawl must reuse the Block A importer (content-
 * addressed + caps), coarse-filter by decoded dimensions, cap the count, and skip
 * a bad image without aborting the whole crawl.
 */

/** A real, decodable PNG of the given size. */
function png(width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4).fill(180);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  return new Uint8Array(encodePngRGBA(width, height, rgba));
}

const BASE = "https://news.example.com/article";

describe("extractImageCandidates (pure)", () => {
  it("pulls the og:image lead photo first", () => {
    const html = `<html><head>
      <meta property="og:image" content="https://cdn.example.com/lead.jpg">
    </head><body><article><img src="https://cdn.example.com/body.jpg"></article></body></html>`;
    const out = extractImageCandidates(html, BASE);
    expect(out[0]).toBe("https://cdn.example.com/lead.jpg");
    expect(out).toContain("https://cdn.example.com/body.jpg");
  });

  it("resolves relative img URLs against the page", () => {
    const html = `<article><img src="/photos/a.jpg"><img src="b.png"></article>`;
    const out = extractImageCandidates(html, BASE);
    expect(out).toContain("https://news.example.com/photos/a.jpg");
    expect(out).toContain("https://news.example.com/b.png");
  });

  it("drops data:, svg, and non-http schemes", () => {
    const html = `<article>
      <img src="data:image/png;base64,AAAA">
      <img src="https://cdn.example.com/logo.svg">
      <img src="ftp://x/y.png">
      <img src="https://cdn.example.com/ok.jpg">
    </article>`;
    const out = extractImageCandidates(html, BASE);
    expect(out).toEqual(["https://cdn.example.com/ok.jpg"]);
  });

  it("skips 1x1 tracking pixels (declared width/height)", () => {
    const html = `<article>
      <img src="https://cdn.example.com/pixel.gif" width="1" height="1">
      <img src="https://cdn.example.com/real.jpg">
    </article>`;
    const out = extractImageCandidates(html, BASE);
    expect(out).toEqual(["https://cdn.example.com/real.jpg"]);
  });

  it("dedupes a URL repeated across og:image and inline", () => {
    const html = `<html><head>
      <meta property="og:image" content="https://cdn.example.com/same.jpg">
    </head><body><article><img src="https://cdn.example.com/same.jpg"></article></body></html>`;
    const out = extractImageCandidates(html, BASE);
    expect(out.filter((u) => u === "https://cdn.example.com/same.jpg")).toHaveLength(1);
  });

  it("picks the largest srcset entry when no src/data-src", () => {
    const html = `<article><img srcset="small.jpg 320w, big.jpg 1200w, mid.jpg 640w"></article>`;
    const out = extractImageCandidates(html, BASE);
    expect(out).toContain("https://news.example.com/big.jpg");
  });
});

describe("crawlArticleImages (injected byte-fetcher)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "news-crawl-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** Map each candidate URL to a canned byte response. */
  const fetcherOf = (table: Record<string, Uint8Array>) =>
    async (url: string): Promise<SafeFetchBytesResult> => {
      const bytes = table[url];
      if (!bytes) return { ok: false, status: 404, bytes: new Uint8Array() };
      return { ok: true, status: 200, bytes };
    };

  it("imports candidates content-addressed and returns their refs + dims", async () => {
    const html = `<article>
      <img src="https://cdn.example.com/a.png">
      <img src="https://cdn.example.com/b.png">
    </article>`;
    const got = await crawlArticleImages(html, BASE, dir, {
      fetchBytesImpl: fetcherOf({
        "https://cdn.example.com/a.png": png(400, 300),
        "https://cdn.example.com/b.png": png(500, 500),
      }),
    });
    expect(got).toHaveLength(2);
    expect(got[0]!.ref).toMatch(/^assets\/[0-9a-f]{64}\.png$/);
    expect(got[0]!.width).toBe(400);
    expect(got[1]!.height).toBe(500);
  });

  it("coarse-filters out sub-min-edge logos/icons", async () => {
    const html = `<article>
      <img src="https://cdn.example.com/logo.png">
      <img src="https://cdn.example.com/photo.png">
    </article>`;
    const got = await crawlArticleImages(html, BASE, dir, {
      minEdge: 200,
      fetchBytesImpl: fetcherOf({
        "https://cdn.example.com/logo.png": png(64, 64),
        "https://cdn.example.com/photo.png": png(800, 600),
      }),
    });
    expect(got).toHaveLength(1);
    expect(got[0]!.sourceUrl).toBe("https://cdn.example.com/photo.png");
  });

  it("skips a failed download without aborting the crawl", async () => {
    const html = `<article>
      <img src="https://cdn.example.com/broken.png">
      <img src="https://cdn.example.com/good.png">
    </article>`;
    const got = await crawlArticleImages(html, BASE, dir, {
      fetchBytesImpl: async (url) => {
        if (url.includes("broken")) throw new Error("network boom");
        return { ok: true, status: 200, bytes: png(300, 300) };
      },
    });
    expect(got).toHaveLength(1);
    expect(got[0]!.sourceUrl).toBe("https://cdn.example.com/good.png");
  });

  it("caps the number of imported images", async () => {
    const urls = Array.from({ length: MAX_CRAWL_IMAGES + 5 }, (_, i) => `https://cdn.example.com/p${i}.png`);
    const html = `<article>${urls.map((u) => `<img src="${u}">`).join("")}</article>`;
    const table = Object.fromEntries(urls.map((u, i) => [u, png(300 + i, 300)]));
    const got = await crawlArticleImages(html, BASE, dir, { fetchBytesImpl: fetcherOf(table) });
    expect(got.length).toBeLessThanOrEqual(MAX_CRAWL_IMAGES);
  });
});
