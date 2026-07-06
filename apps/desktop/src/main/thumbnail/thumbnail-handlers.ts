import type { InvokeHandlers } from "../ipc-router.js";

export type ThumbnailHandlers = Required<Pick<InvokeHandlers, "thumbnail:generate" | "thumbnail:save">>;

export type ThumbnailHandlerDeps = {
  generateThumbnail: (projectId: string) => unknown | Promise<unknown>;
  saveThumbnail: (projectId: unknown) => unknown | Promise<unknown>;
};

export function createThumbnailHandlers(deps: ThumbnailHandlerDeps): ThumbnailHandlers {
  return {
    "thumbnail:generate": (projectId) => deps.generateThumbnail(String(projectId)),
    "thumbnail:save": (projectId) => deps.saveThumbnail(projectId),
  };
}
