import { parseHTML } from "linkedom";
import { importImageBytes } from "../assets/import-image.js";
import {
  DEFAULT_IMAGE_FETCH_TIMEOUT_MS,
  isFetchAbortError,
  isFetchTimeoutError,
  makeSafeFetchBytes,
  type SafeFetchBytesResult,
} from "./safe-fetch.js";

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

export type CrawlImageStats = {
  candidatesFound: number;
  downloadAttempts: number;
  keptAfterDimFilter: number;
  skippedTimeout: number;
  skippedAbort: number;
};

export type CrawlArticleImagesResult = {
  images: CrawledImage[];
  stats: CrawlImageStats;
};

export type CrawlOptions = {
  /** SSRF-guarded binary fetcher (test seam). Defaults to `makeSafeFetchBytes`. */
  fetchBytesImpl?: (url: string) => Promise<SafeFetchBytesResult>;
  maxImages?: number;
  minEdge?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
};

/** `<meta>` property/name keys that carry a lead/share image. */
const META_IMAGE_KEYS = ["og:image", "og:image:url", "og:image:secure_url", "twitter:image", "twitter:image:src"];

/**
 * Extract candidate image URLs from article HTML (PURE — no network). Collects
 * `og:image`/`twitter:image` `<meta>` first (the social lead image), then
 * content `<img>` preferring real lazy attrs over placeholder `src` (data-GIF /
 * empty). Relative URLs resolve against `baseUrl`; `data:`/`svg`/non-http and
 * obvious tracking pixels are dropped; deduped in first-seen order and capped
 * at `MAX_CANDIDATES`.
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
    closest?: (sel: string) => unknown;
  }>;
  for (const img of imgs) {
    if (isTrackingPixel(img)) continue;
    // Prefer data-src (etc.) over placeholder data-GIF `src` — common CMS lazy pattern.
    add(pickImgUrl(img));
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
  const result = await crawlArticleImagesWithStats(html, pageUrl, destDir, opts);
  return result.images;
}

export async function crawlArticleImagesWithStats(
  html: string,
  pageUrl: string,
  destDir: string,
  opts: CrawlOptions = {},
): Promise<CrawlArticleImagesResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_IMAGE_FETCH_TIMEOUT_MS;
  const fetchBytes =
    opts.fetchBytesImpl ??
    makeSafeFetchBytes({
      ...(opts.signal ? { signal: opts.signal } : {}),
      timeoutMs,
    });
  const maxImages = opts.maxImages ?? MAX_CRAWL_IMAGES;
  const minEdge = opts.minEdge ?? MIN_CRAWL_IMAGE_EDGE;
  const candidates = extractImageCandidates(html, pageUrl);

  const stats: CrawlImageStats = {
    candidatesFound: candidates.length,
    downloadAttempts: 0,
    keptAfterDimFilter: 0,
    skippedTimeout: 0,
    skippedAbort: 0,
  };

  const out: CrawledImage[] = [];
  for (const url of candidates) {
    if (out.length >= maxImages) break;
    if (opts.signal?.aborted) {
      stats.skippedAbort += 1;
      break;
    }
    stats.downloadAttempts += 1;
    try {
      const res = await fetchBytes(url);
      if (!res.ok || res.bytes.length === 0) continue;
      const imported = await importImageBytes(res.bytes, destDir, { refPrefix: "assets", minEdge });
      if (!imported.ok) continue;
      stats.keptAfterDimFilter += 1;
      out.push({ ref: imported.ref, width: imported.width, height: imported.height, sourceUrl: url });
    } catch (error) {
      if (isFetchTimeoutError(error)) {
        stats.skippedTimeout += 1;
        continue;
      }
      if (isFetchAbortError(error) || opts.signal?.aborted) {
        stats.skippedAbort += 1;
        break;
      }
      /* one bad image URL never aborts the crawl */
    }
  }
  return { images: out, stats };
}

// --- helpers ---------------------------------------------------------------

const LAZY_URL_ATTRS = [
  "data-src",
  "data-original",
  "data-lazy-src",
  "data-lazy",
  "data-url",
  "data-actualsrc",
  "data-hi-res-src",
  "data-full-src",
  "data-large_image",
  "data-zoom-image",
  "data-image",
] as const;

/** True for empty / data-URI / spacer values that are not real photo URLs. */
export function isPlaceholderSrc(raw: string | null | undefined): boolean {
  const t = (raw ?? "").trim();
  if (!t) return true;
  if (t.startsWith("data:")) return true;
  if (t === "about:blank") return true;
  if (t.startsWith("#")) return true;
  if (/spacer|pixel\.|1x1|blank\.(gif|png|jpg)|transparent\.(gif|png)/i.test(t)) return true;
  return false;
}

/**
 * Pick the best raw URL from an `<img>`. Prefers CMS lazy attrs over placeholder
 * `src` (data-GIF). General pattern — not site-specific.
 */
export function pickImgUrl(img: {
  getAttribute(name: string): string | null;
  closest?: (sel: string) => unknown;
}): string | null {
  for (const attr of LAZY_URL_ATTRS) {
    const v = img.getAttribute(attr);
    if (v && !isPlaceholderSrc(v)) return v.trim();
  }
  const dataSrcset = largestSrcset(img.getAttribute("data-srcset"));
  if (dataSrcset && !isPlaceholderSrc(dataSrcset)) return dataSrcset;
  const srcset = largestSrcset(img.getAttribute("srcset"));
  if (srcset && !isPlaceholderSrc(srcset)) return srcset;
  try {
    if (typeof img.closest === "function") {
      const picture = img.closest("picture") as {
        querySelectorAll?: (s: string) => ArrayLike<{ getAttribute(n: string): string | null }>;
      } | null;
      const sources = picture?.querySelectorAll?.("source");
      if (sources) {
        for (let i = 0; i < sources.length; i++) {
          const source = sources[i]!;
          const fromSet =
            largestSrcset(source.getAttribute("srcset") ?? source.getAttribute("data-srcset")) ??
            source.getAttribute("src") ??
            source.getAttribute("data-src");
          if (fromSet && !isPlaceholderSrc(fromSet)) return fromSet.trim();
        }
      }
    }
  } catch {
    /* ignore */
  }
  const src = img.getAttribute("src");
  if (src && !isPlaceholderSrc(src)) return src.trim();
  return null;
}

/** Resolve a possibly-relative URL against the page; keep only http(s). */
function resolveUrl(raw: string | null | undefined, base: string): string | null {
  const trimmed = raw?.trim();
  if (!trimmed || isPlaceholderSrc(trimmed)) return null;
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
    if (!url || isPlaceholderSrc(url)) continue;
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
