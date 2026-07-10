import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mocks = vi.hoisted(() => ({
  loadManifest: vi.fn(),
  renderProjectStillsUnlocked: vi.fn(),
}));

vi.mock("../authoring/manifest.js", () => ({ loadManifest: mocks.loadManifest }));
vi.mock("./render-stills.js", () => ({ renderProjectStillsUnlocked: mocks.renderProjectStillsUnlocked }));

import { renderThumbnail } from "./render-thumbnail.js";
import { projectPaths } from "../store/store.js";

let tempRoot: string;
let prevHome: string | undefined;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "news-thumb-"));
  prevHome = process.env.VIDEO_TOOL_HOME;
  process.env.VIDEO_TOOL_HOME = tempRoot;
  mocks.loadManifest.mockResolvedValue({
    format: "tiktok",
    scenes: [
      { id: "scene-01", component: "a-scene" },
      { id: "scene-02", component: "b-scene" },
    ],
  });
  mocks.renderProjectStillsUnlocked.mockImplementation(async (projectId: string, opts: { sceneIds?: string[] }) => {
    const paths = projectPaths(projectId);
    const sceneId = opts.sceneIds?.[0] ?? "scene-01";
    const still = join(paths.reviewDir, `${sceneId}.png`);
    await mkdir(paths.reviewDir, { recursive: true });
    await writeFile(still, Buffer.from("caption-free-first-scene"));
    await writeFile(paths.lock, Buffer.from("temporary-no-tts-lock"));
    return { projectId, stills: [still] };
  });
});

afterEach(async () => {
  vi.clearAllMocks();
  if (prevHome === undefined) delete process.env.VIDEO_TOOL_HOME;
  else process.env.VIDEO_TOOL_HOME = prevHome;
  await rm(tempRoot, { recursive: true, force: true });
});

describe("renderThumbnail", () => {
  it("copies the caption-free still of the first scene to review/thumbnail.png", async () => {
    const paths = projectPaths("p1");
    await mkdir(paths.root, { recursive: true });
    await writeFile(paths.lock, Buffer.from("published-full-render-lock"));

    const result = await renderThumbnail("p1");

    expect(mocks.renderProjectStillsUnlocked).toHaveBeenCalledWith("p1", { sceneIds: ["scene-01"] });
    expect(result.path).toBe(join(paths.reviewDir, "thumbnail.png"));
    expect(result.format).toBe("tiktok");
    expect(await readFile(result.path, "utf8")).toBe("caption-free-first-scene");
  });

  it("uses the manifest's actual first scene and delivery format", async () => {
    mocks.loadManifest.mockResolvedValueOnce({
      format: "tiktok",
      scenes: [{ id: "intro", component: "intro-scene" }],
    });

    const result = await renderThumbnail("p1");

    expect(mocks.renderProjectStillsUnlocked).toHaveBeenCalledWith("p1", { sceneIds: ["intro"] });
    expect(result.format).toBe("tiktok");
  });

  it("restores the published full-render lock after a successful cover render", async () => {
    const paths = projectPaths("p1");
    await mkdir(paths.root, { recursive: true });
    await writeFile(paths.lock, Buffer.from("published-full-render-lock"));

    await renderThumbnail("p1");

    expect(await readFile(paths.lock, "utf8")).toBe("published-full-render-lock");
  });

  it("restores the published lock when the still render fails", async () => {
    const paths = projectPaths("p1");
    await mkdir(paths.root, { recursive: true });
    await writeFile(paths.lock, Buffer.from("published-full-render-lock"));
    mocks.renderProjectStillsUnlocked.mockImplementationOnce(async () => {
      await writeFile(paths.lock, Buffer.from("temporary-no-tts-lock"));
      throw new Error("render failed");
    });

    await expect(renderThumbnail("p1")).rejects.toThrow("render failed");
    expect(await readFile(paths.lock, "utf8")).toBe("published-full-render-lock");
  });

  it("removes the temporary lock when the project had no lock before generation", async () => {
    const paths = projectPaths("p1");
    await renderThumbnail("p1");
    await expect(access(paths.lock)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps concurrent thumbnail renders out of the private stills path", async () => {
    const paths = projectPaths("p1");
    let release!: () => void;
    const entered = new Promise<void>((resolveEntered) => {
      mocks.renderProjectStillsUnlocked.mockImplementationOnce(async (projectId: string, opts: { sceneIds?: string[] }) => {
        const sceneId = opts.sceneIds?.[0] ?? "scene-01";
        const still = join(paths.reviewDir, `${sceneId}.png`);
        await mkdir(paths.reviewDir, { recursive: true });
        await writeFile(still, Buffer.from("caption-free-first-scene"));
        await writeFile(paths.lock, Buffer.from("temporary-no-tts-lock"));
        resolveEntered();
        return new Promise<{ projectId: string; stills: string[] }>((resolveRender) => {
          release = () => resolveRender({ projectId, stills: [still] });
        });
      });
    });

    const first = renderThumbnail("p1");
    await entered;

    await expect(renderThumbnail("p1")).rejects.toMatchObject({ stage: "render-lock" });
    expect(mocks.renderProjectStillsUnlocked).toHaveBeenCalledTimes(1);

    release();
    await expect(first).resolves.toMatchObject({ projectId: "p1" });
  });
});
