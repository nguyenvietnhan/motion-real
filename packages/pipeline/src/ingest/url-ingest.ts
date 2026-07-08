import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { PipelineError } from "../errors.js";
import { planningDir } from "../store/store.js";
import { makeSafeFetch } from "./safe-fetch.js";

/**
 * URL ingest into grounded research files.
 *
 * Fetches an article, extracts its main readable TEXT + METADATA only (via
 * `@mozilla/readability` over a `linkedom` DOM), and writes a grounded research
 * file under `planning/<id>.md` (resolved under VIDEO_TOOL_HOME, never the repo
 * root) with a provenance header. The file is an INPUT artifact for the
 * authoring agent — nothing in the render path reads it, so determinism (N16)
 * is untouched and the evidence gate (N9) still governs what reaches the screen.
 *
 * Hard rule: NO media. No image/video URLs, logos, or asset references are
 * downloaded, embedded, or referenced — the media ban is never breached through
 * ingest. Body is extracted as plain text (no HTML), so img/video
 * markup and their src URLs cannot leak into the research file.
 */

/** Minimal injectable fetch surface (so unit tests run with no live network). */
export type FetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

export type ArticleMetadata = {
  sourceUrl: string;
  title: string;
  site?: string;
  author?: string;
  publishedDate?: string;
  /** ISO provenance timestamp. */
  fetchedAt: string;
};

export type IngestResult = {
  /** Derived slug (or supplied via opts.id). */
  id: string;
  /** Absolute path to planning/<id>.md. */
  researchPath: string;
  metadata: ArticleMetadata;
  wordCount: number;
};

export type IngestOptions = {
  id?: string;
  fetchImpl?: FetchLike;
  /** Override the provenance timestamp (tests). Defaults to now (ISO). */
  now?: () => string;
};

/** Deterministic, filesystem-safe slug from a title or URL (no randomness). */
function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

/** Derive a stable id from supplied id, then title, then URL host+path. */
function deriveId(suppliedId: string | undefined, title: string, url: string): string {
  if (suppliedId && suppliedId.trim()) return slugify(suppliedId);
  const fromTitle = slugify(title);
  if (fromTitle) return fromTitle;
  try {
    const u = new URL(url);
    const fromUrl = slugify(`${u.hostname}-${u.pathname}`);
    if (fromUrl) return fromUrl;
  } catch {
    // fall through
  }
  return "article";
}

/** Read the first present `<meta>` content for any of the given name/property keys. */
function metaContent(document: Document, keys: string[]): string | undefined {
  for (const key of keys) {
    const byProp = document.querySelector(`meta[property="${key}"]`);
    const content = byProp?.getAttribute("content")?.trim();
    if (content) return content;
    const byName = document.querySelector(`meta[name="${key}"]`);
    const named = byName?.getAttribute("content")?.trim();
    if (named) return named;
  }
  return undefined;
}

/**
 * Extract metadata BEFORE running Readability (which mutates/strips the DOM).
 * Falls back to Readability-derived fields for title/site/author where missing.
 */
function extractMetadata(
  document: Document,
  url: string,
  fetchedAt: string,
): { title?: string; site?: string; author?: string; publishedDate?: string } {
  const title = metaContent(document, ["og:title", "twitter:title"]) ?? (document.title?.trim() || undefined);
  const site = metaContent(document, ["og:site_name", "application-name", "twitter:site"]);
  const author = metaContent(document, ["author", "article:author", "og:article:author", "twitter:creator"]);
  const publishedDate =
    metaContent(document, [
      "article:published_time",
      "og:article:published_time",
      "datePublished",
      "date",
      "dc.date",
      "dc.date.issued",
    ]) ?? document.querySelector("time[datetime]")?.getAttribute("datetime")?.trim() ?? undefined;
  void url;
  void fetchedAt;
  return { title, site, author, publishedDate: normalizePublishedDate(publishedDate) };
}

/**
 * Normalize a publication date for the provenance header. Some sites expose a
 * raw Unix epoch (seconds or milliseconds) in the date meta; convert those to an
 * ISO timestamp so the header is human-readable. A value that is already a date
 * string is kept verbatim.
 */
export function normalizePublishedDate(raw?: string): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  if (/^\d{10}$/.test(trimmed)) {
    const d = new Date(Number(trimmed) * 1000);
    return Number.isNaN(d.getTime()) ? trimmed : d.toISOString();
  }
  if (/^\d{13}$/.test(trimmed)) {
    const d = new Date(Number(trimmed));
    return Number.isNaN(d.getTime()) ? trimmed : d.toISOString();
  }
  return trimmed;
}

/** YAML-escape a scalar (provenance values are simple strings). */
function yamlValue(value: string): string {
  // Quote when the value could be misread as YAML (colons, leading specials).
  if (/[:#\n]|^[\s>|&*!%@`"'-]/.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}

function buildResearchFile(metadata: ArticleMetadata, body: string): string {
  const header: string[] = ["---", `sourceUrl: ${yamlValue(metadata.sourceUrl)}`, `title: ${yamlValue(metadata.title)}`];
  if (metadata.site) header.push(`site: ${yamlValue(metadata.site)}`);
  if (metadata.author) header.push(`author: ${yamlValue(metadata.author)}`);
  if (metadata.publishedDate) header.push(`publishedDate: ${yamlValue(metadata.publishedDate)}`);
  header.push(`fetchedAt: ${yamlValue(metadata.fetchedAt)}`, "---");
  return `${header.join("\n")}\n\n# ${metadata.title}\n\n${body}\n`;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * Fetch a URL, extract its main article text + metadata, and write a grounded
 * research file. Throws `PipelineError(stage: "ingest")` on fetch failure or
 * when no readable body is found — and writes NO partial/empty file in that case.
 */
export async function ingestUrl(url: string, opts: IngestOptions = {}): Promise<IngestResult> {
  // Default egress is SSRF-guarded (audit P1-2): rejects private/loopback/
  // link-local hosts, re-validates each redirect hop, and caps the body. Tests
  // inject `fetchImpl` and bypass the guard (they never touch the network).
  const fetchImpl = opts.fetchImpl ?? makeSafeFetch();
  const fetchedAt = (opts.now ?? (() => new Date().toISOString()))();

  let html: string;
  try {
    const response = await fetchImpl(url);
    if (!response.ok) {
      throw new PipelineError({
        stage: "ingest",
        cause: `fetch failed for ${url}: HTTP ${response.status}`,
        remediation: "Verify the URL is reachable and returns a 2xx HTML response.",
      });
    }
    html = await response.text();
  } catch (err) {
    if (err instanceof PipelineError) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    throw new PipelineError({
      stage: "ingest",
      cause: `fetch failed for ${url}: ${reason}`,
      remediation: "Check network connectivity and that the URL is valid and reachable.",
    });
  }

  // Parse a DOM and pull metadata BEFORE Readability mutates the document.
  const { document } = parseHTML(html);
  const meta = extractMetadata(document as unknown as Document, url, fetchedAt);

  let article: ReturnType<Readability["parse"]>;
  try {
    article = new Readability(document as unknown as Document).parse();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new PipelineError({
      stage: "ingest",
      cause: `extraction failed for ${url}: ${reason}`,
      remediation: "The page may not be an article; try a different source URL.",
    });
  }

  // Plain text only (no HTML) — guarantees no img/video markup or src URLs leak.
  const body = (article?.textContent ?? "").trim();
  if (!body) {
    throw new PipelineError({
      stage: "ingest",
      cause: `no extractable article text found at ${url}`,
      remediation: "The page has no readable main content; try a different source URL.",
    });
  }

  const title = (article?.title?.trim() || meta.title || url).trim();
  const site = meta.site ?? article?.siteName ?? undefined;
  const author = meta.author ?? article?.byline ?? undefined;
  const metadata: ArticleMetadata = {
    sourceUrl: url,
    title,
    ...(site ? { site } : {}),
    ...(author ? { author } : {}),
    ...(meta.publishedDate ? { publishedDate: meta.publishedDate } : {}),
    fetchedAt,
  };

  const id = deriveId(opts.id, title, url);
  const dir = planningDir();
  const researchPath = join(dir, `${id}.md`);

  // Only NOW (after a successful extraction) do we touch disk — no partial files.
  await mkdir(dir, { recursive: true });
  await writeFile(researchPath, buildResearchFile(metadata, body), "utf8");

  return { id, researchPath, metadata, wordCount: countWords(body) };
}
