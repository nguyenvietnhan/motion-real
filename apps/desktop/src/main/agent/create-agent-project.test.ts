import { describe, expect, it, vi } from "vitest";
import { createAgentProject } from "./create-agent-project.js";

function request() {
  return {
    draftId: "agent-1",
    title: "Gemini",
    prompt: "Tạo video Gemini",
    assets: [{ id: "gemini", path: "V:/agent/assets/gemini.png", role: "logo" as const }],
    choices: { durationTier: 1 as const, videoLanguage: "vi" as const, voiceProvider: "vieneu" as const },
  };
}

function deps(over: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const base = {
    status: vi.fn(async () => ({})),
    readCreateRequest: vi.fn(async () => request()),
    stageImages: vi.fn(async () => {
      calls.push("stage");
      return [{ id: "gemini", image: { ref: "staging/hash.png", width: 1, height: 1 } }];
    }),
    create: vi.fn(async (_prompt, _images, choices) => {
      calls.push(`scaffold:${choices.creationMode}`);
      await choices.beforeBeginCreate?.("project-1");
      return { projectId: "project-1" };
    }),
    linkProject: vi.fn(async () => { calls.push("link"); }),
    persistProjectOwnership: vi.fn(async () => { calls.push("owner"); }),
    deleteProject: vi.fn(async () => { calls.push("delete"); return true; }),
    renameProject: vi.fn(async () => { calls.push("rename"); }),
    startAuthoring: vi.fn(async (_draftId, _projectId, assets) => {
      expect(assets).toEqual([{ id: "gemini", ref: "assets/hash.png", role: "logo" }]);
      calls.push("author");
    }),
    warn: vi.fn(),
    ...over,
  };
  return { base, calls };
}

describe("createAgentProject", () => {
  it("scaffolds one Harness-owned project without entering classic authoring", async () => {
    const { base, calls } = deps();
    await expect(createAgentProject("agent-1", base)).resolves.toEqual({ projectId: "project-1" });
    expect(calls).toEqual(["stage", "scaffold:harness", "owner", "link", "rename", "author"]);
  });

  it("resumes Harness authoring for a linked project without creating another one", async () => {
    const { base } = deps({ status: vi.fn(async () => ({ projectId: "project-existing" })) });
    await expect(createAgentProject("agent-1", base)).resolves.toEqual({ projectId: "project-existing" });
    expect(base.readCreateRequest).toHaveBeenCalledOnce();
    expect(base.startAuthoring).toHaveBeenCalledWith("agent-1", "project-existing", [{ id: "gemini", ref: "assets/hash.png", role: "logo" }]);
    expect(base.create).not.toHaveBeenCalled();
    expect(base.persistProjectOwnership).toHaveBeenCalledWith("project-existing", "agent-1");
  });

  it("fails before scaffold when any user-approved Agent asset cannot be staged", async () => {
    const { base } = deps({ stageImages: vi.fn(async () => []) });
    await expect(createAgentProject("agent-1", base)).rejects.toThrow(/đủ asset đã duyệt/);
    expect(base.create).not.toHaveBeenCalled();
    expect(base.startAuthoring).not.toHaveBeenCalled();
  });

  it("deletes an unlinked scaffold when ownership persistence fails", async () => {
    const { base, calls } = deps({ linkProject: vi.fn(async () => { throw new Error("disk full"); }) });
    await expect(createAgentProject("agent-1", base)).rejects.toThrow("disk full");
    expect(calls).toContain("delete");
    expect(calls).not.toContain("begin");
  });

  it("preserves the scaffold when ownership cannot be rechecked safely", async () => {
    const status = vi.fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("status unavailable"));
    const { base } = deps({
      status,
      linkProject: vi.fn(async () => { throw new Error("link failed"); }),
    });
    await expect(createAgentProject("agent-1", base)).rejects.toThrow("link failed");
    expect(base.deleteProject).not.toHaveBeenCalled();
    expect(base.warn).toHaveBeenCalledWith(expect.any(Error), "project-1", expect.stringMatching(/preserving scaffold/));
  });

  it("keeps a linked project when beginCreate fails so retry cannot duplicate it", async () => {
    let linked = false;
    const { base, calls } = deps({
      status: vi.fn(async () => linked ? { projectId: "project-1" } : {}),
      linkProject: vi.fn(async () => { linked = true; calls.push("link"); }),
      create: vi.fn(async (_prompt, _images, choices) => {
        await choices.beforeBeginCreate?.("project-1");
        throw new Error("begin failed");
      }),
    });
    await expect(createAgentProject("agent-1", base)).rejects.toThrow("begin failed");
    expect(base.deleteProject).not.toHaveBeenCalled();
    await expect(createAgentProject("agent-1", base)).resolves.toEqual({ projectId: "project-1" });
    expect(base.create).toHaveBeenCalledOnce();
  });
});
