import type { StagedImageRef } from "../../shared/types.js";
import type { CreateController } from "../create/create-controller.js";
import type { HarnessManager } from "./harness-manager.js";

type Deps = {
  status: (draftId: string) => Promise<{ projectId?: string }>;
  readCreateRequest: HarnessManager["readCreateRequest"];
  stageImages: (paths: string[]) => Promise<StagedImageRef[]>;
  create: CreateController["create"];
  linkProject: HarnessManager["linkProject"];
  deleteProject: (projectId: string) => Promise<void>;
  renameProject: (projectId: string, title: string) => Promise<unknown>;
  warn: (error: unknown, projectId: string, message: string) => void;
};

/** Reuse the normal Create Flow while making Agent project ownership durable. */
export async function createAgentProject(draftId: string, deps: Deps): Promise<{ projectId: string }> {
  const current = await deps.status(draftId);
  if (current.projectId) return { projectId: current.projectId };

  const request = await deps.readCreateRequest(draftId);
  const images = await deps.stageImages(request.imagePaths);
  let scaffoldedProjectId: string | undefined;
  let created: { projectId: string };
  try {
    created = await deps.create(request.prompt, images, {
      ...request.choices,
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
  return created;
}
