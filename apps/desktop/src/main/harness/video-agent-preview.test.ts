import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  VIDEO_AGENT_MODEL,
  VIDEO_AGENT_TOOLS,
  VideoAgentPreview,
  agentJsonHeaders,
  catalogToolNames,
  isExactAgentCatalog,
  isLoopbackOnly,
  isSupportedVideoAgentRuntime,
  latestNewAssistantReply,
  normalizeAgentProposal,
  proposalToolSource,
  safeAgentSse,
  videoAgentConfig,
  videoAgentPromptBody,
  visibleAgentText,
} from "./video-agent-preview.js";

describe("Video Agent Preview safety gates", () => {
  it("accepts only the exact runtime tool catalog", () => {
    const catalog = VIDEO_AGENT_TOOLS.map((id) => ({ id, description: "allowed", parameters: {} }));
    expect(catalogToolNames(catalog)).toEqual([...VIDEO_AGENT_TOOLS].sort());
    expect(isExactAgentCatalog(catalog)).toBe(true);
    expect(isExactAgentCatalog([...catalog, { id: "bash", description: "no", parameters: {} }])).toBe(false);
  });

  it("accepts only loopback gateway listeners", () => {
    expect(isLoopbackOnly(["127.0.0.1", "::1"])).toBe(true);
    expect(isLoopbackOnly(["0.0.0.0"])).toBe(false);
    expect(isLoopbackOnly([])).toBe(false);
  });

  it("normalizes a bounded create proposal", () => {
    expect(normalizeAgentProposal({ kind: "create", title: "Mật khẩu", brief: "Giải thích ngắn", sourceUrls: ["https://example.com", "file:///no"] })).toEqual({ kind: "create", title: "Mật khẩu", brief: "Giải thích ngắn", sourceUrls: ["https://example.com"] });
  });

  it("rejects edit proposals for a different project or scene", () => {
    const context = { projectId: "p1", title: "P1", stage: "ready", scenes: [{ id: "scene-01", narration: "a" }] };
    expect(() => normalizeAgentProposal({ kind: "edit", title: "Sửa", projectId: "p2", edits: [{ sceneId: "scene-01", text: "x" }] }, context)).toThrow(/khớp/);
    expect(() => normalizeAgentProposal({ kind: "edit", title: "Sửa", projectId: "p1", edits: [{ sceneId: "outside", text: "x" }] }, context)).toThrow(/chưa có/);
  });

  it("pins the one model passed by the POC", () => {
    expect(VIDEO_AGENT_MODEL).toBe("ag/gemini-3.7-flash-high");
  });

  it("rejects version drift", () => {
    expect(isSupportedVideoAgentRuntime("1.15.11", "0.5.55")).toBe(true);
    expect(isSupportedVideoAgentRuntime("1.15.12", "0.5.55")).toBe(false);
    expect(isSupportedVideoAgentRuntime("1.15.11", "0.5.56")).toBe(false);
  });

  it("marks OpenCode JSON bodies with content-type", () => {
    expect(agentJsonHeaders(undefined, true).get("content-type")).toBe("application/json");
    expect(agentJsonHeaders(undefined, false).has("content-type")).toBe(false);
    expect(agentJsonHeaders({ "content-type": "application/problem+json" }, true).get("content-type")).toBe("application/problem+json");
  });

  it("keeps agent instructions in OpenCode config, not in the user transcript", () => {
    const config = videoAgentConfig() as {
      agent: Record<string, { prompt?: string; steps?: number }>;
      provider: { ninerouter: { models: Record<string, { modalities: { input: string[] } }> } };
    };
    expect(config.agent["motionreal-video"]?.prompt).toContain("MotionReal Video Agent");
    expect(config.agent["motionreal-video"]?.steps).toBe(6);
    expect(config.provider.ninerouter.models[VIDEO_AGENT_MODEL]?.modalities.input).toEqual(["text"]);
    expect(videoAgentPromptBody("Hãy tạo video về ChatGPT")).toMatchObject({ parts: [{ type: "text", text: "Hãy tạo video về ChatGPT" }] });
    expect(JSON.stringify(videoAgentPromptBody("Hãy tạo video về ChatGPT"))).not.toContain("You are MotionReal Video Agent");
    expect(visibleAgentText("user", "You are MotionReal Video Agent. New-video idea session.\n\nUser: Hãy tạo video về ChatGPT")).toBe("Hãy tạo video về ChatGPT");
    expect(visibleAgentText("user", "You are MotionReal Video Agent. New-video idea session. User: Xin chào")).toBe("Xin chào");
    expect(visibleAgentText("assistant", "CRITICAL - MAXIMUM STEPS REACHED\ninternal")).toBe("");
  });

  it("gives the model an explicit proposal schema instead of a JSON-string guessing loop", () => {
    const source = proposalToolSource();
    expect(source).toContain('tool.schema.enum(["create","edit"])');
    expect(source).toContain("create proposal requires brief");
    expect(source).not.toContain("proposalJson");
  });

  it("does not silently reuse an old answer after an asynchronous provider failure", () => {
    const old = { id: "old", role: "assistant" as const, text: "Câu trả lời cũ", createdAt: "2026-01-01T00:00:00.000Z" };
    expect(latestNewAssistantReply([old], [old, { id: "user", role: "user", text: "Tin mới", createdAt: "2026-01-01T00:01:00.000Z" }])).toBeUndefined();
    expect(latestNewAssistantReply([old], [old, { id: "new", role: "assistant", text: "Câu trả lời mới", createdAt: "2026-01-01T00:01:01.000Z" }])?.id).toBe("new");
  });

  it("forwards only safe SSE effects for the matching OpenCode session", () => {
    const web = safeAgentSse({ type: "tool", properties: { sessionID: "oc-1", tool: "websearch" } }, "oc-1");
    expect(web).toMatchObject({ kind: "tool", code: "websearch", tool: "websearch" });
    expect(web?.text).not.toContain("oc-1");
    expect(safeAgentSse({ type: "tool", properties: { sessionID: "oc-other", tool: "websearch" } }, "oc-1")).toBeUndefined();
    expect(safeAgentSse({ type: "error", properties: { sessionID: "oc-1", detail: "Bearer secret-value" } }, "oc-1")).toEqual({ kind: "error", text: "Lỗi Agent chưa áp dụng thay đổi. [provider_failed]", code: "provider_failed" });
  });
});

describe("Video Agent Preview session revisions", () => {
  let root = "";
  let previousHome: string | undefined;

  beforeEach(async () => {
    previousHome = process.env.VIDEO_TOOL_HOME;
    root = await mkdtemp(join(tmpdir(), "motionreal-agent-session-"));
    process.env.VIDEO_TOOL_HOME = root;
  });
  afterEach(async () => {
    if (previousHome === undefined) delete process.env.VIDEO_TOOL_HOME;
    else process.env.VIDEO_TOOL_HOME = previousHome;
    await rm(root, { recursive: true, force: true });
  });

  it("creates a fresh session for every new idea and reuses only a compatible project session", async () => {
    const preview = new VideoAgentPreview(() => {});
    const first = await preview.open({ kind: "new-idea" });
    const second = await preview.open({ kind: "new-idea" });
    const projectFirst = await preview.open({ kind: "project", projectId: "project-1" });
    const projectSecond = await preview.open({ kind: "project", projectId: "project-1" });
    expect(first.id).not.toBe(second.id);
    expect(projectFirst.id).toBe(projectSecond.id);
    expect(first.compatibility).toBe("current");
  });

  it("marks earlier records legacy and never lets them send a prompt", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const home = join(root, ".video-tool", "agent-sessions");
    await mkdir(home, { recursive: true });
    await writeFile(join(home, "sessions.json"), JSON.stringify([{ id, scope: "idea", title: "Phiên cũ", updatedAt: "2026-01-01T00:00:00.000Z" }]), "utf8");
    const preview = new VideoAgentPreview(() => {});
    const legacy = await preview.open({ kind: "resume", sessionId: id });
    expect(legacy.compatibility).toBe("legacy");
    await expect(preview.prompt(id, "không gửi")).rejects.toThrow(/Phiên cũ/);
    await preview.forget(id);
    await expect(preview.list()).resolves.toEqual([]);
  });
});
