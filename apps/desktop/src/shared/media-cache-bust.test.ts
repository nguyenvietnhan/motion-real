import { describe, expect, it } from "vitest";
import { withMediaCacheBust } from "./media-cache-bust.js";

describe("withMediaCacheBust", () => {
  it("appends or replaces #r fragment tokens", () => {
    expect(withMediaCacheBust("media://file/project-review/p1/thumbnail.png", 3)).toBe(
      "media://file/project-review/p1/thumbnail.png#r3",
    );
    expect(withMediaCacheBust("media://file/project-review/p1/scene-01.png#r1", 7)).toBe(
      "media://file/project-review/p1/scene-01.png#r7",
    );
    expect(withMediaCacheBust("media://file/x.png", "9")).toBe("media://file/x.png#r9");
  });
});
