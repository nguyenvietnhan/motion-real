import { describe, expect, it, vi } from "vitest";
import { createAgentProject } from "./create-agent-project.js";

function request() {
  return {
    draftId: "agent-1",
    title: "Gemini",
    prompt: "Tạo video Gemini",
    imagePaths: ["V:/agent/assets/gemini.png"],
    choices: { durationTier: 1 as const, videoLanguage: "vi" as const, voiceProvider: "vieneu" as const },
  };
}

function deps(over: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const base = {
    status: vi.fn(async () => ({})),
    readCreateRequest: vi.fn(async () => request()),
    stageImages: vi.fn(async () => { calls.push("stage"); return []; }),
    create: vi.fn(async (_prompt, _images, choices) => {
      calls.push(`scaffold:${choices.creationMode}`);
      await choices.beforeBeginCreate?.("project-1");
      return { projectId: "project-1" };
    }),
    linkProject: vi.fn(async () => { calls.push("link"); }),
    deleteProject: vi.fn(async () => { calls.push("delete"); }),
    renameProject: vi.fn(async () => { calls.push("rename"); }),
    warn: vi.fn(),
    ...over,
  };
  return { base, calls };
}

describe("createAgentProject", () => {
  it("scaffolds one Harness-owned project without entering classic authoring", async () => {
    const { base, calls } = deps();
    await expect(createAgentProject("agent-1", base)).resolves.toEqual({ projectId: "project-1" });
    expect(calls).toEqual(["stage", "scaffold:harness", "link", "rename"]);
  });

  it("reuses a linked project without staging or creating another one", async () => {
    const { base } = deps({ status: vi.fn(async () => ({ projectId: "project-existing" })) });
    await expect(createAgentProject("agent-1", base)).resolves.toEqual({ projectId: "project-existing" });
    expect(base.readCreateRequest).not.toHaveBeenCalled();
    expect(base.create).not.toHaveBeenCalled();
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
