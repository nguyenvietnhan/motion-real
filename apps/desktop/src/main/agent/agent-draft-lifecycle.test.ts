import { describe, expect, it, vi } from "vitest";
import { deleteAgentDraft, renameAgentDraft, resumeAgentDraftDeletion, type AgentDeletionDeps } from "./agent-draft-lifecycle.js";

const linked = { id: "agent-1", title: "Cũ", projectId: "project-1" };
const deletionPlan = {
  version: 1 as const,
  draftId: "agent-11111111-1111-1111-1111-111111111111",
  projectId: "project-1",
  workspaceId: "workspace-1",
  sessionIds: ["session-1"],
  draftRoot: "C:\\agent-drafts\\agent-11111111-1111-1111-1111-111111111111",
};

function deletionDeps(calls: string[], overrides: Partial<AgentDeletionDeps> = {}): AgentDeletionDeps {
  return {
    prepareDraftDeletion: async () => deletionPlan,
    cancelHarnessSessions: async () => { calls.push("cancel"); },
    deleteHarnessData: async () => { calls.push("harness_data"); },
    deleteProject: async () => { calls.push("project"); return true; },
    removeDraftRoot: async () => { calls.push("draft"); },
    writeJournal: async (entry) => { calls.push(`journal:${entry.phase}${entry.lastError ? ":error" : ""}`); },
    removeJournal: async () => { calls.push("journal:remove"); },
    ...overrides,
  };
}

describe("Agent draft lifecycle", () => {
  it("renames the project and Agent metadata as one transaction", async () => {
    const calls: string[] = [];
    const result = await renameAgentDraft("agent-1", " Mới ", {
      status: async () => linked,
      renameProject: async (_id, title) => { calls.push(`project:${title}`); return title; },
      renameDraft: async (_id, title) => { calls.push(`draft:${title}`); return { ...linked, title }; },
    });
    expect(result.title).toBe("Mới");
    expect(calls).toEqual(["project:Mới", "draft:Mới"]);
  });

  it("rolls the project title back when Agent metadata rename fails", async () => {
    const renameProject = vi.fn(async (_id: string, title: string) => title);
    await expect(renameAgentDraft("agent-1", "Mới", {
      status: async () => linked,
      renameProject,
      renameDraft: async () => { throw new Error("disk full"); },
    })).rejects.toThrow("disk full");
    expect(renameProject.mock.calls).toEqual([["project-1", "Mới"], ["project-1", "Cũ"]]);
  });

  it("journals each phase before deleting project and draft", async () => {
    const calls: string[] = [];
    await deleteAgentDraft(deletionPlan.draftId, deletionDeps(calls));
    expect(calls).toEqual([
      "journal:cancel",
      "cancel",
      "journal:harness_data",
      "harness_data",
      "journal:project",
      "project",
      "journal:draft",
      "draft",
      "journal:remove",
    ]);
  });

  it("retains the journal and draft when project deletion fails", async () => {
    const calls: string[] = [];
    await expect(deleteAgentDraft(deletionPlan.draftId, deletionDeps(calls, {
      deleteProject: async () => { calls.push("project"); return false; },
    }))).rejects.toThrow(/MotionReal/);
    expect(calls).toContain("journal:project:error");
    expect(calls).not.toContain("draft");
    expect(calls).not.toContain("journal:remove");
  });

  it("resumes only the remaining deletion phases after a crash", async () => {
    const calls: string[] = [];
    await resumeAgentDraftDeletion({ ...deletionPlan, phase: "project" }, deletionDeps(calls));
    expect(calls).toEqual(["project", "journal:draft", "draft", "journal:remove"]);
  });
});
