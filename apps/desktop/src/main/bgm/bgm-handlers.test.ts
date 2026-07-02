import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  BUNDLED_BGM_NAME,
  bgmTrackViewModel,
  createBgmHandlers,
  listBgmViewModels,
  type BgmHandlerDeps,
} from "./bgm-handlers.js";

function track(name: string, sizeBytes: number, path = `V:/bgm/${name}`) {
  return { name, path, sizeBytes };
}

function deps(overrides: Partial<BgmHandlerDeps> = {}): BgmHandlerDeps {
  return {
    workspaceRoot: () => "V:/MotionReal",
    exists: () => false,
    ensureBgmTrack: async (srcPath, name = "default.mp3") => track(name, 1024, srcPath),
    listBgmTracks: async () => [],
    mediaUrl: (path) => `media://${path}`,
    warn: () => undefined,
    pickAudioFiles: async () => null,
    addBgmTrack: async (path) => track(path.split(/[\\/]/).pop() ?? path, 1024, path),
    removeBgmTrack: async () => undefined,
    loadManifest: async () => ({ scenes: [] }),
    writeManifest: async () => undefined,
    ...overrides,
  };
}

describe("bgmTrackViewModel", () => {
  it("labels the bundled track and marks it as built-in", () => {
    expect(bgmTrackViewModel(track(BUNDLED_BGM_NAME, 2 * 1024 * 1024), (path) => `media://${path}`)).toEqual({
      name: BUNDLED_BGM_NAME,
      label: "Nhạc nền mặc định",
      sizeLabel: "2.0 MB",
      previewUrl: `media://V:/bgm/${BUNDLED_BGM_NAME}`,
      builtIn: true,
    });
  });

  it("formats small tracks in KB and keeps their filename label", () => {
    expect(bgmTrackViewModel(track("calm.wav", 1536), () => null)).toEqual({
      name: "calm.wav",
      label: "calm.wav",
      sizeLabel: "2 KB",
      previewUrl: "",
      builtIn: false,
    });
  });
});

describe("listBgmViewModels", () => {
  it("exposes the bundled default when it exists", async () => {
    const ensureBgmTrack = vi.fn(async () => track(BUNDLED_BGM_NAME, 100));
    const result = await listBgmViewModels(
      deps({
        exists: () => true,
        ensureBgmTrack,
        listBgmTracks: async () => [track(BUNDLED_BGM_NAME, 100, "V:/MotionReal/.video-tool/bgm/default.mp3")],
      }),
    );

    expect(ensureBgmTrack).toHaveBeenCalledWith(join("V:/MotionReal", "default.mp3"), BUNDLED_BGM_NAME);
    expect(result).toEqual([
      expect.objectContaining({
        name: BUNDLED_BGM_NAME,
        label: "Nhạc nền mặc định",
        builtIn: true,
      }),
    ]);
  });

  it("logs bundled exposure failures and still returns the library list", async () => {
    const warn = vi.fn();
    const result = await listBgmViewModels(
      deps({
        exists: () => true,
        ensureBgmTrack: async () => {
          throw new Error("locked");
        },
        listBgmTracks: async () => [track("user.mp3", 2048)],
        warn,
      }),
    );

    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ path: join("V:/MotionReal", "default.mp3") }), "failed to expose bundled BGM");
    expect(result.map((item) => item.name)).toEqual(["user.mp3"]);
  });
});

describe("createBgmHandlers", () => {
  it("adds picked tracks, skips bad files, and returns the updated list", async () => {
    const addBgmTrack = vi.fn(async (path: string) => {
      if (path.endsWith("bad.ogg")) throw new Error("unsupported");
      return track("good.mp3", 1024, path);
    });
    const warn = vi.fn();
    const handlers = createBgmHandlers(
      deps({
        pickAudioFiles: async () => ["C:/Music/good.mp3", "C:/Music/bad.ogg"],
        addBgmTrack,
        listBgmTracks: async () => [track("good.mp3", 1024)],
        warn,
      }),
    );

    const result = await handlers["bgm:add"]();

    expect(addBgmTrack).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ path: "C:/Music/bad.ogg" }), "bgm:add skipped file");
    expect(result.map((item) => item.name)).toEqual(["good.mp3"]);
  });

  it("refuses to remove the bundled default track", async () => {
    const removeBgmTrack = vi.fn();
    const handlers = createBgmHandlers(
      deps({
        removeBgmTrack,
        listBgmTracks: async () => [track(BUNDLED_BGM_NAME, 1024)],
      }),
    );

    await handlers["bgm:remove"](BUNDLED_BGM_NAME);

    expect(removeBgmTrack).not.toHaveBeenCalled();
  });

  it("reads a project's selected track and returns null on missing or failed reads", async () => {
    const warn = vi.fn();
    const handlers = createBgmHandlers(
      deps({
        loadManifest: async (projectId) => {
          if (projectId === "broken") throw new Error("missing manifest");
          return projectId === "with-bgm" ? { bgm: "theme.mp3" } : { bgm: "" };
        },
        warn,
      }),
    );

    await expect(handlers["bgm:getForProject"]("with-bgm")).resolves.toBe("theme.mp3");
    await expect(handlers["bgm:getForProject"]("empty")).resolves.toBeNull();
    await expect(handlers["bgm:getForProject"]("broken")).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ projectId: "broken" }), "bgm:getForProject failed");
  });

  it("patches a project's manifest without dropping other fields and clears empty selections", async () => {
    const writeManifest = vi.fn(async () => undefined);
    const handlers = createBgmHandlers(
      deps({
        loadManifest: async () => ({ title: "Demo", scenes: [{ id: "scene-01" }], bgm: "old.mp3" }),
        writeManifest,
      }),
    );

    await handlers["bgm:setForProject"]("p1", "new.mp3");
    await handlers["bgm:setForProject"]("p1", null);

    expect(writeManifest).toHaveBeenNthCalledWith(1, "p1", {
      title: "Demo",
      scenes: [{ id: "scene-01" }],
      bgm: "new.mp3",
    });
    expect(writeManifest).toHaveBeenNthCalledWith(2, "p1", {
      title: "Demo",
      scenes: [{ id: "scene-01" }],
      bgm: undefined,
    });
  });
});
