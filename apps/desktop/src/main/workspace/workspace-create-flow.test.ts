import { describe, expect, it, vi } from "vitest";
import type { CrawledImage } from "@news/pipeline";
import type { AuthorInput } from "../agent/agent-worker.js";
import {
  authorInputWithCrawledImages,
  imageReviewViewModelFromCrawledImages,
  runCreateCrawlThenAuthor,
} from "./workspace-create-flow.js";

const crawled = (ref: string, width = 800, height = 600): CrawledImage => ({
  ref,
  width,
  height,
  sourceUrl: `https://src.example/${ref}`,
});

const createSettings = (
  overrides: Partial<{ imageCrawlAiFilter: boolean; imageCrawlHumanReview: boolean }> = {},
) => ({
  imageCrawlAiFilter: false,
  imageCrawlHumanReview: false,
  ...overrides,
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

  it("continues authoring text-only when image crawl fails", async () => {
    const input: AuthorInput = { text: "tin", urls: ["https://a.example/post"] };
    const runScript = vi.fn(async (_input: AuthorInput) => {});
    const warn = vi.fn();

    await runCreateCrawlThenAuthor({
      projectId: "p1",
      input,
      worker: {
        crawlImages: async () => {
          throw new Error("offline");
        },
      },
      settings: createSettings(),
      setStage: vi.fn(),
      recoverAfterCancel: vi.fn(async () => {}),
      runScript,
      parkReview: vi.fn(),
      previewUrlOf: (ref) => `media://asset/${ref}`,
      warn,
    });

    expect(runScript).toHaveBeenCalledWith(input);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "p1", url: "https://a.example/post", err: expect.any(Error) }),
      "image crawl failed; continuing with remaining links",
    );
  });

  it("runs the AI filter and authors directly with the suggested set when human review is off", async () => {
    const input: AuthorInput = { text: "tin", urls: ["https://a.example/post"] };
    const first = crawled("a.png");
    const second = crawled("b.png", 1200, 900);
    const setStage = vi.fn();
    const runScript = vi.fn(async (_input: AuthorInput) => {});
    const filterCrawledImages = vi.fn(async () => ["b.png"]);

    await runCreateCrawlThenAuthor({
      projectId: "p1",
      input,
      worker: {
        crawlImages: async () => [first, second],
        filterCrawledImages,
      },
      settings: createSettings({ imageCrawlAiFilter: true, imageCrawlHumanReview: false }),
      setStage,
      recoverAfterCancel: vi.fn(async () => {}),
      runScript,
      parkReview: vi.fn(),
      previewUrlOf: (ref) => `media://asset/${ref}`,
      warn: vi.fn(),
    });

    expect(setStage).toHaveBeenCalledWith({ kind: "writing", phase: "image-filter" });
    expect(filterCrawledImages).toHaveBeenCalledWith(
      "p1",
      "tin",
      [
        { ref: "a.png", width: 800, height: 600 },
        { ref: "b.png", width: 1200, height: 900 },
      ],
      undefined,
    );
    expect(runScript).toHaveBeenCalledWith({
      text: "tin",
      urls: ["https://a.example/post"],
      images: [{ ref: "b.png", width: 1200, height: 900 }],
    });
  });

  it("parks human review with suggested preview cards instead of authoring", async () => {
    const input: AuthorInput = { text: "tin", urls: ["https://a.example/post"] };
    const pool = [crawled("a.png"), crawled("b.png", 1024, 768)];
    const setStage = vi.fn();
    const runScript = vi.fn(async (_input: AuthorInput) => {});
    const parkReview = vi.fn();

    await runCreateCrawlThenAuthor({
      projectId: "p1",
      input,
      worker: {
        crawlImages: async () => pool,
        filterCrawledImages: async () => ["a.png"],
      },
      settings: createSettings({ imageCrawlAiFilter: true, imageCrawlHumanReview: true }),
      setStage,
      recoverAfterCancel: vi.fn(async () => {}),
      runScript,
      parkReview,
      previewUrlOf: (ref) => `media://asset/${ref}`,
      warn: vi.fn(),
    });

    expect(parkReview).toHaveBeenCalledWith({ input, pool });
    expect(setStage).toHaveBeenNthCalledWith(1, { kind: "writing", phase: "image-filter" });
    expect(setStage).toHaveBeenNthCalledWith(2, {
      kind: "image-review",
      images: [
        {
          ref: "a.png",
          previewUrl: "media://asset/a.png",
          width: 800,
          height: 600,
          sourceUrl: "https://src.example/a.png",
          suggested: true,
        },
        {
          ref: "b.png",
          previewUrl: "media://asset/b.png",
          width: 1024,
          height: 768,
          sourceUrl: "https://src.example/b.png",
          suggested: false,
        },
      ],
    });
    expect(runScript).not.toHaveBeenCalled();
  });

  it("recovers instead of authoring when cancelled after crawl", async () => {
    const input: AuthorInput = { text: "tin", urls: ["https://a.example/post"] };
    const controller = new AbortController();
    const recoverAfterCancel = vi.fn(async () => {});
    const runScript = vi.fn(async (_input: AuthorInput) => {});

    await runCreateCrawlThenAuthor({
      projectId: "p1",
      input,
      signal: controller.signal,
      worker: {
        crawlImages: async () => {
          controller.abort();
          return [crawled("a.png")];
        },
      },
      settings: createSettings({ imageCrawlHumanReview: true }),
      setStage: vi.fn(),
      recoverAfterCancel,
      runScript,
      parkReview: vi.fn(),
      previewUrlOf: (ref) => `media://asset/${ref}`,
      warn: vi.fn(),
    });

    expect(recoverAfterCancel).toHaveBeenCalledTimes(1);
    expect(runScript).not.toHaveBeenCalled();
  });
});
