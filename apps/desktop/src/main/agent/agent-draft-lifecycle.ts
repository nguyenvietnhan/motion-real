import type { AgentDeletionJournalEntry } from "./agent-deletion-journal.js";
import type { HarnessDraftDeletionPlan } from "./harness-manager.js";

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

export type AgentDeletionDeps = {
  prepareDraftDeletion(id: string): Promise<HarnessDraftDeletionPlan>;
  cancelHarnessSessions(plan: HarnessDraftDeletionPlan): Promise<void>;
  deleteHarnessData(plan: HarnessDraftDeletionPlan): Promise<void>;
  deleteProject(projectId: string): Promise<boolean>;
  removeDraftRoot(plan: HarnessDraftDeletionPlan): Promise<void>;
  writeJournal(entry: AgentDeletionJournalEntry): Promise<void>;
  removeJournal(draftId: string): Promise<void>;
};

/** Start a durable deletion transaction; every irreversible phase is journaled first. */
export async function deleteAgentDraft(
  draftId: string,
  deps: AgentDeletionDeps,
): Promise<void> {
  const plan = await deps.prepareDraftDeletion(draftId);
  const entry: AgentDeletionJournalEntry = { ...plan, phase: "cancel" };
  await deps.writeJournal(entry);
  await resumeAgentDraftDeletion(entry, deps);
}

/** Resume a partially completed deletion after a crash without guessing identities. */
export async function resumeAgentDraftDeletion(
  entry: AgentDeletionJournalEntry,
  deps: AgentDeletionDeps,
): Promise<void> {
  let current = entry;
  const advance = async (phase: AgentDeletionJournalEntry["phase"]) => {
    current = { ...current, phase, lastError: undefined };
    await deps.writeJournal(current);
  };
  try {
    if (current.phase === "cancel") {
      await deps.cancelHarnessSessions(current);
      await advance("harness_data");
    }
    if (current.phase === "harness_data") {
      await deps.deleteHarnessData(current);
      await advance("project");
    }
    if (current.phase === "project") {
      if (current.projectId && !await deps.deleteProject(current.projectId)) {
        throw new Error("Không xóa được project MotionReal; giữ Agent workspace để có thể thử lại.");
      }
      await advance("draft");
    }
    if (current.phase === "draft") {
      await deps.removeDraftRoot(current);
      await deps.removeJournal(current.draftId);
    }
  } catch (error) {
    await deps.writeJournal({
      ...current,
      lastError: error instanceof Error ? error.message.slice(0, 1_000) : String(error).slice(0, 1_000),
    }).catch((_journalError) => undefined);
    throw error;
  }
}
