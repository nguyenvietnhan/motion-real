import { basename } from "node:path";
import type { SceneImageRole } from "@motionreal/schema";
import type { StagedImageRef } from "../../shared/types.js";
import type { CreateController } from "../create/create-controller.js";
import type { HarnessManager } from "./harness-manager.js";

type Deps = {
  status: (draftId: string) => Promise<{ projectId?: string }>;
  readCreateRequest: HarnessManager["readCreateRequest"];
  stageImages: (assets: Array<{ id: string; path: string; role: SceneImageRole }>) => Promise<Array<{ id: string; image: StagedImageRef }>>;
  create: CreateController["create"];
  linkProject: HarnessManager["linkProject"];
  deleteProject: (projectId: string) => Promise<void>;
  renameProject: (projectId: string, title: string) => Promise<unknown>;
  startAuthoring: (draftId: string, projectId: string, assets: Array<{ id: string; ref: string; role: SceneImageRole }>) => Promise<void>;
  warn: (error: unknown, projectId: string, message: string) => void;
};

/** Reuse the normal project scaffold/promotion path, then hand scene code to Harness. */
export async function createAgentProject(draftId: string, deps: Deps): Promise<{ projectId: string }> {
  const current = await deps.status(draftId);
  const request = await deps.readCreateRequest(draftId);
  const staged = await deps.stageImages(request.assets);
  const images = staged.map((asset) => asset.image);
  const roles = new Map(request.assets.map((asset) => [asset.id, asset.role]));
  const authorAssets = staged.map(({ id, image }) => ({
    id,
    ref: `assets/${basename(image.ref)}`,
    role: roles.get(id) ?? "support",
  }));
  if (current.projectId) {
    await deps.startAuthoring(request.draftId, current.projectId, authorAssets);
    return { projectId: current.projectId };
  }
  let scaffoldedProjectId: string | undefined;
  let created: { projectId: string };
  try {
    created = await deps.create(request.prompt, images, {
      ...request.choices,
      creationMode: "harness",
      beforeBeginCreate: async (projectId) => {
        scaffoldedProjectId = projectId;
        await deps.linkProject(request.draftId, projectId);
      },
    });
  } catch (error) {
    if (scaffoldedProjectId) {
      let linked: { projectId?: string } | undefined;
      try {
        linked = await deps.status(draftId);
      } catch (statusError) {
        deps.warn(statusError, scaffoldedProjectId, "Agent project ownership recheck failed; preserving scaffold");
      }
      if (!linked?.projectId) {
        if (linked) {
          await deps.deleteProject(scaffoldedProjectId).catch((cleanupError) => {
            deps.warn(cleanupError, scaffoldedProjectId!, "unlinked Agent scaffold cleanup failed");
          });
        }
      }
    }
    throw error;
  }

  await deps.renameProject(created.projectId, request.title).catch((error) => {
    deps.warn(error, created.projectId, "Agent project title update failed");
  });
  await deps.startAuthoring(
    request.draftId,
    created.projectId,
    authorAssets,
  );
  return created;
}
