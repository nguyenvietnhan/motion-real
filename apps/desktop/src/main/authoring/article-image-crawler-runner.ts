import type { CrawledImage, CrawlImageStats } from "@motionreal/pipeline";
import { isFetchAbortError, isFetchTimeoutError } from "@motionreal/pipeline";

type CrawlLogger = {
  info?: (meta: unknown, message: string) => void;
  warn: (meta: unknown, message: string) => void;
};

type SafeTextFetchResult = {
  ok: boolean;
  status?: number;
  text: () => Promise<string>;
};

export type ArticleImageCrawlReport = {
  url: string;
  pageOk: boolean;
  pageStatus?: number;
  pageError?: string;
  candidatesFound: number;
  downloadAttempts: number;
  keptAfterDimFilter: number;
  skippedTimeout: number;
  skippedAbort: number;
};

export type ArticleImageCrawlerArgs = {
  url: string;
  destDir: string;
  signal?: AbortSignal;
  fetchPage: (url: string) => Promise<SafeTextFetchResult>;
  crawlArticleImages: (
    html: string,
    url: string,
    destDir: string,
    opts?: { signal?: AbortSignal },
  ) => Promise<CrawledImage[] | { images: CrawledImage[]; stats: CrawlImageStats }>;
  logger: CrawlLogger;
};

function emptyStats(): CrawlImageStats {
  return {
    candidatesFound: 0,
    downloadAttempts: 0,
    keptAfterDimFilter: 0,
    skippedTimeout: 0,
    skippedAbort: 0,
  };
}

function pageErrorKind(error: unknown): string {
  if (isFetchTimeoutError(error)) return "timeout";
  if (isFetchAbortError(error)) return "abort";
  if (error instanceof Error) return error.message.slice(0, 160);
  return "error";
}

function emitReport(logger: CrawlLogger, report: ArticleImageCrawlReport): void {
  const message = "article image crawl report";
  if (!report.pageOk || report.keptAfterDimFilter === 0) {
    logger.warn(report, message);
  } else if (logger.info) {
    logger.info(report, message);
  } else {
    logger.warn(report, message);
  }
}

/**
 * Best-effort article image crawl. The supplied fetchPage must be the
 * SSRF-guarded text fetcher; binary candidate downloads stay inside the supplied
 * crawlArticleImages implementation. Emits a structured crawl report log.
 */
export async function runArticleImageCrawler(args: ArticleImageCrawlerArgs): Promise<CrawledImage[]> {
  let html: string;
  let pageStatus: number | undefined;
  try {
    const response = await args.fetchPage(args.url);
    pageStatus = response.status;
    if (!response.ok) {
      emitReport(args.logger, {
        url: args.url,
        pageOk: false,
        pageStatus,
        pageError: `http-${response.status ?? "unknown"}`,
        ...emptyStats(),
      });
      return [];
    }
    html = await response.text();
  } catch (error) {
    args.logger.warn({ err: error, url: args.url }, "[crawl] page fetch failed; no images crawled");
    emitReport(args.logger, {
      url: args.url,
      pageOk: false,
      pageError: pageErrorKind(error),
      ...emptyStats(),
    });
    return [];
  }

  if (args.signal?.aborted) {
    emitReport(args.logger, {
      url: args.url,
      pageOk: true,
      pageStatus,
      pageError: "abort",
      ...emptyStats(),
      skippedAbort: 1,
    });
    return [];
  }

  try {
    const raw = await args.crawlArticleImages(html, args.url, args.destDir, {
      ...(args.signal ? { signal: args.signal } : {}),
    });
    const images = Array.isArray(raw) ? raw : raw.images;
    const stats = Array.isArray(raw)
      ? {
          ...emptyStats(),
          candidatesFound: images.length,
          keptAfterDimFilter: images.length,
        }
      : raw.stats;
    emitReport(args.logger, {
      url: args.url,
      pageOk: true,
      pageStatus,
      candidatesFound: stats.candidatesFound,
      downloadAttempts: stats.downloadAttempts,
      keptAfterDimFilter: stats.keptAfterDimFilter,
      skippedTimeout: stats.skippedTimeout,
      skippedAbort: stats.skippedAbort,
    });
    return images;
  } catch (error) {
    args.logger.warn({ err: error, url: args.url }, "[crawl] image crawl failed");
    emitReport(args.logger, {
      url: args.url,
      pageOk: true,
      pageStatus,
      pageError: pageErrorKind(error),
      ...emptyStats(),
    });
    return [];
  }
}
