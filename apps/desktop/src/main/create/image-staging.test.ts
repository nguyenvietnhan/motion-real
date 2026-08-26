import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  importDroppedImages,
  importPickedImageFiles,
  sweepStagingDir,
  unstageImage,
  type ImageStagingDeps,
} from "./image-staging.js";

function deps(overrides: Partial<ImageStagingDeps> = {}): ImageStagingDeps {
  return {
    stagingDir: () => "V:/MotionReal/.video-tool/staging",
    importImageBytes: async () => ({
      ok: true,
      ref: "staging/abc.png",
      sha: "abc",
      ext: "png",
      width: 16,
      height: 24,
      bytes: 3,
    }),
    mediaUrl: (path) => `media://${path}`,
    readFile: async () => new Uint8Array([1, 2, 3]),
    readdir: async () => [],
    stat: async () => ({ mtimeMs: 0 }),
    rm: async () => undefined,
    now: () => 1_000,
    warn: () => undefined,
    ...overrides,
  };
}

describe("image staging imports", () => {
  it("stages picked image files with preview URL, ref, dimensions, bytes, and source name", async () => {
    const importImageBytes = vi.fn(async () => ({
      ok: true as const,
      ref: "staging/abc.png",
      sha: "abc",
      ext: "png",
      width: 800,
      height: 600,
      bytes: 3,
    }));
    const readFile = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const d = deps({ importImageBytes, readFile });

    const result = await importPickedImageFiles(["C:/Users/me/Pictures/photo.png"], d);

    expect(readFile).toHaveBeenCalledWith("C:/Users/me/Pictures/photo.png");
    expect(importImageBytes).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), d.stagingDir(), { refPrefix: "staging" });
    expect(result).toEqual({
      staged: [
        {
          ref: "staging/abc.png",
          previewUrl: `media://${join(d.stagingDir(), "abc.png")}`,
          width: 800,
          height: 600,
          bytes: 3,
          name: "photo.png",
        },
      ],
      rejected: [],
    });
  });

  it("turns importer rejections into per-file rejections", async () => {
    const result = await importPickedImageFiles(
      ["C:/bad/not-image.svg"],
      deps({
        importImageBytes: async () => ({ ok: false, reason: "unsupported-format" }),
      }),
    );

    expect(result).toEqual({
      staged: [],
      rejected: [{ name: "not-image.svg", reason: "unsupported-format" }],
    });
  });

  it("logs dropped-image failures and continues staging the rest", async () => {
    const warn = vi.fn();
    let calls = 0;
    const importImageBytes = vi.fn<ImageStagingDeps["importImageBytes"]>(async () => {
      calls += 1;
      if (calls === 1) throw new Error("decode");
      return {
        ok: true,
        ref: "staging/good.png",
        sha: "good",
        ext: "png",
        width: 10,
        height: 20,
        bytes: 2,
      };
    });
    const d = deps({ importImageBytes, warn });

    const result = await importDroppedImages(
      [
        { name: "bad.png", dataBase64: Buffer.from([0]).toString("base64") },
        { name: "good.png", dataBase64: Buffer.from([1, 2]).toString("base64") },
      ],
      d,
    );

    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ fileName: "bad.png" }), "dropped image import failed; reporting decode failure");
    expect(result.rejected).toEqual([{ name: "bad.png", reason: "decode-failed" }]);
    expect(result.staged).toEqual([
      expect.objectContaining({
        ref: "staging/good.png",
        name: "good.png",
        width: 10,
        height: 20,
        bytes: 2,
      }),
    ]);
  });
});

describe("image staging cleanup", () => {
  it("unstages only staging refs and collapses traversal to a basename", async () => {
    const rm = vi.fn(async () => undefined);
    const d = deps({ rm });

    await unstageImage("assets/aa.png", d);
    await unstageImage("staging/../evil.png", d);

    expect(rm).toHaveBeenCalledOnce();
    expect(rm).toHaveBeenCalledWith(join(d.stagingDir(), "evil.png"), { force: true });
  });

  it("sweeps only stale entries and logs cleanup failures without throwing", async () => {
    const rm = vi.fn(async () => undefined);
    const warn = vi.fn();
    const d = deps({
      readdir: async () => ["old.png", "fresh.png", "stat-fail.png"],
      stat: async (path) => {
        if (path.endsWith("old.png")) return { mtimeMs: 700 };
        if (path.endsWith("fresh.png")) return { mtimeMs: 950 };
        throw new Error("locked");
      },
      rm,
      warn,
      now: () => 1_000,
    });

    await sweepStagingDir(d, 100);

    expect(rm).toHaveBeenCalledWith(join(d.stagingDir(), "old.png"), { force: true });
    expect(rm).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ entry: "stat-fail.png" }), "staging entry cleanup failed; continuing sweep");
  });

  it("keeps stale entries referenced by a queue job", async () => {
    const rm = vi.fn(async () => undefined);
    const d = deps({
      readdir: async () => ["queued.png", "unused.png"],
      stat: async () => ({ mtimeMs: 0 }),
      rm,
      now: () => 1_000,
    });
    await sweepStagingDir(d, 100, new Set(["staging/queued.png"]));
    expect(rm).toHaveBeenCalledOnce();
    expect(rm).toHaveBeenCalledWith(join(d.stagingDir(), "unused.png"), { force: true });
  });

  it("does not block startup when the staging dir cannot be listed", async () => {
    const warn = vi.fn();
    await expect(
      sweepStagingDir(
        deps({
          readdir: async () => {
            throw new Error("missing");
          },
          warn,
        }),
      ),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.any(Object), "staging directory unavailable; sweep skipped");
  });
});
