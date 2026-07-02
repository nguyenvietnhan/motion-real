import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const BUNDLED_DEFAULT_BGM_FILENAME = "default.mp3";
export const BUNDLED_DEFAULT_BGM_TRACK_NAME = "nhac-nen-mac-dinh.mp3";
export const BUNDLED_DEFAULT_BGM_RELATIVE_PARTS = ["apps", "desktop", "assets", "bgm", BUNDLED_DEFAULT_BGM_FILENAME] as const;

export function bundledMediaWorkspaceRoot(): string {
  // Source: packages/pipeline/src/assets -> up 4. Bundled Electron main:
  // apps/desktop/dist-electron/main -> up 4. Both resolve to the repo root.
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
}

export function bundledDefaultBgmPath(root = bundledMediaWorkspaceRoot()): string {
  return join(root, ...BUNDLED_DEFAULT_BGM_RELATIVE_PARTS);
}
