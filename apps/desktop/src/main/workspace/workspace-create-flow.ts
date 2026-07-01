import type { CrawledImage } from "@news/pipeline";
import type { AuthorImageRef, AuthorInput } from "../agent/agent-worker.js";
import type { CrawledImageVM } from "../../shared/types.js";

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
