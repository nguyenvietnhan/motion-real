import { basename, join } from "node:path";
import type { DroppedImage, PickImagesResult } from "../../shared/types.js";

type StagedImportResult =
  | { ok: true; ref: string; sha: string; ext: string; width: number; height: number; bytes: number }
  | { ok: false; reason: string };

export type ImageStagingDeps = {
  stagingDir: () => string;
  importImageBytes: (
    bytes: Uint8Array,
    destDir: string,
    opts: { refPrefix: "staging" },
  ) => Promise<StagedImportResult>;
  mediaUrl: (path: string) => string | null;
  readFile: (path: string) => Promise<Uint8Array>;
  readdir: (path: string) => Promise<string[]>;
  stat: (path: string) => Promise<{ mtimeMs: number }>;
  rm: (path: string, options: { force: true }) => Promise<void>;
  now: () => number;
  warn: (details: unknown, message: string) => void;
};

const STALE_STAGING_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Import selected image paths into the create-time staging dir. The native
 * picker stays in the Electron root; this helper owns only staging result
 * shaping and per-file failure handling.
 */
export async function importPickedImageFiles(filePaths: string[], deps: ImageStagingDeps): Promise<PickImagesResult> {
  const result: PickImagesResult = { staged: [], rejected: [] };
  for (const path of filePaths) {
    const name = path.split(/[\\/]/).pop() ?? path;
    try {
      await stageImportedImage(name, await deps.readFile(path), result, deps);
    } catch (error) {
      deps.warn({ err: error, fileName: name }, "picked image import failed; reporting decode failure");
      result.rejected.push({ name, reason: "decode-failed" });
    }
  }
  return result;
}

/**
 * Import raw image bytes the renderer captured from paste or drag-drop. These
 * have no filesystem path, so the bytes cross IPC as base64 and then stage just
 * like native picker files.
 */
export async function importDroppedImages(files: DroppedImage[], deps: ImageStagingDeps): Promise<PickImagesResult> {
  const result: PickImagesResult = { staged: [], rejected: [] };
  for (const file of files) {
    try {
      await stageImportedImage(file.name, Buffer.from(file.dataBase64, "base64"), result, deps);
    } catch (error) {
      deps.warn({ err: error, fileName: file.name }, "dropped image import failed; reporting decode failure");
      result.rejected.push({ name: file.name, reason: "decode-failed" });
    }
  }
  return result;
}

export async function stageImportedImage(
  name: string,
  bytes: Uint8Array,
  result: PickImagesResult,
  deps: ImageStagingDeps,
): Promise<void> {
  const dir = deps.stagingDir();
  const res = await deps.importImageBytes(bytes, dir, { refPrefix: "staging" });
  if (res.ok) {
    result.staged.push({
      ref: res.ref,
      previewUrl: deps.mediaUrl(join(dir, `${res.sha}.${res.ext}`)) ?? "",
      width: res.width,
      height: res.height,
      bytes: res.bytes,
      name,
    });
  } else {
    result.rejected.push({ name, reason: res.reason });
  }
}

/**
 * Delete one staged image the user removed at the create screen. Path-safe: the
 * ref must be `staging/<filename>`, then we collapse to basename and rebuild
 * under the staging dir.
 */
export async function unstageImage(ref: string, deps: Pick<ImageStagingDeps, "stagingDir" | "rm">): Promise<void> {
  if (!ref.startsWith("staging/")) return;
  const name = basename(ref);
  if (!name || name === "." || name === "..") return;
  await deps.rm(join(deps.stagingDir(), name), { force: true });
}

/**
 * Best-effort sweep of staged create-time images. Missing/locked entries never
 * block startup.
 */
export async function sweepStagingDir(
  deps: Pick<ImageStagingDeps, "stagingDir" | "readdir" | "stat" | "rm" | "now" | "warn">,
  maxAgeMs = STALE_STAGING_AGE_MS,
): Promise<void> {
  const dir = deps.stagingDir();
  let entries: string[];
  try {
    entries = await deps.readdir(dir);
  } catch (error) {
    deps.warn({ err: error }, "staging directory unavailable; sweep skipped");
    return;
  }

  const now = deps.now();
  for (const name of entries) {
    const abs = join(dir, name);
    try {
      const st = await deps.stat(abs);
      if (now - st.mtimeMs > maxAgeMs) await deps.rm(abs, { force: true });
    } catch (error) {
      deps.warn({ err: error, entry: name }, "staging entry cleanup failed; continuing sweep");
    }
  }
}
