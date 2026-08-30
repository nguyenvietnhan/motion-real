import { createLogger } from "@motionreal/pipeline";

const log = createLogger("harness-edits");

type Deps = {
  ownerOf: (projectId: string) => Promise<"classic" | "harness">;
  draftForProject: (projectId: string) => Promise<{ id: string } | null>;
  activate: (draftId: string) => Promise<{ id: string }>;
  beginHarness: (projectId: string) => void;
  requestHarness: (draftId: string, projectId: string, edits: unknown, globalNotes: unknown) => Promise<void>;
  restoreHarnessReview: (projectId: string) => Promise<void>;
  submitClassic: (projectId: string, edits: unknown, globalNotes: unknown) => void;
};

/** Keep Classic untouched; a Harness-owned project must never enter old API re-authoring. */
export async function routeSceneEdits(
  projectId: string,
  edits: unknown,
  globalNotes: unknown,
  deps: Deps,
): Promise<void> {
  if (await deps.ownerOf(projectId) === "classic") {
    deps.submitClassic(projectId, edits, globalNotes);
    return;
  }
  const draft = await deps.draftForProject(projectId);
  if (!draft) {
    throw new Error("Project Agent không tìm thấy phiên Agent để sửa cảnh. Hãy khôi phục hoặc tạo lại từ Agent.");
  }
  const opened = await deps.activate(draft.id);
  deps.beginHarness(projectId);
  try {
    await deps.requestHarness(opened.id, projectId, edits, globalNotes);
  } catch (error) {
    await deps.restoreHarnessReview(projectId).catch((restoreError) => {
      log.warn({ err: restoreError, projectId }, "failed to restore Harness scene review after edit rejection");
    });
    throw error;
  }
}
