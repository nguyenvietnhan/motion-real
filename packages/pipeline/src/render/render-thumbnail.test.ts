import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * `renderThumbnail` self-tests (freeform-engine R12, I3). Remotion would
 * download/launch Chromium and the manifest read hits disk, so we mock the heavy
 * renderer calls (`bundle`/`selectComposition`/`renderStill`/`ensureBrowser`) +
 * the manifest read. What we assert is the WIRING: the `Thumbnail` composition is
 * selected with format/title/dominant inputProps (NO scene-frame background —
 * the cover is a clean brand card for both formats), the still is taken at the
 * LAST frame, and the PNG lands at `review/thumbnail.png`.
 */

const mocks = vi.hoisted(() => ({
  bundle: vi.fn(),
  ensureBrowser: vi.fn(),
  selectComposition: vi.fn(),
  renderStill: vi.fn(),
  loadManifest: vi.fn(),
}));

vi.mock("@remotion/bundler", () => ({ bundle: mocks.bundle }));
vi.mock("@remotion/renderer", () => ({
  ensureBrowser: mocks.ensureBrowser,
  selectComposition: mocks.selectComposition,
  renderStill: mocks.renderStill,
}));
vi.mock("../authoring/manifest.js", () => ({ loadManifest: mocks.loadManifest }));

import { renderThumbnail } from "./render-thumbnail.js";
import { projectPaths } from "../store/store.js";

let tempRoot: string;
let prevHome: string | undefined;

const TIKTOK_MANIFEST = {
  title: "Gemma 3 chạy trên máy nhà",
  format: "tiktok" as const,
  theme: { dominant: "#2F5FF0" },
  scenes: [
    { id: "scene-01", component: "a-scene" },
    { id: "scene-02", component: "b-scene" },
  ],
};

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "news-thumb-"));
  prevHome = process.env.VIDEO_TOOL_HOME;
  process.env.VIDEO_TOOL_HOME = tempRoot;

  mocks.bundle.mockResolvedValue("serve://url");
  mocks.ensureBrowser.mockResolvedValue(undefined);
  mocks.selectComposition.mockResolvedValue({ id: "Thumbnail", durationInFrames: 60, fps: 30, width: 1080, height: 1920 });
  mocks.renderStill.mockResolvedValue(undefined);
  mocks.loadManifest.mockResolvedValue(TIKTOK_MANIFEST);
});

afterEach(async () => {
  vi.clearAllMocks();
  if (prevHome === undefined) delete process.env.VIDEO_TOOL_HOME;
  else process.env.VIDEO_TOOL_HOME = prevHome;
  await rm(tempRoot, { recursive: true, force: true });
});

describe("renderThumbnail", () => {
  it("renders the Thumbnail composition (not NewsVideo) at the LAST frame into review/thumbnail.png", async () => {
    const res = await renderThumbnail("p1");

    expect(mocks.selectComposition).toHaveBeenCalledTimes(1);
    expect(mocks.selectComposition.mock.calls[0]![0].id).toBe("Thumbnail");

    const stillArg = mocks.renderStill.mock.calls[0]![0];
    expect(stillArg.frame).toBe(59); // durationInFrames - 1
    expect(stillArg.imageFormat).toBe("png");

    expect(res.path).toBe(join(projectPaths("p1").reviewDir, "thumbnail.png"));
    expect(res.format).toBe("tiktok");
  });

  it("TikTok: a clean brand card — theme wash + title, NO scene-frame background", async () => {
    await renderThumbnail("p1");

    const props = mocks.selectComposition.mock.calls[0]![0].inputProps;
    expect(props.format).toBe("tiktok");
    expect(props.title).toBe("Gemma 3 chạy trên máy nhà");
    expect(props.dominant).toBe("#2F5FF0");
    // An authored scene is itself a text card; compositing the title over a
    // scene frame stacked two big text blocks that collided. The cover must
    // carry NO scene-frame background — it's a purpose-built card.
    expect(props.bgImageSrc).toBeUndefined();
  });

  it("YouTube: the same clean brand card (theme wash + title, no scene frame)", async () => {
    mocks.loadManifest.mockResolvedValueOnce({
      title: "Tại sao mô hình nhỏ đang thắng",
      format: "youtube",
      theme: { dominant: "#2F5FF0" },
      scenes: [{ id: "scene-01", component: "a-scene" }],
    });
    const res = await renderThumbnail("p1");

    const props = mocks.selectComposition.mock.calls[0]![0].inputProps;
    expect(props.format).toBe("youtube");
    expect(props.bgImageSrc).toBeUndefined();
    expect(res.format).toBe("youtube");
  });

  it("falls back to 'Untitled' + a default dominant when the manifest lacks them", async () => {
    mocks.loadManifest.mockResolvedValueOnce({ format: "tiktok", scenes: [{ id: "scene-01", component: "a-scene" }] });
    await renderThumbnail("p1");
    const props = mocks.selectComposition.mock.calls[0]![0].inputProps;
    expect(props.title).toBe("Untitled");
    expect(typeof props.dominant).toBe("string");
    expect(props.dominant.length).toBeGreaterThan(0);
  });
});
