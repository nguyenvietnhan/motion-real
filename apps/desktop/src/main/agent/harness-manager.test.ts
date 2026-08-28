import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HarnessManager, type HarnessManagerDeps } from "./harness-manager.js";

const roots: string[] = [];
const activeManagers: HarnessManager[] = [];
const heldCommits: Array<() => void> = [];

function registeredSceneSource(id: string, version: string): string {
  return `import { registerComponent } from "@motionreal/compositions";
import { z } from "zod";
export const schema = z.object({});
export const example = {};
export default registerComponent({ id: "${id}", displayName: "${id}", schema, example,
  Component: () => <div>${version}</div> });\n`;
}

async function managerForTest(): Promise<{ manager: HarnessManager; root: string }> {
  const root = await mkdtemp(join(tmpdir(), "motionreal-agent-"));
  roots.push(root);
  return {
    root,
    manager: new HarnessManager({
      draftsRoot: root,
      harnessHome: join(root, "harness"),
      harnessCliPath: join(root, "missing-harness.js"),
      submissionPluginPath: join(root, "motionreal-tools.mjs"),
      mediaUrl: (path) => `media://${path}`,
    }),
  };
}

afterEach(async () => {
  for (const release of heldCommits.splice(0)) release();
  await Promise.all(activeManagers.splice(0).map((manager) => manager.dispose()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })));
});

async function activeManagerForTest(over: Partial<HarnessManagerDeps> = {}): Promise<{
  manager: HarnessManager;
  root: string;
  calls: Array<{ method: string; payload: unknown }>;
  deps: HarnessManagerDeps;
  history: Array<{ event: { seq: number; type: string; data: Record<string, unknown> } }>;
}> {
  const root = await mkdtemp(join(tmpdir(), "motionreal-agent-active-"));
  roots.push(root);
  const cli = join(root, "dsh.js");
  await writeFile(cli, "// test placeholder\n");
  await writeFile(join(root, "motionreal-tools.mjs"), "// test tool plugin\n");
  const child = Object.assign(new EventEmitter(), { kill: vi.fn() });
  const calls: Array<{ method: string; payload: unknown }> = [];
  const history: Array<{ event: { seq: number; type: string; data: Record<string, unknown> } }> = [];
  let searchConfigured = false;
  const deps: HarnessManagerDeps = {
    draftsRoot: root,
    harnessHome: join(root, "harness"),
    harnessCliPath: cli,
    submissionPluginPath: join(root, "motionreal-tools.mjs"),
    findPort: async () => 39872,
    spawn: vi.fn(() => child) as unknown as typeof import("node:child_process").spawn,
    fetch: vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method: string; payload: unknown };
      calls.push(body);
      if (body.method === "credentials.set") searchConfigured = true;
      const value = body.method === "workspace.create"
        ? { workspace: { workspaceId: "workspace-assets" } }
        : body.method === "credentials.describe"
          ? { credentials: { DEEPSEEK_API_KEY: { configured: searchConfigured, writable: true } } }
        : body.method === "session.history"
          ? { events: history, hasMore: false }
          : {};
      return Response.json({ type: "server-response", result: { ok: true, value } });
    }) as unknown as typeof globalThis.fetch,
    mediaUrl: (path) => `media://${path}`,
    ...over,
  };
  const manager = new HarnessManager(deps);
  activeManagers.push(manager);
  return { manager, root, calls, deps, history };
}

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

describe("HarnessManager draft lifecycle", () => {
  it("blocks Harness startup when the MotionReal submission plugin was not built", async () => {
    const root = await mkdtemp(join(tmpdir(), "motionreal-agent-missing-tools-"));
    roots.push(root);
    const cli = join(root, "dsh.js");
    await writeFile(cli, "// test placeholder\n");
    const manager = new HarnessManager({
      draftsRoot: root,
      harnessHome: join(root, "harness"),
      harnessCliPath: cli,
      submissionPluginPath: join(root, "missing-motionreal-tools.mjs"),
    });
    const draft = await manager.createDraft("Missing tools");

    await expect(manager.activate(draft.id, "internal-key")).rejects.toThrow(/Chưa build tool submission/);
  });

  it("creates a video workspace with Harness instructions", async () => {
    const { manager, root } = await managerForTest();
    const draft = await manager.createDraft("Video về ChatGPT");
    const draftRoot = join(root, draft.id);

    expect(draft.title).toBe("Video về ChatGPT");
    await expect(readFile(join(draftRoot, "AI_CONTRACT.md"), "utf8")).resolves.toMatch(/isolated workspace/);
    await expect(writeFile(join(draftRoot, "assets", "logo.png"), "image")).resolves.toBeUndefined();
    await expect(writeFile(join(draftRoot, "motionreal.create.json"), '{"version":1,"prompt":"Tạo video","images":["assets/logo.png"]}')).resolves.toBeUndefined();

    await expect(manager.readCreateRequest(draft.id)).rejects.toThrow(/duyệt brief/);
    expect((await manager.status(draft.id)).createReady).toBe(false);
  });

  it("reveals only existing regular files contained by the Agent workspace", async () => {
    const { manager, root } = await managerForTest();
    const draft = await manager.createDraft("Tệp chat an toàn");
    const visible = join(root, draft.id, "assets", "logo.png");
    await writeFile(visible, ONE_PIXEL_PNG);

    await expect(manager.revealFilePath(draft.id, "assets/logo.png")).resolves.toBe(await realpath(visible));
    await expect(manager.revealFilePath(draft.id, "../secret.txt")).rejects.toThrow(/ngoài workspace/);
    await expect(manager.revealFilePath(draft.id, visible)).rejects.toThrow(/không hợp lệ/);
    await expect(manager.revealFilePath(draft.id, "assets/missing.png")).rejects.toThrow(/Không tìm thấy/);
  });

  it("persists workflow transitions and opens legacy records in discovery", async () => {
    const { manager, root } = await managerForTest();
    const draft = await manager.createDraft("Workflow bền vững");

    expect(draft).toMatchObject({
      workflowVersion: 1,
      workflowRevision: 0,
      productionState: "discovery",
      sessionAccess: "full",
    });
    await manager.transitionWorkflow(draft.id, {
      expectedRevision: 0,
      to: "collecting_assets",
      jobId: "job-restart",
    });
    const reopened = new HarnessManager({
      draftsRoot: root,
      harnessHome: join(root, "harness"),
      harnessCliPath: join(root, "missing-harness.js"),
      submissionPluginPath: join(root, "motionreal-tools.mjs"),
    });
    await expect(reopened.status(draft.id)).resolves.toMatchObject({
      workflowRevision: 1,
      productionState: "collecting_assets",
      activeJobId: "job-restart",
    });

    await writeFile(join(root, draft.id, "motionreal-agent.json"), JSON.stringify({
      id: draft.id,
      title: draft.title,
      createdAt: draft.createdAt,
    }));
    await expect(reopened.status(draft.id)).resolves.toMatchObject({
      workflowVersion: 1,
      workflowRevision: 0,
      productionState: "discovery",
      sessionAccess: "legacy-approval",
    });
  });

  it("prompts the active Harness session and advances a valid asset manifest to review", async () => {
    const { manager, root, calls } = await activeManagerForTest();
    const draft = await manager.createDraft("Asset thật");
    await manager.activate(draft.id, "internal-key");
    const collecting = await manager.prepareAssets(draft.id, draft.workflowRevision);
    const draftRoot = join(root, draft.id);
    await writeFile(join(draftRoot, "assets", "one.png"), ONE_PIXEL_PNG);
    await writeFile(join(draftRoot, "handoff", "assets.json"), JSON.stringify({
      version: 1,
      job_id: collecting.activeJobId,
      request_revision: 1,
      items: [{ id: "asset-01", path: "assets/one.png", source_url: "https://example.com/one.png", label: "Ảnh một" }],
    }));

    const review = await manager.status(draft.id);
    expect(review).toMatchObject({ productionState: "asset_review", workflowRevision: 2 });
    expect(review.assetReview).toEqual([expect.objectContaining({ id: "asset-01", role: "support", width: 1, height: 1 })]);
    await expect(manager.status(draft.id)).resolves.toMatchObject({ productionState: "asset_review", workflowRevision: 2 });
    expect(calls.at(-1)).toMatchObject({
      method: "session.prompt",
      payload: { sessionId: expect.stringMatching(/^session-/), mode: "queue" },
    });

    const approved = await manager.approveAssets(draft.id, review.workflowRevision, ["asset-01"]);
    expect(approved).toMatchObject({ productionState: "brief_review", selectedAssetIds: ["asset-01"] });
    await manager.dispose();
  });

  it("loads history, queues human chat, and cancels through the public Harness RPC", async () => {
    const { manager, calls } = await activeManagerForTest();
    const draft = await manager.createDraft("Chat native");
    await manager.activate(draft.id, "internal-key");

    await expect(manager.chatHistory(draft.id)).resolves.toEqual({ items: [], hasMore: false, running: false });
    await manager.sendChatPrompt(draft.id, "  Hãy research Gemini  ");
    await manager.abortChat(draft.id);

    expect(calls.slice(-3)).toEqual([
      expect.objectContaining({ method: "session.history", payload: expect.objectContaining({ maxMessages: 80 }) }),
      expect.objectContaining({ method: "session.prompt", payload: expect.objectContaining({ content: [{ type: "text", text: "Hãy research Gemini" }] }) }),
      expect.objectContaining({ method: "session.cancel" }),
    ]);
    await manager.dispose();
  });

  it("reports and stores the dedicated web search credential without persisting it in MotionReal", async () => {
    const { manager, root, calls } = await activeManagerForTest();
    const draft = await manager.createDraft("Search credential");
    const opened = await manager.activate(draft.id, "internal-key");
    expect(opened.webSearchConfigured).toBe(false);

    const configured = await manager.setSearchApiKey(draft.id, "deepseek-search-secret");
    expect(configured.webSearchConfigured).toBe(true);
    expect(calls.filter((call) => call.method === "credentials.set")).toEqual([
      expect.objectContaining({ method: "credentials.set", payload: { ref: "DEEPSEEK_API_KEY", value: "deepseek-search-secret" } }),
    ]);
    await expect(readFile(join(root, draft.id, "motionreal-agent.json"), "utf8"))
      .resolves.not.toContain("deepseek-search-secret");
    await manager.dispose();
  });

  it("projects the Harness WebSocket stream and reports child exit without exposing raw frames", async () => {
    const root = await mkdtemp(join(tmpdir(), "motionreal-agent-events-"));
    roots.push(root);
    const cli = join(root, "dsh.js");
    await writeFile(cli, "// test placeholder\n");
    await writeFile(join(root, "motionreal-tools.mjs"), "// test tool plugin\n");
    const child = Object.assign(new EventEmitter(), { kill: vi.fn(() => false) });
    const projected: unknown[] = [];
    const socket = Object.assign(new EventTarget(), { close: vi.fn() });
    const openWebSocket = vi.fn(() => socket as unknown as WebSocket);
    const manager = new HarnessManager({
      draftsRoot: root,
      harnessHome: join(root, "harness"),
      harnessCliPath: cli,
      submissionPluginPath: join(root, "motionreal-tools.mjs"),
      findPort: async () => 39871,
      spawn: vi.fn(() => child) as unknown as typeof import("node:child_process").spawn,
      onChatEvent: (event) => projected.push(event),
      openWebSocket,
      fetch: vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { method: string };
        const value = body.method === "workspace.create" ? { workspace: { workspaceId: "workspace-events" } } : {};
        return Response.json({ type: "server-response", result: { ok: true, value } });
      }) as unknown as typeof globalThis.fetch,
    });
    const draft = await manager.createDraft("WebSocket thật");
    await manager.activate(draft.id, "internal-key");
    expect(openWebSocket).toHaveBeenCalledWith("ws://127.0.0.1:39871/api/events.mux");
    socket.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({
      type: "server-request",
      payload: {
        type: "session/event",
        sessionId: (await readFile(join(root, draft.id, "motionreal-agent.json"), "utf8").then((raw) => JSON.parse(raw).sessionId)),
        event: { type: "assistant/chunk", data: { chunk: { type: "text-delta", text: "Đang research" } } },
      },
    }) }));
    expect(projected).toContainEqual({ draftId: draft.id, type: "assistant-delta", text: "Đang research" });

    child.emit("close", 1, null);
    expect(projected).toContainEqual({ draftId: draft.id, type: "error", code: "stream_failed" });
    await manager.dispose();
  });

  it("keeps invalid or stale asset handoffs in collection with a safe validation error", async () => {
    const { manager, root } = await activeManagerForTest();
    const draft = await manager.createDraft("Asset lỗi");
    await manager.activate(draft.id, "internal-key");
    const collecting = await manager.prepareAssets(draft.id, 0);
    const draftRoot = join(root, draft.id);
    await writeFile(join(draftRoot, "outside.png"), ONE_PIXEL_PNG);
    await writeFile(join(draftRoot, "handoff", "assets.json"), JSON.stringify({
      version: 1,
      job_id: collecting.activeJobId,
      request_revision: 1,
      items: [{ id: "asset-01", path: "outside.png", source_url: "https://example.com/one.png" }],
    }));

    const status = await manager.status(draft.id);
    expect(status.productionState).toBe("collecting_assets");
    expect(status.assetCollectionError).toMatch(/assets/);
    await manager.dispose();
  });

  it("rejects partial, stale, duplicate, missing, unsupported, and oversized manifest inputs", async () => {
    const { manager, root } = await activeManagerForTest();
    const draft = await manager.createDraft("Kiểm manifest");
    await manager.activate(draft.id, "internal-key");
    const collecting = await manager.prepareAssets(draft.id, 0);
    const draftRoot = join(root, draft.id);
    const handoffPath = join(draftRoot, "handoff", "assets.json");
    await writeFile(join(draftRoot, "assets", "one.png"), ONE_PIXEL_PNG);
    await writeFile(join(draftRoot, "assets", "bad.txt"), "not an image");
    await writeFile(join(draftRoot, "assets", "huge.png"), Buffer.alloc(10 * 1024 * 1024 + 1));
    const item = { id: "asset-01", path: "assets/one.png", source_url: "https://example.com/one.png" };
    const cases: Array<{ body: string; error: RegExp }> = [
      { body: "{", error: /JSON/ },
      { body: JSON.stringify({ version: 1, job_id: "job-stale", request_revision: 1, items: [item] }), error: /không khớp/ },
      { body: JSON.stringify({ version: 1, job_id: collecting.activeJobId, request_revision: 1, items: [item, item] }), error: /trùng/ },
      { body: JSON.stringify({ version: 1, job_id: collecting.activeJobId, request_revision: 1, items: [{ ...item, path: "assets/missing.png" }] }), error: /Không tìm thấy/ },
      { body: JSON.stringify({ version: 1, job_id: collecting.activeJobId, request_revision: 1, items: [{ ...item, path: "assets/bad.txt" }] }), error: /raster/ },
      { body: JSON.stringify({ version: 1, job_id: collecting.activeJobId, request_revision: 1, items: [{ ...item, path: "assets/huge.png" }] }), error: /10 MB/ },
    ];
    for (const fixture of cases) {
      await writeFile(handoffPath, fixture.body);
      const status = await manager.status(draft.id);
      expect(status.productionState).toBe("collecting_assets");
      expect(status.assetCollectionError).toMatch(fixture.error);
    }
    await manager.dispose();
  });

  it("persists kept asset ids and requires a newer manifest after requesting more", async () => {
    const { manager, root } = await activeManagerForTest();
    const draft = await manager.createDraft("Tìm thêm");
    await manager.activate(draft.id, "internal-key");
    const collecting = await manager.prepareAssets(draft.id, 0);
    const draftRoot = join(root, draft.id);
    await writeFile(join(draftRoot, "assets", "one.png"), ONE_PIXEL_PNG);
    await writeFile(join(draftRoot, "handoff", "assets.json"), JSON.stringify({
      version: 1,
      job_id: collecting.activeJobId,
      request_revision: 1,
      items: [{ id: "asset-01", path: "assets/one.png", source_url: "https://example.com/one.png" }],
    }));
    const review = await manager.status(draft.id);

    const more = await manager.requestMoreAssets(draft.id, review.workflowRevision, ["asset-01"], "Tìm ảnh giao diện mới");
    expect(more).toMatchObject({ productionState: "collecting_assets", selectedAssetIds: ["asset-01"] });
    const stale = await manager.status(draft.id);
    expect(stale.productionState).toBe("collecting_assets");
    expect(stale.assetCollectionError).toMatch(/lượt yêu cầu/);

    await writeFile(join(draftRoot, "handoff", "assets.json"), JSON.stringify({
      version: 1,
      job_id: collecting.activeJobId,
      request_revision: 2,
      items: [{ id: "asset-01", path: "assets/one.png", source_url: "https://example.com/one.png" }],
    }));
    await expect(manager.status(draft.id)).resolves.toMatchObject({
      productionState: "asset_review",
      selectedAssetIds: ["asset-01"],
    });

    const reopened = new HarnessManager({
      draftsRoot: root,
      harnessHome: join(root, "harness"),
      harnessCliPath: join(root, "missing.js"),
      submissionPluginPath: join(root, "motionreal-tools.mjs"),
      mediaUrl: (path) => `media://${path}`,
    });
    await expect(reopened.status(draft.id)).resolves.toMatchObject({ selectedAssetIds: ["asset-01"] });
    await manager.dispose();
  });

  it("requests, validates, edits, and freezes a brief before create", async () => {
    const { manager, root, calls } = await activeManagerForTest();
    const draft = await manager.createDraft("Gemini là gì");
    await manager.activate(draft.id, "internal-key");
    const collecting = await manager.prepareAssets(draft.id, 0);
    const draftRoot = join(root, draft.id);
    await writeFile(join(draftRoot, "assets", "one.png"), ONE_PIXEL_PNG);
    await writeFile(join(draftRoot, "handoff", "assets.json"), JSON.stringify({
      version: 1,
      job_id: collecting.activeJobId,
      request_revision: 1,
      items: [{ id: "asset-01", path: "assets/one.png", source_url: "https://example.com/one.png", label: "Gemini" }],
    }));
    const assets = await manager.status(draft.id);
    const waiting = await manager.approveAssets(draft.id, assets.workflowRevision, ["asset-01"]);
    expect(waiting).toMatchObject({ productionState: "brief_review", workflowRevision: 3 });
    expect(calls.at(-1)).toMatchObject({ method: "session.prompt" });
    const request = JSON.parse(await readFile(join(draftRoot, "handoff", "brief-request.json"), "utf8"));
    expect(request).toMatchObject({
      job_id: collecting.activeJobId,
      request_revision: 1,
      selected_asset_ids: ["asset-01"],
      duration_options: [
        { duration_tier: 1, target_seconds: 45 },
        { duration_tier: 2, target_seconds: 90 },
        { duration_tier: 3, target_seconds: 150 },
        { duration_tier: 4, target_seconds: 210 },
      ],
    });

    await writeFile(join(draftRoot, "handoff", "brief.json"), `\uFEFF${JSON.stringify({
      version: 1,
      job_id: collecting.activeJobId,
      request_revision: 1,
      brief_revision: 1,
      title: "Gemini là gì?",
      prompt: "Giải thích Gemini bằng mạch kể rõ ràng và dùng ảnh đã chọn làm trọng tâm thị giác.",
      format: "tiktok",
      duration_tier: 2,
      video_language: "vi",
      voice_provider: "vivibe",
      selected_asset_ids: ["asset-01"],
    })}`);
    const review = await manager.status(draft.id);
    expect(review.briefReview).toMatchObject({ revision: 1, durationTier: 2, selectedAssetIds: ["asset-01"] });
    expect(review.createReady).toBe(false);

    const promptCount = calls.filter((call) => call.method === "session.prompt").length;
    const back = await manager.returnToAssets(draft.id, review.workflowRevision);
    const reused = await manager.approveAssets(draft.id, back.workflowRevision, ["asset-01"]);
    expect(reused).toMatchObject({
      productionState: "brief_review",
      workflowRevision: 5,
      briefReview: { revision: 1, title: "Gemini là gì?" },
    });
    expect(calls.filter((call) => call.method === "session.prompt")).toHaveLength(promptCount);
    const unchangedRequest = JSON.parse(await readFile(join(draftRoot, "handoff", "brief-request.json"), "utf8"));
    expect(unchangedRequest.request_revision).toBe(1);

    const queued = await manager.approveBrief(draft.id, reused.workflowRevision, {
      title: "Gemini AI là gì?",
      prompt: "Giải thích Gemini AI trong 45 giây bằng mạch kể trực quan, chính xác và dùng ảnh đã chọn đúng ngữ cảnh.",
      durationTier: 2,
      videoLanguage: "vi",
      voiceProvider: "vivibe",
    });
    expect(queued).toMatchObject({ productionState: "queued_create", workflowRevision: 6, createReady: true });
    await expect(manager.readCreateRequest(draft.id)).resolves.toMatchObject({
      prompt: expect.stringContaining("Gemini AI"),
      title: "Gemini AI là gì?",
      assets: [{ id: "asset-01", path: join(draftRoot, "assets", "one.png") }],
      choices: { durationTier: 2, videoLanguage: "vi", voiceProvider: "vivibe" },
    });
    const frozen = JSON.parse(await readFile(join(draftRoot, "handoff", "brief.json"), "utf8"));
    expect(frozen).toMatchObject({ brief_revision: 2, accepted: true, duration_tier: 2, target_seconds: 90 });
    await manager.linkProject(draft.id, "project-gemini");
    await expect(manager.status(draft.id)).resolves.toMatchObject({
      productionState: "authoring",
      projectId: "project-gemini",
      createReady: false,
    });
    await manager.linkProject(draft.id, "project-gemini");
    await expect(manager.linkProject(draft.id, "project-other")).rejects.toThrow(/project khác/);
    await manager.dispose();
  });

  it("keeps stale/invalid briefs in review and can return to the same asset selection", async () => {
    const { manager, root } = await activeManagerForTest();
    const draft = await manager.createDraft("Brief lỗi");
    await manager.activate(draft.id, "internal-key");
    const collecting = await manager.prepareAssets(draft.id, 0);
    const draftRoot = join(root, draft.id);
    await writeFile(join(draftRoot, "assets", "one.png"), ONE_PIXEL_PNG);
    await writeFile(join(draftRoot, "handoff", "assets.json"), JSON.stringify({
      version: 1,
      job_id: collecting.activeJobId,
      request_revision: 1,
      items: [{ id: "asset-01", path: "assets/one.png", source_url: "https://example.com/one.png" }],
    }));
    const assets = await manager.status(draft.id);
    const waiting = await manager.approveAssets(draft.id, assets.workflowRevision, ["asset-01"]);
    await writeFile(join(draftRoot, "handoff", "brief.json"), JSON.stringify({
      version: 1,
      job_id: "job-stale",
      request_revision: 1,
      brief_revision: 1,
      title: "Sai",
      prompt: "Nội dung đủ dài nhưng thuộc về một job hoàn toàn khác.",
      format: "tiktok",
      duration_tier: 1,
      video_language: "vi",
      voice_provider: "vivibe",
      selected_asset_ids: ["asset-01"],
    }));
    const invalid = await manager.status(draft.id);
    expect(invalid.productionState).toBe("brief_review");
    expect(invalid.briefReviewError).toMatch(/không khớp/);
    await expect(manager.readCreateRequest(draft.id)).rejects.toThrow(/duyệt brief/);

    const back = await manager.returnToAssets(draft.id, waiting.workflowRevision);
    expect(back).toMatchObject({ productionState: "asset_review", selectedAssetIds: ["asset-01"] });
    expect(back.assetReview).toHaveLength(1);
    await manager.dispose();
  });

  it("refuses a create request that reaches outside the video workspace or into Harness history", async () => {
    const { manager, root } = await managerForTest();
    const draft = await manager.createDraft("An toàn đường dẫn");
    const requestFile = join(root, draft.id, "motionreal.create.json");
    let state = await manager.transitionWorkflow(draft.id, { expectedRevision: 0, to: "collecting_assets", jobId: "job-create" });
    state = await manager.transitionWorkflow(draft.id, { expectedRevision: state.workflowRevision, to: "asset_review", jobId: "job-create" });
    state = await manager.transitionWorkflow(draft.id, { expectedRevision: state.workflowRevision, to: "brief_review", jobId: "job-create" });
    await manager.transitionWorkflow(draft.id, { expectedRevision: state.workflowRevision, to: "queued_create", jobId: "job-create" });
    const metadataFile = join(root, draft.id, "motionreal-agent.json");
    const metadata = JSON.parse(await readFile(metadataFile, "utf8"));
    await writeFile(metadataFile, JSON.stringify({ ...metadata, selectedAssetIds: ["asset-01"] }));
    const createRequest = {
      version: 1,
      title: "An toàn đường dẫn",
      prompt: "x",
      duration_tier: 1,
      video_language: "vi",
      voice_provider: "vivibe",
      selected_asset_ids: ["asset-01"],
    };
    await mkdir(join(root, draft.id, "handoff"), { recursive: true });

    await writeFile(join(root, draft.id, "handoff", "assets.json"), JSON.stringify({
      items: [{ id: "asset-01", path: "../secret.png" }],
    }));
    await writeFile(requestFile, JSON.stringify(createRequest));
    await expect(manager.readCreateRequest(draft.id)).rejects.toThrow(/assets/);

    await writeFile(join(root, draft.id, "handoff", "assets.json"), JSON.stringify({
      items: [{ id: "asset-01", path: ".harness/sessions/a.png" }],
    }));
    await expect(manager.readCreateRequest(draft.id)).rejects.toThrow(/assets/);
  });

  it.each(["unchanged", "source-edited", "manifest-edited", "asset-edited", "still-missing", "missing-review", "stale-review", "unread-images", "restart", "during-render", "during-history"] as const)("reviews newly rendered Harness scenes before human approval (%s)", async (reviewChange) => {
    let stillPaths: string[] = [];
    const renderAuthoringStills = vi.fn(async () => {
      await Promise.all(stillPaths.map((path) => writeFile(path, ONE_PIXEL_PNG)));
      return { ok: true as const, stills: stillPaths };
    });
    const acceptAuthoringStills = vi.fn(async () => undefined);
    const setup = await activeManagerForTest({
      renderAuthoringStills,
      acceptAuthoringStills,
      wordsPerSecond: async () => 1,
    });
    const { root, calls, history } = setup;
    const recordImageReads = (paths: string[]) => {
      for (const path of paths) {
        const callId = `image-${history.length}`;
        history.push({ event: { seq: history.length, type: "tool/call", data: {
          callId, name: "read_image", arguments: JSON.stringify({ file_path: path }),
        } } });
        history.push({ event: { seq: history.length, type: "tool/result", data: { message: { content: [{
          type: "tool-result", toolCallId: callId, isError: false,
          content: [{ type: "image", attachment: {
            attachmentId: callId, mediaType: "image/png", bytes: 68, width: 1, height: 1,
          } }],
        }] } } } });
      }
      history.push({ event: { seq: history.length, type: "assistant/message", data: { message: {
        content: [{ type: "text", text: "Review observations after image tool results" }],
      } } } });
    };
    let manager = setup.manager;
    const draft = await manager.createDraft("Harness authoring");
    await manager.activate(draft.id, "internal-key");
    let state = await manager.transitionWorkflow(draft.id, { expectedRevision: 0, to: "collecting_assets", jobId: "job-author" });
    state = await manager.transitionWorkflow(draft.id, { expectedRevision: state.workflowRevision, to: "asset_review", jobId: "job-author" });
    state = await manager.transitionWorkflow(draft.id, { expectedRevision: state.workflowRevision, to: "brief_review", jobId: "job-author" });
    state = await manager.transitionWorkflow(draft.id, { expectedRevision: state.workflowRevision, to: "queued_create", jobId: "job-author" });
    const draftRoot = join(root, draft.id);
    const metadataPath = join(draftRoot, "motionreal-agent.json");
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    await writeFile(metadataPath, JSON.stringify({ ...metadata, briefRequestRevision: 1 }));
    await mkdir(join(draftRoot, "handoff"), { recursive: true });
    await writeFile(join(draftRoot, "handoff", "brief.json"), JSON.stringify({
      version: 1,
      job_id: "job-author",
      request_revision: 1,
      brief_revision: 1,
      title: "Harness authoring",
      prompt: "Viết video Harness đủ nhịp kể, đủ narration và dùng asset theo đúng ngữ cảnh.",
      format: "tiktok",
      duration_tier: 1,
      video_language: "vi",
      voice_provider: "vivibe",
      selected_asset_ids: [],
    }));
    await manager.linkProject(draft.id, "project-1");
    const projectRoot = join(root, "projects", "project-1");
    await mkdir(join(projectRoot, "assets"), { recursive: true });
    await mkdir(join(projectRoot, "authored"), { recursive: true });
    await mkdir(join(projectRoot, "review"), { recursive: true });
    await writeFile(join(projectRoot, "assets", "logo.png"), ONE_PIXEL_PNG);
    const sceneIds = ["scene-01", "scene-02", "scene-03"];
    stillPaths = sceneIds.map((sceneId) => join(projectRoot, "review", `${sceneId}.png`));
    await Promise.all(stillPaths.map((path) => writeFile(path, ONE_PIXEL_PNG)));

    await manager.startAuthoring(draft.id, "project-1", projectRoot, [{ id: "logo", ref: "assets/logo.png", role: "logo" }]);

    await expect(realpath(join(root, draft.id, "project"))).resolves.toBe(await realpath(projectRoot));
    const request = JSON.parse(await readFile(join(root, draft.id, "handoff", "authoring-request.json"), "utf8"));
    expect(request).toMatchObject({
      version: 1,
      job_id: "job-author",
      request_revision: 1,
      phase: "initial",
      creative_stage: "v1",
      manifest: "project/manifest.json",
      pacing: {
        duration_tier: 1,
        target_seconds: 45,
        min_narration_words: 38,
        min_scenes: 3,
      },
      assets: [{ id: "logo", ref: "assets/logo.png", path: "project/assets/logo.png", role: "logo" }],
    });
    expect(request.instructions).toEqual(expect.arrayContaining([expect.stringContaining("read_image")]));
    expect(calls.at(-1)).toMatchObject({ method: "session.prompt" });
    await expect(readFile(join(root, draft.id, "handoff", "authoring-contract.md"), "utf8"))
      .resolves.toMatch(/HỢP ĐỒNG VIẾT CẢNH/);

    await writeFile(join(projectRoot, "manifest.json"), JSON.stringify({
      title: "Harness authoring",
      durationTier: 4,
      videoLanguage: "en",
      scenes: sceneIds.map((id, index) => ({
        id,
        component: id,
        headline: id,
        narration: "ngắn",
        ...(index === 0 ? { image: { ref: "assets/logo.png", role: "logo" } } : {}),
        ...(index < sceneIds.length - 1 ? { transitionToNext: index === 0 ? "slide" : "fade" } : {}),
      })),
    }));
    await Promise.all(sceneIds.map((id) => writeFile(join(projectRoot, "authored", `Module-${id}.tsx`), registeredSceneSource(id, "v1"))));

    await writeFile(join(root, draft.id, "handoff", "authoring.json"), JSON.stringify({
      version: 1,
      job_id: "job-author",
      request_revision: 1,
      scene_ids: sceneIds,
      used_asset_ids: ["logo"],
    }));
    await vi.waitFor(async () => {
      const repairRequest = JSON.parse(await readFile(join(root, draft.id, "handoff", "authoring-request.json"), "utf8"));
      expect(repairRequest).toMatchObject({ request_revision: 2, phase: "repair" });
      expect(repairRequest.render_error).toMatch(/Narration có 3 từ/);
    }, { timeout: 2_000 });
    expect(renderAuthoringStills).not.toHaveBeenCalled();

    await writeFile(join(projectRoot, "manifest.json"), JSON.stringify({
      title: "Harness authoring",
      durationTier: 4,
      videoLanguage: "en",
      scenes: sceneIds.map((id, index) => ({
        id,
        component: id,
        headline: id,
        narration: "một hai ba bốn năm sáu bảy tám chín mười mười một mười hai mười ba",
        ...(index === 0 ? { image: { ref: "assets/logo.png", role: "logo" } } : {}),
        ...(index < sceneIds.length - 1 ? { transitionToNext: index === 0 ? "slide" : "fade" } : {}),
      })),
    }));
    await writeFile(join(root, draft.id, "handoff", "authoring.json"), JSON.stringify({
      version: 1,
      job_id: "job-author",
      request_revision: 2,
      scene_ids: sceneIds,
      used_asset_ids: ["logo"],
    }));
    await vi.waitFor(() => expect(renderAuthoringStills).toHaveBeenCalledWith("project-1", sceneIds), { timeout: 2_000 });
    await expect(readFile(join(projectRoot, "manifest.json"), "utf8").then(JSON.parse)).resolves.toMatchObject({
      durationTier: 1,
      videoLanguage: "vi",
    });
    await vi.waitFor(async () => {
      const reviewRequest = JSON.parse(await readFile(join(root, draft.id, "handoff", "authoring-request.json"), "utf8"));
      expect(reviewRequest).toMatchObject({
        request_revision: 3,
        phase: "self_review",
        creative_stage: "v2",
        v1_baseline: "handoff/authoring-v1",
        stills: sceneIds.map((sceneId) => `handoff/authoring-v1/stills/${sceneId}.png`),
      });
      expect(reviewRequest.instructions).toEqual(expect.arrayContaining([expect.stringContaining("read_image")]));
    }, { timeout: 5_000 });
    await expect(readFile(join(root, draft.id, "handoff", "authoring-v1", "authored", "Module-scene-01.tsx"), "utf8"))
      .resolves.toBe(registeredSceneSource("scene-01", "v1"));
    await writeFile(join(root, draft.id, "handoff", "authoring.json"), JSON.stringify({
      version: 1,
      job_id: "job-author",
      request_revision: 3,
      scene_ids: sceneIds,
      used_asset_ids: ["logo"],
      reviewed_scene_ids: sceneIds,
      review_notes: "Đã mở PNG, kiểm tra asset và hierarchy; scene rõ ràng.",
    }));
    await vi.waitFor(async () => {
      const repairRequest = JSON.parse(await readFile(join(root, draft.id, "handoff", "authoring-request.json"), "utf8"));
      expect(repairRequest).toMatchObject({ request_revision: 4, phase: "self_review", creative_stage: "v2" });
      expect(repairRequest.render_error).toMatch(/chưa viết lại các scene/);
      expect(repairRequest.instructions).toEqual(expect.arrayContaining([expect.stringContaining("read_image")]));
    }, { timeout: 2_000 });
    await Promise.all(sceneIds.map((id) => writeFile(join(projectRoot, "authored", `Module-${id}.tsx`), registeredSceneSource(id, "v2"))));
    let releaseReviewCommit: (() => void) | undefined;
    if (reviewChange === "restart") {
      // Hold the real persistence method between the request file and metadata writes.
      const persistence = manager as unknown as { writeRecord(value: { authoringRequestRevision?: number }): Promise<void> };
      const writeRecord = persistence.writeRecord.bind(manager);
      let held = false;
      vi.spyOn(persistence, "writeRecord").mockImplementation(async (record) => {
        if (record.authoringRequestRevision === 5 && !held) {
          held = true;
          await new Promise<void>((resolve) => { releaseReviewCommit = resolve; heldCommits.push(resolve); });
        }
        await writeRecord(record);
      });
    }
    recordImageReads(sceneIds.map((id) => `handoff/authoring-v1/stills/${id}.png`));
    await writeFile(join(root, draft.id, "handoff", "authoring.json"), JSON.stringify({
      version: 1,
      job_id: "job-author",
      request_revision: 4,
      scene_ids: sceneIds,
      used_asset_ids: ["logo"],
      reviewed_scene_ids: sceneIds,
      review_notes: "Đã mở từng PNG; viết lại hierarchy, framing, focal motion và chọn transition theo quan hệ nội dung.",
    }));
    const requestPath = join(root, draft.id, "handoff", "authoring-request.json");
    const submissionPath = join(root, draft.id, "handoff", "authoring.json");
    await vi.waitFor(async () => {
      expect(JSON.parse(await readFile(requestPath, "utf8"))).toMatchObject({
        request_revision: 5, phase: "image_review", creative_stage: "v2",
        stills: sceneIds.map((sceneId) => `project/review/${sceneId}.png`),
        review_fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        review_after_seq: history.at(-1)!.event.seq,
      });
    }, { timeout: 5_000 });
    expect(renderAuthoringStills).toHaveBeenCalledTimes(2);
    expect(acceptAuthoringStills).not.toHaveBeenCalled();
    await expect(manager.status(draft.id)).resolves.toMatchObject({ productionState: "authoring" });
    // Acknowledgements from the V1-to-V2 rewrite cannot finish the new image review.
    const reviewSubmission = {
      version: 1, job_id: "job-author", request_revision: 5, scene_ids: sceneIds,
      used_asset_ids: ["logo"], reviewed_scene_ids: sceneIds,
      review_notes: "Đã xem ảnh V2 mới render: logo gọn, hierarchy rõ, vẫn cần người dùng kiểm tra motion.",
    };
    let reviewRevision = 5;
    let expectedRenders = 2;
    if (reviewChange === "restart") {
      const savedSessionId = JSON.parse(await readFile(metadataPath, "utf8")).sessionId;
      expect(savedSessionId).toEqual(expect.stringMatching(/^session-/));
      await vi.waitFor(() => expect(releaseReviewCommit).toBeTypeOf("function"));
      let disposed = false;
      const closing = manager.dispose().then(() => { disposed = true; });
      try {
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(disposed).toBe(false);
      } finally {
        releaseReviewCommit!();
        await closing;
      }
      expect(JSON.parse(await readFile(metadataPath, "utf8")).authoringRequestRevision).toBe(5);
      manager = new HarnessManager(setup.deps);
      activeManagers.push(manager);
      const reopened = await manager.activate(draft.id, "internal-key");
      expect(calls.filter((call) => call.method === "session.create").at(-1)?.payload)
        .toMatchObject({ sessionId: savedSessionId });
      expect(JSON.parse(await readFile(metadataPath, "utf8")).sessionId).toBe(savedSessionId);
      expect(reopened.productionState).toBe("authoring");
    }
    if (reviewChange === "source-edited" || reviewChange === "during-render") {
      await writeFile(join(projectRoot, "authored", "Module-scene-01.tsx"), registeredSceneSource("scene-01", "v3"));
      if (reviewChange === "during-render") renderAuthoringStills.mockImplementationOnce(async () => {
        await writeFile(join(projectRoot, "authored", "Module-scene-01.tsx"), registeredSceneSource("scene-01", "changed-mid-render"));
        return { ok: true, stills: stillPaths };
      });
    } else if (reviewChange === "manifest-edited") {
      const manifest = JSON.parse(await readFile(join(projectRoot, "manifest.json"), "utf8"));
      manifest.scenes[0].headline = "A changed headline after the still";
      await writeFile(join(projectRoot, "manifest.json"), JSON.stringify(manifest));
    } else if (reviewChange === "asset-edited") {
      await writeFile(join(projectRoot, "assets", "logo.png"), Buffer.concat([ONE_PIXEL_PNG, Buffer.from("changed")]));
    } else if (reviewChange === "still-missing") {
      await rm(stillPaths[0]!);
    }
    if (reviewChange === "missing-review" || reviewChange === "stale-review" || reviewChange === "unread-images") {
      await writeFile(submissionPath, JSON.stringify({ ...reviewSubmission,
        ...(reviewChange === "missing-review" ? { reviewed_scene_ids: [], review_notes: "" }
          : reviewChange === "stale-review" ? { request_revision: 4 } : {}),
      }));
      await vi.waitFor(async () => expect(JSON.parse(await readFile(requestPath, "utf8")))
        .toMatchObject({ request_revision: 6, phase: "image_review", render_error: expect.any(String) }), { timeout: 5_000 });
      expect(acceptAuthoringStills).not.toHaveBeenCalled();
      expect(renderAuthoringStills).toHaveBeenCalledTimes(2);
      reviewRevision = 6;
      if (reviewChange === "unread-images") {
        expect(JSON.parse(await readFile(requestPath, "utf8")).render_error).toMatch(/read_image/);
      }
    }
    recordImageReads(sceneIds.map((id) => `project/review/${id}.png`));
    if (reviewChange === "during-history") {
      const fetch = vi.mocked(setup.deps.fetch!);
      const original = fetch.getMockImplementation()!;
      fetch.mockImplementation(async (input, init) => {
        if (JSON.parse(String(init?.body)).method === "session.history") {
          fetch.mockImplementation(original);
          const manifest = JSON.parse(await readFile(join(projectRoot, "manifest.json"), "utf8"));
          manifest.scenes[0].headline = "updated-during-history";
          await writeFile(join(projectRoot, "manifest.json"), JSON.stringify(manifest));
        }
        return original(input, init);
      });
    }
    await writeFile(submissionPath, JSON.stringify({ ...reviewSubmission, request_revision: reviewRevision }));
    if (["source-edited", "manifest-edited", "asset-edited", "still-missing", "during-render", "during-history"].includes(reviewChange)) {
      await vi.waitFor(async () => expect(JSON.parse(await readFile(requestPath, "utf8")))
        .toMatchObject({ request_revision: 6, phase: "image_review" }), { timeout: 5_000 });
      expect(acceptAuthoringStills).not.toHaveBeenCalled();
      expect(renderAuthoringStills).toHaveBeenCalledTimes(reviewChange === "during-history" ? 2 : 3);
      reviewRevision = 6;
      expectedRenders = 3;
      recordImageReads(sceneIds.map((id) => `project/review/${id}.png`));
      await writeFile(submissionPath, JSON.stringify({ ...reviewSubmission, request_revision: 6 }));
      if (reviewChange === "during-render" || reviewChange === "during-history") {
        await vi.waitFor(async () => expect(JSON.parse(await readFile(requestPath, "utf8")))
          .toMatchObject({ request_revision: 7, phase: "image_review" }), { timeout: 5_000 });
        expect(acceptAuthoringStills).not.toHaveBeenCalled();
        expectedRenders = reviewChange === "during-history" ? 3 : 4;
        reviewRevision = 7;
        recordImageReads(sceneIds.map((id) => `project/review/${id}.png`));
        await writeFile(submissionPath, JSON.stringify({ ...reviewSubmission, request_revision: 7 }));
      }
    }
    await vi.waitFor(() => expect(acceptAuthoringStills).toHaveBeenCalledWith("project-1"), { timeout: 2_000 });
    expect(renderAuthoringStills).toHaveBeenCalledTimes(expectedRenders);
    if (reviewChange === "during-history") {
      expect(JSON.parse(await readFile(join(projectRoot, "manifest.json"), "utf8")).scenes[0].headline).toBe("updated-during-history");
    }
    await vi.waitFor(async () => expect(await manager.status(draft.id)).toMatchObject({ productionState: "still_review" }));

    await expect(manager.requestSceneEdits(draft.id, "project-1", [{ sceneId: "scene-99", text: "Sửa cảnh lạ" }], ""))
      .rejects.toThrow(/không hợp lệ/);
    await manager.requestSceneEdits(draft.id, "project-1", [{ sceneId: "scene-01", text: "Phóng to logo và bỏ khung trang trí." }], "Giữ nhịp hình rõ ràng.");
    await expect(readFile(join(root, draft.id, "handoff", "authoring-request.json"), "utf8").then(JSON.parse)).resolves.toMatchObject({
      request_revision: reviewRevision + 1,
      phase: "edit",
      creative_stage: "edit",
      target_scene_ids: ["scene-01"],
      edit_request: {
        per_scene: [{ sceneId: "scene-01", text: "Phóng to logo và bỏ khung trang trí." }],
        global_notes: "Giữ nhịp hình rõ ràng.",
      },
    });
    await expect(readFile(join(root, draft.id, "handoff", "authoring.json"), "utf8")).rejects.toThrow();
    await expect(manager.status(draft.id)).resolves.toMatchObject({ productionState: "authoring" });
    expect(calls.at(-1)).toMatchObject({ method: "session.prompt" });
    const editRevision = reviewRevision + 1;
    await writeFile(join(projectRoot, "authored", "Module-scene-01.tsx"), registeredSceneSource("scene-01", "user-edit"));
    await writeFile(submissionPath, JSON.stringify({ ...reviewSubmission, request_revision: editRevision }));
    await vi.waitFor(async () => expect(JSON.parse(await readFile(requestPath, "utf8")))
      .toMatchObject({ request_revision: editRevision + 1, phase: "image_review", creative_stage: "edit" }), { timeout: 5_000 });
    expect(acceptAuthoringStills).toHaveBeenCalledTimes(1);
    const rendersBeforeEditReview = renderAuthoringStills.mock.calls.length;
    recordImageReads(sceneIds.map((id) => `project/review/${id}.png`));
    await writeFile(submissionPath, JSON.stringify({ ...reviewSubmission, request_revision: editRevision + 1 }));
    await vi.waitFor(() => expect(acceptAuthoringStills).toHaveBeenCalledTimes(2), { timeout: 5_000 });
    expect(renderAuthoringStills).toHaveBeenCalledTimes(rendersBeforeEditReview);
    await vi.waitFor(async () => expect(await manager.status(draft.id))
      .toMatchObject({ productionState: "still_review" }), { timeout: 5_000 });
    await manager.dispose();
  });

  it("removes the video workspace when the draft is removed", async () => {
    const { manager, root } = await managerForTest();
    const draft = await manager.createDraft("Xóa toàn bộ");
    await writeFile(join(root, draft.id, "assets", "research.txt"), "history");

    await manager.removeDraft(draft.id);
    expect(await manager.list()).toEqual([]);
  });

  it("starts one shared Harness, then adopts and selects a video workspace through the real RPC shape", async () => {
    const root = await mkdtemp(join(tmpdir(), "motionreal-agent-"));
    roots.push(root);
    const cli = join(root, "dsh.js");
    await writeFile(cli, "// test placeholder\n");
    await writeFile(join(root, "motionreal-tools.mjs"), "// test tool plugin\n");
    const child = Object.assign(new EventEmitter(), { kill: vi.fn() });
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fakeFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (!init?.method) return new Response("ok", { status: 200 });
      const method = JSON.parse(String(init.body)).method;
      const value = method === "workspace.create"
        ? { workspace: { workspaceId: "workspace-1" } }
        : {};
      return Response.json({ type: "server-response", result: { ok: true, value } });
    }) as unknown as typeof globalThis.fetch;
    const spawnChild = vi.fn(() => child) as unknown as typeof import("node:child_process").spawn;
    const manager = new HarnessManager({
      draftsRoot: root,
      harnessHome: join(root, "harness"),
      harnessCliPath: cli,
      submissionPluginPath: join(root, "motionreal-tools.mjs"),
      fetch: fakeFetch,
      findPort: async () => 39876,
      spawn: spawnChild,
      nodeExecutable: "C:\\Program Files\\nodejs\\node.exe",
    });
    const draft = await manager.createDraft("Video mới");
    const otherDraft = await manager.createDraft("Video khác");

    const opened = await manager.activate(draft.id, "only-child-env");
    const otherOpened = await manager.activate(otherDraft.id, "only-child-env");
    expect(opened.harnessUrl).toMatch(/^http:\/\/127\.0\.0\.1:39876\/\?session=session-/);
    expect(otherOpened.harnessUrl).toMatch(/^http:\/\/127\.0\.0\.1:39876\/\?session=session-/);
    expect(otherOpened.harnessUrl).not.toBe(opened.harnessUrl);
    expect(spawnChild).toHaveBeenCalledTimes(1);
    expect(calls.slice(1).map((call) => JSON.parse(String(call.init?.body)).method)).toEqual([
      "workspace.create",
      "workspace.rename",
      "session.create",
      "credentials.describe",
      "workspace.create",
      "workspace.rename",
      "session.create",
      "credentials.describe",
    ]);
    expect(JSON.parse(String(calls[2]?.init?.body)).payload).toEqual({ workspaceId: "workspace-1", title: "Video mới" });
    await manager.dispose();
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it("reuses the same preallocated session and shared process when a draft is reopened", async () => {
    const root = await mkdtemp(join(tmpdir(), "motionreal-agent-"));
    roots.push(root);
    const cli = join(root, "dsh.js");
    await writeFile(cli, "// test placeholder\n");
    await writeFile(join(root, "motionreal-tools.mjs"), "// test tool plugin\n");
    const child = Object.assign(new EventEmitter(), { kill: vi.fn() });
    const methods: string[] = [];
    const manager = new HarnessManager({
      draftsRoot: root,
      harnessHome: join(root, "harness"),
      harnessCliPath: cli,
      submissionPluginPath: join(root, "motionreal-tools.mjs"),
      findPort: async () => 39875,
      spawn: vi.fn(() => child) as unknown as typeof import("node:child_process").spawn,
      fetch: vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (!init?.method) return new Response("ok", { status: 200 });
        const method = JSON.parse(String(init.body)).method as string;
        methods.push(method);
        const value = method === "workspace.create"
          ? { workspace: { workspaceId: "workspace-1", sessionIds: ["old-session"] } }
          : {};
        return Response.json({ type: "server-response", result: { ok: true, value } });
      }) as unknown as typeof globalThis.fetch,
      nodeExecutable: "node",
    });
    const draft = await manager.createDraft("Giữ lịch sử");

    const first = await manager.activate(draft.id, "only-child-env");
    const second = await manager.activate(draft.id, "only-child-env");
    expect(second.harnessUrl).toBe(first.harnessUrl);
    expect(methods).toEqual([
      "host.describe",
      "workspace.create", "workspace.rename", "session.create", "credentials.describe",
      "workspace.create", "workspace.rename", "session.create", "credentials.describe",
    ]);
    await manager.dispose();
  });

  it("uses a real Node executable instead of Electron run-as-node", async () => {
    const root = await mkdtemp(join(tmpdir(), "motionreal-agent-"));
    roots.push(root);
    const cli = join(root, "dsh.js");
    await writeFile(cli, "// test placeholder\n");
    await writeFile(join(root, "motionreal-tools.mjs"), "// test tool plugin\n");
    const child = Object.assign(new EventEmitter(), { kill: vi.fn() });
    const spawnChild = vi.fn(() => child) as unknown as typeof import("node:child_process").spawn;
    const manager = new HarnessManager({
      draftsRoot: root,
      harnessHome: join(root, "harness"),
      harnessCliPath: cli,
      submissionPluginPath: join(root, "motionreal-tools.mjs"),
      nodeExecutable: "C:\\Program Files\\nodejs\\node.exe",
      findPort: async () => 39874,
      spawn: spawnChild,
      fetch: vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (!init?.method) return new Response("ok");
        const method = JSON.parse(String(init.body)).method as string;
        const value = method === "workspace.create"
          ? { workspace: { workspaceId: "workspace-1", sessionIds: ["old-session"] } }
          : {};
        return Response.json({ type: "server-response", result: { ok: true, value } });
      }) as unknown as typeof globalThis.fetch,
    });
    const draft = await manager.createDraft("Node thật");

    await manager.activate(draft.id, "internal-key");
    expect(spawnChild).toHaveBeenCalledWith(
      "C:\\Program Files\\nodejs\\node.exe",
      [cli, "web", "--patch", join(root, "harness", "motionreal-tools.patch.yml"), "--host", "127.0.0.1", "--port", "39874", "--no-open"],
      expect.objectContaining({
        cwd: root,
        stdio: ["ignore", "ignore", "pipe"],
        env: expect.objectContaining({
          NINEROUTER_API_KEY: "internal-key",
          DSH_PERMISSION_MODE: "danger-full-access",
          MOTIONREAL_AGENT_DRAFTS_ROOT: root,
        }),
      }),
    );
    await expect(readFile(join(root, "harness", "motionreal-tools.patch.yml"), "utf8"))
      .resolves.toMatch(/motionreal-submission-tools[\s\S]*file:\/\//);
    await expect(readFile(join(root, "harness", "settings.yaml"), "utf8"))
      .resolves.toMatch(/web-search-deepseek:[\s\S]*apiKeyEnv: DEEPSEEK_API_KEY/);
    const settings = await readFile(join(root, "harness", "settings.yaml"), "utf8");
    // The custom 9router model has no upstream catalog entry to inherit vision from.
    // Declare only this model, not a route-wide capability for unknown future models.
    expect(settings).toContain("        - id: ag/gemini-3.7-flash-high\n          input: [text, image]\n");
    expect(settings).not.toContain("defaultInput:");
    const options = vi.mocked(spawnChild).mock.calls[0]?.[2];
    expect(options?.env).not.toHaveProperty("ELECTRON_RUN_AS_NODE");
    await manager.dispose();
  });

  it("reports an early Harness dependency failure instead of waiting for a timeout", async () => {
    const root = await mkdtemp(join(tmpdir(), "motionreal-agent-"));
    roots.push(root);
    const cli = join(root, "dsh.js");
    await writeFile(cli, "// test placeholder\n");
    await writeFile(join(root, "motionreal-tools.mjs"), "// test tool plugin\n");
    const stderr = new EventEmitter();
    const child = Object.assign(new EventEmitter(), {
      stderr,
      stdout: new EventEmitter(),
      exitCode: null,
      kill: vi.fn(() => false),
    });
    const manager = new HarnessManager({
      draftsRoot: root,
      harnessHome: join(root, "harness"),
      harnessCliPath: cli,
      submissionPluginPath: join(root, "motionreal-tools.mjs"),
      nodeExecutable: "node",
      findPort: async () => 39873,
      spawn: vi.fn(() => {
        queueMicrotask(() => {
          stderr.emit("data", "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'example'");
          child.emit("close", 1, null);
        });
        return child;
      }) as unknown as typeof import("node:child_process").spawn,
      fetch: vi.fn(async () => { throw new Error("not listening"); }) as unknown as typeof globalThis.fetch,
    });
    const draft = await manager.createDraft("Runtime hỏng");

    const opening = manager.activate(draft.id, "internal-key");
    await expect(opening).rejects.toThrow(/thiếu dependency đã build/);
  });
});
