import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  safeExportStem,
  saveProjectThumbnail,
  saveProjectVideo,
  type NativeSaveDeps,
} from "./native-save.js";

function deps(overrides: Partial<NativeSaveDeps> = {}): NativeSaveDeps {
  return {
    exists: () => true,
    copyFile: async () => undefined,
    showSaveDialog: async () => ({ canceled: true }),
    currentOutputDir: () => "V:/Exports",
    downloadsDir: () => "V:/Downloads",
    projectTitle: async () => "Demo Video",
    videoSourcePath: (projectId) => `V:/MotionReal/.video-tool/projects/${projectId}/renders/${projectId}.mp4`,
    thumbnailSourcePath: (projectId) => `V:/MotionReal/.video-tool/projects/${projectId}/review/thumbnail.png`,
    warn: () => undefined,
    ...overrides,
  };
}

describe("safeExportStem", () => {
  it("replaces invalid filename characters and falls back when the title is blank", () => {
    expect(safeExportStem('A/B:C*D?"E<>|', "p1")).toBe("A_B_C_D__E___");
    expect(safeExportStem("   ", "p1")).toBe("p1");
  });
});

describe("saveProjectVideo", () => {
  it("returns unsaved without opening the dialog when the source video is missing", async () => {
    const showSaveDialog = vi.fn<NativeSaveDeps["showSaveDialog"]>();
    const copyFile = vi.fn<NativeSaveDeps["copyFile"]>();

    await expect(saveProjectVideo("p1", deps({ exists: () => false, showSaveDialog, copyFile }))).resolves.toEqual({ saved: false });

    expect(showSaveDialog).not.toHaveBeenCalled();
    expect(copyFile).not.toHaveBeenCalled();
  });

  it("uses the configured output dir, sanitized project title, and copies after save confirmation", async () => {
    const copyFile = vi.fn(async () => undefined);
    const showSaveDialog = vi.fn(async () => ({ canceled: false, filePath: "D:/chosen/video.mp4" }));
    const videoSourcePath = vi.fn((projectId: string) => `V:/store/${projectId}.mp4`);

    const result = await saveProjectVideo(
      "p1",
      deps({
        copyFile,
        showSaveDialog,
        projectTitle: async () => "A/B:C",
        videoSourcePath,
      }),
    );

    expect(result).toEqual({ saved: true });
    expect(showSaveDialog).toHaveBeenCalledWith({
      title: "Lưu video",
      defaultPath: join("V:/Exports", "A_B_C.mp4"),
      filters: [{ name: "Video MP4", extensions: ["mp4"] }],
    });
    expect(copyFile).toHaveBeenCalledWith("V:/store/p1.mp4", "D:/chosen/video.mp4");
  });

  it("returns unsaved without copying when the user cancels", async () => {
    const copyFile = vi.fn<NativeSaveDeps["copyFile"]>();

    await expect(saveProjectVideo("p1", deps({ copyFile }))).resolves.toEqual({ saved: false });

    expect(copyFile).not.toHaveBeenCalled();
  });

  it("returns a redacted Vietnamese reason when copying fails", async () => {
    const warn = vi.fn();
    const copyFile = vi.fn(async () => {
      throw new Error("EACCES C:/secret/path.mp4");
    });

    const result = await saveProjectVideo(
      "p1",
      deps({
        copyFile,
        showSaveDialog: async () => ({ canceled: false, filePath: "D:/chosen/video.mp4" }),
        warn,
      }),
    );

    expect(result).toEqual({
      saved: false,
      error: "Không lưu được video ra vị trí đã chọn. Hãy thử lại hoặc chọn thư mục khác.",
    });
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p1" }), "save/export failed");
  });
});

describe("saveProjectThumbnail", () => {
  it("falls back to downloads when outputDir is empty and saves the thumbnail PNG", async () => {
    const copyFile = vi.fn(async () => undefined);
    const showSaveDialog = vi.fn(async () => ({ canceled: false, filePath: "D:/chosen/cover.png" }));
    const thumbnailSourcePath = vi.fn((projectId: string) => `V:/store/${projectId}/thumbnail.png`);

    const result = await saveProjectThumbnail(
      "p1",
      deps({
        copyFile,
        showSaveDialog,
        currentOutputDir: () => "",
        projectTitle: async () => undefined,
        thumbnailSourcePath,
      }),
    );

    expect(result).toEqual({ saved: true });
    expect(showSaveDialog).toHaveBeenCalledWith({
      title: "Lưu ảnh bìa",
      defaultPath: join("V:/Downloads", "p1-cover.png"),
      filters: [{ name: "Ảnh PNG", extensions: ["png"] }],
    });
    expect(copyFile).toHaveBeenCalledWith("V:/store/p1/thumbnail.png", "D:/chosen/cover.png");
  });

  it("returns a redacted Vietnamese reason when thumbnail copying fails", async () => {
    const warn = vi.fn();

    const result = await saveProjectThumbnail(
      "p1",
      deps({
        copyFile: async () => {
          throw new Error("disk full");
        },
        showSaveDialog: async () => ({ canceled: false, filePath: "D:/chosen/cover.png" }),
        warn,
      }),
    );

    expect(result).toEqual({
      saved: false,
      error: "Không lưu được ảnh bìa. Hãy thử lại hoặc chọn thư mục khác.",
    });
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p1" }), "thumbnail export failed");
  });
});
