import { describe, expect, it, vi } from "vitest";
import { createThumbnailHandlers } from "./thumbnail-handlers.js";

describe("thumbnail IPC handlers", () => {
  it("normalizes generate project ids before calling the workspace seam", async () => {
    const generateThumbnail = vi.fn(async () => ({ thumbnailUrl: "media://cover.png" }));
    const handlers = createThumbnailHandlers({
      generateThumbnail,
      saveThumbnail: vi.fn(),
    });

    await expect(handlers["thumbnail:generate"](123)).resolves.toEqual({ thumbnailUrl: "media://cover.png" });

    expect(generateThumbnail).toHaveBeenCalledWith("123");
  });

  it("keeps save delegated to the native-save seam", async () => {
    const saveThumbnail = vi.fn(async () => ({ saved: true }));
    const handlers = createThumbnailHandlers({
      generateThumbnail: vi.fn(),
      saveThumbnail,
    });
    const rawProjectId = { toString: () => "p1" };

    await expect(handlers["thumbnail:save"](rawProjectId)).resolves.toEqual({ saved: true });

    expect(saveThumbnail).toHaveBeenCalledWith(rawProjectId);
  });
});
