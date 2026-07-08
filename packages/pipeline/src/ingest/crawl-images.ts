import { parseHTML } from "linkedom";
import { importImageBytes } from "../assets/import-image.js";
import { makeSafeFetchBytes, type SafeFetchBytesResult } from "./safe-fetch.js";

/**
 * Article image crawl. Given a brief link, pull the page's
 * candidate images, download them through the SSRF-guarded binary fetcher, and
 * store each CONTENT-ADDRESSED into the project's `assetsDir` via the create-time image
 * importer (magic-byte sniff + format allowlist + byte/dimension caps + dedupe).
 * The result is the LOCAL `assets/<sha>.<ext>` ref pool the AI-filter / review
 * screen / authoring path then consume — so a crawled image flows into the SAME
 * placement engine as a manually-attached one, and the offline/determinism (N16)
 * invariant holds (refs are local files, never remote URLs at render time).
 *
 * `extractImageCandidates` is PURE over the HTML string (no network) so it is
 * fully unit-testable; `crawlArticleImages` adds the guarded fetch + import and
 * is best-effort per image (one bad URL never aborts the crawl).
 */

/** Max images kept from a single article (after coarse filtering). */
export const MAX_CRAWL_IMAGES = 12;
/** Min decoded edge (px) to keep — drops logos / icons / tracking pixels. */
export const MIN_CRAWL_IMAGE_EDGE = 200;
/** Max candidate URLs we even attempt to download (before dimension filtering). */
const MAX_CANDIDATES = 40;

/** A crawled + imported local image the user/AI may place. */
export type CrawledImage = { ref: string; width: number; height: number; sourceUrl: string };

export type CrawlOptions = {
  /** SSRF-guarded binary fetcher (test seam). Defaults to `makeSafeFetchBytes`. */
  fetchBytesImpl?: (url: string) => Promise<SafeFetchBytesResult>;
  maxImages?: number;
  minEdge?: number;
};

/** `<meta>` property/name keys that carry a lead/share image. */
const META_IMAGE_KEYS = ["og:image", "og:image:url", "og:image:secure_url", "twitter:image", "twitter:image:src"];

/**
 * Extract candidate image URLs from article HTML (PURE — no network). Collects
 * `og:image`/`twitter:image` `<meta>` first (the editorial lead image), then
 * content `<img>` (src / data-src / the largest srcset entry), preferring the
 * `<article>`/`<main>` scope when present. Relative URLs resolve against
 * `baseUrl`; `data:`/`svg`/non-http and obvious tracking pixels are dropped;
 * deduped in first-seen order and capped at `MAX_CANDIDATES`.
 */
export function extractImageCandidates(html: string, baseUrl: string): string[] {
  const { document } = parseHTML(html);
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string | null | undefined): void => {
    const resolved = resolveUrl(raw, baseUrl);
    if (resolved && !seen.has(resolved)) {
      seen.add(resolved);
      out.push(resolved);
    }
  };

  // 1) Editorial lead image(s) from social/meta tags — usually the best photo.
  for (const key of META_IMAGE_KEYS) {
    const byProp = document.querySelector(`meta[property="${key}"]`)?.getAttribute("content");
    if (byProp) add(byProp);
    const byName = document.querySelector(`meta[name="${key}"]`)?.getAttribute("content");
    if (byName) add(byName);
  }

  // 2) Content images, preferring the article/main scope to skip chrome/ads.
  const scope = document.querySelector("article") ?? document.querySelector("main") ?? document;
  const imgs = Array.from(scope.querySelectorAll("img")) as Array<{
    getAttribute(name: string): string | null;
  }>;
  for (const img of imgs) {
    if (isTrackingPixel(img)) continue;
    const src = img.getAttribute("src") ?? img.getAttribute("data-src") ?? largestSrcset(img.getAttribute("srcset"));
    add(src);
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out.slice(0, MAX_CANDIDATES);
}

/**
 * Crawl an article's images: download each candidate through the SSRF-guarded
 * binary fetcher and import it content-addressed into `destDir`. Coarse-filters
 * by DECODED dimensions (skips sub-`minEdge` logos/icons) and caps the count.
 * Best-effort per image — a failed fetch/import/oversize is skipped, never
 * thrown. `html` is the already-fetched page HTML (the caller fetches it once).
 */
export async function crawlArticleImages(
  html: string,
  pageUrl: string,
  destDir: string,
  opts: CrawlOptions = {},
): Promise<CrawledImage[]> {
  const fetchBytes = opts.fetchBytesImpl ?? makeSafeFetchBytes();
  const maxImages = opts.maxImages ?? MAX_CRAWL_IMAGES;
  const minEdge = opts.minEdge ?? MIN_CRAWL_IMAGE_EDGE;
  const candidates = extractImageCandidates(html, pageUrl);

  const out: CrawledImage[] = [];
  for (const url of candidates) {
    if (out.length >= maxImages) break;
    try {
      const res = await fetchBytes(url);
      if (!res.ok || res.bytes.length === 0) continue;
      const imported = await importImageBytes(res.bytes, destDir, { refPrefix: "assets" });
      if (!imported.ok) continue;
      // Coarse dimension filter: skip logos / icons / spacers below the min edge.
      if (imported.width < minEdge || imported.height < minEdge) continue;
      out.push({ ref: imported.ref, width: imported.width, height: imported.height, sourceUrl: url });
    } catch {
      /* one bad image URL never aborts the crawl */
    }
  }
  return out;
}

// --- helpers ---------------------------------------------------------------

/** Resolve a possibly-relative URL against the page; keep only http(s). */
function resolveUrl(raw: string | null | undefined, base: string): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("data:")) return null; // inline data URIs are not crawlable assets
  let u: URL;
  try {
    u = new URL(trimmed, base);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (/\.svg(\?|#|$)/i.test(u.pathname)) return null; // SVG rejected (scriptable; also by the importer)
  return u.toString();
}

/** Pick the highest-resolution URL from a `srcset` attribute (or null). */
function largestSrcset(srcset: string | null): string | null {
  if (!srcset) return null;
  let best: { url: string; w: number } | null = null;
  for (const part of srcset.split(",")) {
    const [url, descriptor] = part.trim().split(/\s+/, 2);
    if (!url) continue;
    const w = descriptor && descriptor.endsWith("w") ? Number(descriptor.slice(0, -1)) : 0;
    if (!best || w > best.w) best = { url, w };
  }
  return best?.url ?? null;
}

/** Heuristic: a 1×1 (or smaller) declared image is a tracking/spacer pixel. */
function isTrackingPixel(img: { getAttribute(name: string): string | null }): boolean {
  const w = Number(img.getAttribute("width"));
  const h = Number(img.getAttribute("height"));
  return (Number.isFinite(w) && w > 0 && w <= 1) || (Number.isFinite(h) && h > 0 && h <= 1);
}
