import { describe, expect, it } from "vitest";
import type { CrawledImage } from "@news/pipeline";
import type { AuthorInput } from "../agent/agent-worker.js";
import { authorInputWithCrawledImages, imageReviewViewModelFromCrawledImages } from "./workspace-create-flow.js";

const crawled = (ref: string, width = 800, height = 600): CrawledImage => ({
  ref,
  width,
  height,
  sourceUrl: `https://src.example/${ref}`,
});

describe("workspace create-flow helpers", () => {
  it("folds crawled images into author input while preserving existing image refs and create fields", () => {
    const input: AuthorInput = {
      text: "brief",
      urls: ["https://article.example/a"],
      format: "youtube",
      durationTier: 2,
      videoLanguage: "en",
      images: [{ ref: "local.png", width: 100, height: 200 }],
    };

    expect(authorInputWithCrawledImages(input, [crawled("a.png"), crawled("b.png", 1200, 900)])).toEqual({
      text: "brief",
      urls: ["https://article.example/a"],
      format: "youtube",
      durationTier: 2,
      videoLanguage: "en",
      images: [
        { ref: "local.png", width: 100, height: 200 },
        { ref: "a.png", width: 800, height: 600 },
        { ref: "b.png", width: 1200, height: 900 },
      ],
    });
  });

  it("keeps text-only author input image-free when no crawled images are selected", () => {
    expect(authorInputWithCrawledImages({ text: "brief", urls: [] }, [])).toEqual({
      text: "brief",
      urls: [],
    });
  });

  it("keeps already attached images when the review selection is empty", () => {
    const input: AuthorInput = {
      text: "brief",
      urls: [],
      images: [{ ref: "local.png", width: 100, height: 200 }],
    };

    expect(authorInputWithCrawledImages(input, [])).toEqual(input);
  });

  it("builds image-review cards in crawl order with preview urls and AI suggestions", () => {
    expect(
      imageReviewViewModelFromCrawledImages(
        [crawled("a.png"), crawled("b.png", 1024, 768)],
        new Set(["b.png"]),
        (ref) => `media://asset/${ref}`,
      ),
    ).toEqual([
      {
        ref: "a.png",
        previewUrl: "media://asset/a.png",
        width: 800,
        height: 600,
        sourceUrl: "https://src.example/a.png",
        suggested: false,
      },
      {
        ref: "b.png",
        previewUrl: "media://asset/b.png",
        width: 1024,
        height: 768,
        sourceUrl: "https://src.example/b.png",
        suggested: true,
      },
    ]);
  });
});
