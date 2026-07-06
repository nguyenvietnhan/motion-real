import type { CrawledImage } from "@motionreal/pipeline";

type CrawlLogger = {
  warn: (meta: unknown, message: string) => void;
};

type SafeTextFetchResult = {
  ok: boolean;
  text: () => Promise<string>;
};

export type ArticleImageCrawlerArgs = {
  url: string;
  destDir: string;
  signal?: AbortSignal;
  fetchPage: (url: string) => Promise<SafeTextFetchResult>;
  crawlArticleImages: (html: string, url: string, destDir: string) => Promise<CrawledImage[]>;
  logger: CrawlLogger;
};

/**
 * Best-effort article image crawl. The supplied fetchPage must be the
 * SSRF-guarded text fetcher; binary candidate downloads stay inside the supplied
 * crawlArticleImages implementation.
 */
export async function runArticleImageCrawler(args: ArticleImageCrawlerArgs): Promise<CrawledImage[]> {
  let html: string;
  try {
    const response = await args.fetchPage(args.url);
    if (!response.ok) return [];
    html = await response.text();
  } catch (error) {
    args.logger.warn({ err: error, url: args.url }, "[crawl] page fetch failed; no images crawled");
    return [];
  }

  if (args.signal?.aborted) return [];

  try {
    return await args.crawlArticleImages(html, args.url, args.destDir);
  } catch (error) {
    args.logger.warn({ err: error, url: args.url }, "[crawl] image crawl failed");
    return [];
  }
}
