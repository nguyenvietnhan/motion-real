import { describe, expect, it, vi } from "vitest";
import { deleteAgentDraft, renameAgentDraft } from "./agent-draft-lifecycle.js";

const linked = { id: "agent-1", title: "Cũ", projectId: "project-1" };

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

  it("does not remove the Agent draft when linked project deletion fails", async () => {
    const removeDraft = vi.fn();
    await expect(deleteAgentDraft("agent-1", {
      status: async () => linked,
      deleteProject: async () => { throw new Error("project locked"); },
      removeDraft,
    })).rejects.toThrow("project locked");
    expect(removeDraft).not.toHaveBeenCalled();
  });

  it("does not remove the Agent draft when project deletion reports failure", async () => {
    const removeDraft = vi.fn();
    await expect(deleteAgentDraft("agent-1", {
      status: async () => linked,
      deleteProject: async () => false,
      removeDraft,
    })).rejects.toThrow(/MotionReal/);
    expect(removeDraft).not.toHaveBeenCalled();
  });
});
