import { join } from "node:path";

export type NativeSaveResult = { saved: boolean; error?: string };

export type NativeSaveDialogOptions = {
  title: string;
  defaultPath: string;
  filters: { name: string; extensions: string[] }[];
};

export type NativeSaveDialogResult = {
  canceled: boolean;
  filePath?: string;
};

export type NativeSaveDeps = {
  exists: (path: string) => boolean;
  copyFile: (source: string, destination: string) => Promise<void>;
  showSaveDialog: (options: NativeSaveDialogOptions) => Promise<NativeSaveDialogResult>;
  currentOutputDir: () => string;
  downloadsDir: () => string;
  projectTitle: (projectId: string) => Promise<string | undefined>;
  videoSourcePath: (projectId: string) => string;
  thumbnailSourcePath: (projectId: string) => string;
  warn: (details: unknown, message: string) => void;
};

const VIDEO_SAVE_ERROR = "Không lưu được video ra vị trí đã chọn. Hãy thử lại hoặc chọn thư mục khác.";
const THUMBNAIL_SAVE_ERROR = "Không lưu được ảnh bìa. Hãy thử lại hoặc chọn thư mục khác.";

export function safeExportStem(value: string | undefined, fallback: string): string {
  return (value ?? fallback).replace(/[\\/:*?"<>|]/g, "_").trim() || fallback;
}

function exportRoot(deps: Pick<NativeSaveDeps, "currentOutputDir" | "downloadsDir">): string {
  return deps.currentOutputDir() || deps.downloadsDir();
}

async function copyWithDialog(
  sourcePath: string,
  options: NativeSaveDialogOptions,
  failure: { message: string; log: string; projectId: string },
  deps: Pick<NativeSaveDeps, "copyFile" | "showSaveDialog" | "warn">,
): Promise<NativeSaveResult> {
  const picked = await deps.showSaveDialog(options);
  if (picked.canceled || !picked.filePath) return { saved: false };
  try {
    await deps.copyFile(sourcePath, picked.filePath);
    return { saved: true };
  } catch (error) {
    deps.warn({ err: error, projectId: failure.projectId }, failure.log);
    return { saved: false, error: failure.message };
  }
}

export async function saveProjectVideo(projectId: unknown, deps: NativeSaveDeps): Promise<NativeSaveResult> {
  // User-initiated export: copy the finished MP4 outside `.video-tool` only
  // after a native Save dialog confirms the destination.
  const id = String(projectId);
  const sourcePath = deps.videoSourcePath(id);
  if (!deps.exists(sourcePath)) return { saved: false };

  const safeName = safeExportStem(await deps.projectTitle(id), id);
  return copyWithDialog(
    sourcePath,
    {
      title: "Lưu video",
      defaultPath: join(exportRoot(deps), `${safeName}.mp4`),
      filters: [{ name: "Video MP4", extensions: ["mp4"] }],
    },
    {
      message: VIDEO_SAVE_ERROR,
      log: "save/export failed",
      projectId: id,
    },
    deps,
  );
}

export async function saveProjectThumbnail(projectId: unknown, deps: NativeSaveDeps): Promise<NativeSaveResult> {
  const id = String(projectId);
  const sourcePath = deps.thumbnailSourcePath(id);
  if (!deps.exists(sourcePath)) return { saved: false };

  const safeName = safeExportStem(await deps.projectTitle(id), id);
  return copyWithDialog(
    sourcePath,
    {
      title: "Lưu ảnh bìa",
      defaultPath: join(exportRoot(deps), `${safeName}-cover.png`),
      filters: [{ name: "Ảnh PNG", extensions: ["png"] }],
    },
    {
      message: THUMBNAIL_SAVE_ERROR,
      log: "thumbnail export failed",
      projectId: id,
    },
    deps,
  );
}
