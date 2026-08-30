type DraftIdentity = { id: string; title: string; projectId?: string };

export async function renameAgentDraft<T extends DraftIdentity>(
  draftId: string,
  title: string,
  deps: {
    status(id: string): Promise<T>;
    renameProject(projectId: string, title: string): Promise<string | null>;
    renameDraft(id: string, title: string): Promise<T>;
  },
): Promise<T> {
  const current = await deps.status(draftId);
  const nextTitle = title.trim().slice(0, 120);
  if (!nextTitle) throw new Error("Hãy đặt tên video trước khi đổi tên.");
  if (!current.projectId) return deps.renameDraft(draftId, nextTitle);
  const renamedProject = await deps.renameProject(current.projectId, nextTitle);
  if (!renamedProject) throw new Error("Không đổi được tên project MotionReal.");
  try {
    return await deps.renameDraft(draftId, renamedProject);
  } catch (error) {
    await deps.renameProject(current.projectId, current.title);
    throw error;
  }
}

export async function deleteAgentDraft<T extends DraftIdentity>(
  draftId: string,
  deps: {
    status(id: string): Promise<T>;
    deleteProject(projectId: string): Promise<boolean>;
    removeDraft(id: string): Promise<void>;
  },
): Promise<void> {
  const draft = await deps.status(draftId);
  if (draft.projectId && !await deps.deleteProject(draft.projectId)) {
    throw new Error("Không xóa được project MotionReal; giữ nguyên Agent workspace.");
  }
  await deps.removeDraft(draft.id);
}
