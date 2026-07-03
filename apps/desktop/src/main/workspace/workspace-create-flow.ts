import type { CrawledImage } from "@motionreal/pipeline";
import type { AgentWorker, AuthorImageRef, AuthorInput } from "../agent/agent-worker.js";
import type { CrawledImageVM, ProjectStage } from "../../shared/types.js";

type CreateFlowSettings = {
  readonly imageCrawlAiFilter: boolean;
  readonly imageCrawlHumanReview: boolean;
};

export type PendingImageReview = { input: AuthorInput; pool: CrawledImage[] };

type CreateFlowWarningDetails = { err: unknown; projectId: string; url?: string };

export type RunCreateCrawlThenAuthorOptions = {
  projectId: string;
  input: AuthorInput;
  signal?: AbortSignal;
  worker: Pick<AgentWorker, "crawlImages" | "filterCrawledImages">;
  settings: CreateFlowSettings;
  setStage: (stage: ProjectStage) => void;
  recoverAfterCancel: () => Promise<void>;
  runScript: (input: AuthorInput) => Promise<void>;
  parkReview: (review: PendingImageReview) => void;
  previewUrlOf: (ref: string) => string;
  warn: (details: CreateFlowWarningDetails, message: string) => void;
};

function authorRefsFromCrawledImages(images: CrawledImage[]): AuthorImageRef[] {
  return images.map((image) => ({ ref: image.ref, width: image.width, height: image.height }));
}

export function authorInputWithCrawledImages(input: AuthorInput, images: CrawledImage[]): AuthorInput {
  const refs = authorRefsFromCrawledImages(images);
  const existing = input.images ?? [];
  const merged = [...existing, ...refs];
  return { ...input, ...(merged.length > 0 ? { images: merged } : {}) };
}

export function imageReviewViewModelFromCrawledImages(
  pool: CrawledImage[],
  suggested: Set<string>,
  previewUrlOf: (ref: string) => string,
): CrawledImageVM[] {
  return pool.map((image) => ({
    ref: image.ref,
    previewUrl: previewUrlOf(image.ref),
    width: image.width,
    height: image.height,
    sourceUrl: image.sourceUrl,
    suggested: suggested.has(image.ref),
  }));
}

export async function runCreateCrawlThenAuthor(options: RunCreateCrawlThenAuthorOptions): Promise<void> {
  const {
    projectId,
    input,
    signal,
    worker,
    settings,
    setStage,
    recoverAfterCancel,
    runScript,
    parkReview,
    previewUrlOf,
    warn,
  } = options;
  let pool: CrawledImage[] = [];
  try {
    // Crawl every brief link's images into the project assets (best-effort).
    for (const url of input.urls) {
      if (signal?.aborted) break;
      const got = await (worker.crawlImages?.(projectId, url, signal) ?? Promise.resolve([] as CrawledImage[])).catch((error) => {
        warn({ err: error, projectId, url }, "image crawl failed; continuing with remaining links");
        return [] as CrawledImage[];
      });
      pool.push(...got);
      if (pool.length >= 24) break;
    }
  } catch (error) {
    warn({ err: error, projectId }, "image crawl stage failed; authoring will continue text-only");
    pool = [];
  }
  if (signal?.aborted) {
    await recoverAfterCancel();
    return;
  }

  if (pool.length === 0) {
    await runScript(input);
    return;
  }

  let suggested = new Set<string>();
  if (settings.imageCrawlAiFilter) {
    setStage({ kind: "writing", phase: "image-filter" });
    const refs = authorRefsFromCrawledImages(pool);
    const keep = await (worker.filterCrawledImages?.(projectId, input.text, refs, signal) ?? Promise.resolve([] as string[])).catch(
      (error) => {
        warn({ err: error, projectId }, "image relevance filter failed; using no preselection");
        return [] as string[];
      },
    );
    suggested = new Set(keep);
  }
  if (signal?.aborted) {
    await recoverAfterCancel();
    return;
  }

  if (!settings.imageCrawlHumanReview) {
    const chosen = suggested.size > 0 ? pool.filter((image) => suggested.has(image.ref)) : pool;
    await runScript(authorInputWithCrawledImages(input, chosen));
    return;
  }

  parkReview({ input, pool });
  setStage({
    kind: "image-review",
    images: imageReviewViewModelFromCrawledImages(pool, suggested, previewUrlOf),
  });
}
