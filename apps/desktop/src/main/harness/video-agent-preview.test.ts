import { describe, expect, it } from "vitest";
import {
  VIDEO_AGENT_MODEL,
  VIDEO_AGENT_TOOLS,
  agentJsonHeaders,
  catalogToolNames,
  isExactAgentCatalog,
  isLoopbackOnly,
  isSupportedVideoAgentRuntime,
  normalizeAgentProposal,
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
});
