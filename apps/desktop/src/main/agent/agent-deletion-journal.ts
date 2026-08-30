import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { writeJson } from "@motionreal/pipeline";
import type { HarnessDraftDeletionPlan } from "./harness-manager.js";

export type AgentDeletionPhase = "cancel" | "harness_data" | "project" | "draft";

export type AgentDeletionJournalEntry = HarnessDraftDeletionPlan & {
  phase: AgentDeletionPhase;
  lastError?: string;
};

export function deletionJournalPath(root: string, draftId: string): string {
  if (!/^agent-[0-9a-f-]{36}$/i.test(draftId)) throw new Error("Journal xóa Agent có draft không hợp lệ.");
  return join(root, `${draftId}.json`);
}

export async function writeAgentDeletionJournal(
  root: string,
  entry: AgentDeletionJournalEntry,
): Promise<void> {
  assertJournalEntry(entry);
  await mkdir(root, { recursive: true });
  await writeJson(deletionJournalPath(root, entry.draftId), entry);
}

export async function removeAgentDeletionJournal(root: string, draftId: string): Promise<void> {
  await rm(deletionJournalPath(root, draftId), { force: true });
}

export async function listAgentDeletionJournals(root: string): Promise<AgentDeletionJournalEntry[]> {
  const names = await readdir(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const entries: AgentDeletionJournalEntry[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const value = JSON.parse(await readFile(join(root, name), "utf8")) as unknown;
    assertJournalEntry(value);
    entries.push(value);
  }
  return entries;
}

function assertJournalEntry(value: unknown): asserts value is AgentDeletionJournalEntry {
  if (!value || typeof value !== "object") throw new Error("Journal xóa Agent bị hỏng.");
  const entry = value as Partial<AgentDeletionJournalEntry>;
  if (entry.version !== 1
    || !/^agent-[0-9a-f-]{36}$/i.test(entry.draftId ?? "")
    || typeof entry.draftRoot !== "string"
    || !Array.isArray(entry.sessionIds)
    || entry.sessionIds.some((id) => typeof id !== "string" || id.length === 0 || id.length > 240)
    || !["cancel", "harness_data", "project", "draft"].includes(entry.phase ?? "")) {
    throw new Error("Journal xóa Agent không hợp lệ.");
  }
  if (entry.projectId !== undefined && typeof entry.projectId !== "string") {
    throw new Error("Journal xóa Agent có project không hợp lệ.");
  }
  if (entry.workspaceId !== undefined && typeof entry.workspaceId !== "string") {
    throw new Error("Journal xóa Agent có workspace không hợp lệ.");
  }
  if (entry.lastError !== undefined && typeof entry.lastError !== "string") {
    throw new Error("Journal xóa Agent có lỗi không hợp lệ.");
  }
}
