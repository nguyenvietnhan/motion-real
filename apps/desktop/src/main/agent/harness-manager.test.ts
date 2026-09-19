import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  artifactsForReviewChunk,
  AuthoringValidationError,
  HarnessManager,
  isCompatibleHarnessDescription,
  isRepairableAuthoringError,
  planReviewChunks,
  reviewNotesIssues,
  sameIds,
  type HarnessManagerDeps,
} from "./harness-manager.js";
import type { PlannedAuthoringContent } from "../authoring/content-plan.js";
import type { AuthorInput } from "./agent-worker.js";
import { encodePngRGBA, writeJson, type AuthoringReviewRequest, type ReviewArtifact } from "@motionreal/pipeline";

const roots: string[] = [];
const activeManagers: HarnessManager[] = [];
const heldCommits: Array<() => void> = [];

const TEST_CONTENT_PLAN = {
  title: "Kế hoạch thử nghiệm",
  presentationProfile: "mechanism-explainer" as const,
  viewerPromise: "Hiểu chủ đề",
  hookType: "question" as const,
  first3SecondsLine: "Điều gì đang xảy ra?",
  openLoop: "Câu trả lời ở phần cuối.",
  payoff: "Người xem hiểu điểm chính.",
  claims: [],
  scenes: [{
    sceneId: "scene-01",
    purpose: "hook" as const,
    beat: "Mở vấn đề",
    narration: "Điều gì đang xảy ra và vì sao nó đáng chú ý?",
    onScreenText: "Điều gì xảy ra?",
    visualMetaphor: "Một dấu hỏi mở ra",
    motionProgression: "Dấu hỏi hiện nhanh rồi giữ",
    layoutFamily: "signature-visual" as const,
    evidenceClaimIds: [],
  }],
};
const REVIEW_EVIDENCE_PNG = encodePngRGBA(1, 1, new Uint8Array([255, 255, 255, 255]));
const HARNESS_DESCRIPTION = {
  version: "0.1.0",
  cwd: "V:/Projects",
  attachedSessions: 0,
  home: "C:/Users/test/.dsh",
  canOpenPath: false,
};

describe("authoring error and exact-ID classification", () => {
  it("does not treat infrastructure messages mentioning authored files as AI-repairable", () => {
    expect(isRepairableAuthoringError(new Error("ENOENT: no such file, open project/manifest.json"))).toBe(false);
    expect(isRepairableAuthoringError(new Error("read_image RPC timed out while opening scene-01.tsx"))).toBe(false);
    expect(isRepairableAuthoringError(new AuthoringValidationError("scene-01 thiếu narration"))).toBe(true);
  });

  it("requires the pinned Harness host.describe response shape", () => {
    expect(isCompatibleHarnessDescription({})).toBe(false);
    expect(isCompatibleHarnessDescription(HARNESS_DESCRIPTION)).toBe(true);
  });

  it("rejects duplicate IDs that hide a missing reviewed scene or still", () => {
    expect(sameIds(["scene-01", "scene-01"], ["scene-01", "scene-02"])).toBe(false);
    expect(sameIds(["scene-02", "scene-01"], ["scene-01", "scene-02"])).toBe(true);
  });
});

const testPlanAuthoringContent: HarnessManagerDeps["planAuthoringContent"] = async () => ({
  contentPlan: TEST_CONTENT_PLAN,
  advisories: [],
});

function registeredSceneSource(id: string, version: string): string {
  return `import { registerComponent } from "@motionreal/compositions";
import { z } from "zod";
export const schema = z.object({});
export const example = {};
export default registerComponent({ id: "${id}", displayName: "${id}", schema, example,
  Component: () => <div>${version}</div> });\n`;
}

async function managerForTest(over: Partial<HarnessManagerDeps> = {}): Promise<{ manager: HarnessManager; root: string }> {
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
      ...over,
      planAuthoringContent: over.planAuthoringContent ?? testPlanAuthoringContent,
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
  calls: Array<{ method: string; payload: unknown; rpcId?: string }>;
  deps: HarnessManagerDeps;
  history: Array<{ event: { seq: number; type: string; data: Record<string, unknown> } }>;
}> {
  const root = await mkdtemp(join(tmpdir(), "motionreal-agent-active-"));
  roots.push(root);
  const cli = join(root, "dsh.js");
  await writeFile(cli, "// test placeholder\n");
  await writeFile(join(root, "motionreal-tools.mjs"), "// test tool plugin\n");
  const child = Object.assign(new EventEmitter(), { kill: vi.fn() });
  const calls: Array<{ method: string; payload: unknown; rpcId?: string }> = [];
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
      const body = JSON.parse(String(init?.body)) as { method: string; payload: unknown; rpcId?: string };
      calls.push(body);
      if (body.method === "credentials.set") searchConfigured = true;
      const value = body.method === "host.describe"
        ? HARNESS_DESCRIPTION
        : body.method === "workspace.create"
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
    planAuthoringContent: over.planAuthoringContent ?? testPlanAuthoringContent,
  };
  const manager = new HarnessManager(deps);
  activeManagers.push(manager);
  return { manager, root, calls, deps, history };
}

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function prepareLinkedAuthoringDraft(
  manager: HarnessManager,
  root: string,
  jobId: string,
  projectId: string,
): Promise<{ draftId: string; draftRoot: string; projectRoot: string }> {
  const draft = await manager.createDraft("Agent content plan");
  await manager.activate(draft.id, "internal-key");
  let state = await manager.transitionWorkflow(draft.id, { expectedRevision: 0, to: "collecting_assets", jobId });
  state = await manager.transitionWorkflow(draft.id, { expectedRevision: state.workflowRevision, to: "asset_review", jobId });
  state = await manager.transitionWorkflow(draft.id, { expectedRevision: state.workflowRevision, to: "brief_review", jobId });
  await manager.transitionWorkflow(draft.id, { expectedRevision: state.workflowRevision, to: "queued_create", jobId });
  const draftRoot = join(root, draft.id);
  const metadataPath = join(draftRoot, "motionreal-agent.json");
  await writeFile(metadataPath, JSON.stringify({ ...JSON.parse(await readFile(metadataPath, "utf8")), briefRequestRevision: 1 }));
  await mkdir(join(draftRoot, "handoff"), { recursive: true });
  await writeFile(join(draftRoot, "handoff", "brief.json"), JSON.stringify({
    version: 1, accepted: true, job_id: jobId, request_revision: 1, brief_revision: 1,
    title: "Agent content plan", prompt: "Giải thích chủ đề bằng một mạch kể rõ ràng và có điểm kết luận hữu ích.",
    format: "tiktok", duration_tier: 2, target_seconds: 90, video_language: "vi", voice_provider: "vivibe", selected_asset_ids: [],
  }));
  await writeFile(join(draftRoot, "handoff", "assets.json"), JSON.stringify({ items: [] }));
  await manager.linkProject(draft.id, projectId);
  const projectRoot = join(root, "projects", projectId);
  await mkdir(join(projectRoot, "authored"), { recursive: true });
  return { draftId: draft.id, draftRoot, projectRoot };
}

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
      planAuthoringContent: testPlanAuthoringContent,
    });
    const draft = await manager.createDraft("Missing tools");

    await expect(manager.activate(draft.id, "internal-key")).rejects.toThrow(/Chưa build tool submission/);
  });

  it("stops an incompatible Harness runtime before creating a workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "motionreal-agent-incompatible-"));
    roots.push(root);
    const cli = join(root, "dsh.js");
    const plugin = join(root, "motionreal-tools.mjs");
    await writeFile(cli, "// test placeholder\n");
    await writeFile(plugin, "// test tool plugin\n");
    const child = Object.assign(new EventEmitter(), { kill: vi.fn(() => true) });
    const fetch = vi.fn(async () => Response.json({
      type: "server-response",
      result: { ok: true, value: { version: "unknown" } },
    })) as unknown as typeof globalThis.fetch;
    const manager = new HarnessManager({
      draftsRoot: root,
      harnessHome: join(root, "harness"),
      harnessCliPath: cli,
      submissionPluginPath: plugin,
      planAuthoringContent: testPlanAuthoringContent,
      findPort: async () => 39870,
      spawn: vi.fn(() => child) as unknown as typeof import("node:child_process").spawn,
      fetch,
    });
    const draft = await manager.createDraft("Incompatible runtime");

    await expect(manager.activate(draft.id, "internal-key")).rejects.toThrow(/protocol.*không tương thích/i);
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
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

  it("uses metadata mtime for updatedAt, sorts recent drafts first and renames metadata only", async () => {
    const { manager, root } = await managerForTest();
    const older = await manager.createDraft("Cũ");
    await new Promise((resolve) => setTimeout(resolve, 10));
    const newer = await manager.createDraft("Mới");

    const listed = await manager.list();
    expect(listed.map((draft) => draft.id)).toEqual([newer.id, older.id]);
    expect(Date.parse(listed[0]!.updatedAt)).toBeGreaterThanOrEqual(Date.parse(listed[1]!.updatedAt));

    const renamed = await manager.renameDraft(older.id, "  Tên đã đổi  ");
    expect(renamed.title).toBe("Tên đã đổi");
    expect(Date.parse(renamed.updatedAt)).toBeGreaterThanOrEqual(Date.parse(older.updatedAt));
    await expect(readFile(join(root, older.id, "motionreal-agent.json"), "utf8"))
      .resolves.toContain('"title": "Tên đã đổi"');
    await expect(manager.renameDraft(older.id, "   ")).rejects.toThrow(/đặt tên/);
  });

  it("persists workflow transitions and opens legacy records in discovery", async () => {
    const { manager, root } = await managerForTest();
    const draft = await manager.createDraft("Workflow bền vững");

    expect(draft).toMatchObject({
      workflowVersion: 2,
      workflowRevision: 0,
      productionState: "discovery",
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
      planAuthoringContent: testPlanAuthoringContent,
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
      workflowVersion: 2,
      workflowRevision: 0,
      productionState: "discovery",
    });
  });

  it("prompts the active Harness session and advances a valid asset manifest to review", async () => {
    const { manager, root, calls } = await activeManagerForTest();
    const draft = await manager.createDraft("Asset thật");
    await manager.activate(draft.id, "internal-key");
    const collecting = await manager.prepareAssets(draft.id, draft.workflowRevision);
    const draftRoot = join(root, draft.id);
    const assetRequest = JSON.parse(await readFile(join(draftRoot, "handoff", "assets-request.json"), "utf8"));
    expect(assetRequest.note).toContain("chủ đề nội dung cụ thể gần nhất");
    expect(assetRequest.instructions.join(" ")).toMatch(/URL\/paper mới nhất/);
    expect(assetRequest.instructions.join(" ")).toMatch(/không trộn hoặc quay lại chủ đề cũ/);
    expect(assetRequest.instructions.join(" ")).toMatch(/ask_user_question/);
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
    expect(calls.some((call) => call.method === "session.prompt"
      && (call.payload as { sessionId?: unknown; mode?: unknown }).mode === "queue"
      && /^session-/.test(String((call.payload as { sessionId?: unknown }).sessionId)))).toBe(true);

    const approved = await manager.approveAssets(draft.id, review.workflowRevision, ["asset-01"]);
    expect(approved).toMatchObject({ productionState: "preparing_brief", selectedAssetIds: ["asset-01"] });
    await manager.dispose();
  });

  it("cancels the native Harness turn, persists a clean resume, and keeps the draft readable", async () => {
    const { manager, calls } = await activeManagerForTest();
    const draft = await manager.createDraft("Dừng workflow");
    await manager.activate(draft.id, "internal-key");
    const collecting = await manager.prepareAssets(draft.id, draft.workflowRevision);

    const paused = await manager.pauseWorkflow(draft.id, collecting.workflowRevision);

    expect(paused).toMatchObject({
      productionState: "paused",
      pausedFrom: "collecting_assets",
      workflowRevision: 2,
    });
    expect(calls).toContainEqual(expect.objectContaining({
      method: "session.cancel",
      payload: { sessionId: expect.stringMatching(/^session-/) },
    }));
    await expect(manager.status(draft.id)).resolves.toMatchObject({ productionState: "paused" });

    const resumed = await manager.resumeWorkflow(draft.id, paused.workflowRevision);
    expect(resumed).toMatchObject({ productionState: "collecting_assets", workflowRevision: 3 });
    const reloaded = await manager.status(draft.id);
    expect(reloaded).toMatchObject({
      productionState: "collecting_assets",
      workflowRevision: 3,
    });
    expect(reloaded).not.toHaveProperty("pausedFrom");
    await expect(manager.list()).resolves.toEqual([
      expect.objectContaining({ id: draft.id, productionState: "collecting_assets" }),
    ]);
    expect(calls.some((call) => call.method === "session.prompt")).toBe(true);
  });

  it("repairs only the legacy pause residue left on an otherwise valid resumed workflow", async () => {
    const { manager, root } = await activeManagerForTest();
    const draft = await manager.createDraft("Khôi phục phiên đã resume");
    await manager.activate(draft.id, "internal-key");
    const collecting = await manager.prepareAssets(draft.id, draft.workflowRevision);
    const paused = await manager.pauseWorkflow(draft.id, collecting.workflowRevision);
    const metadataPath = join(root, draft.id, "motionreal-agent.json");
    const corrupt = JSON.parse(await readFile(metadataPath, "utf8")) as Record<string, unknown>;
    await writeFile(metadataPath, JSON.stringify({
      ...corrupt,
      workflowRevision: paused.workflowRevision + 1,
      productionState: "collecting_assets",
    }));

    const reloaded = await manager.status(draft.id);
    expect(reloaded).toMatchObject({
      productionState: "collecting_assets",
      workflowRevision: 3,
    });
    expect(reloaded).not.toHaveProperty("pausedFrom");
    expect(JSON.parse(await readFile(metadataPath, "utf8"))).not.toHaveProperty("pausedFrom");
  });

  it("repairs legacy pause residue for every pausable automated state only", async () => {
    const { manager, root } = await activeManagerForTest();
    const draft = await manager.createDraft("Khôi phục tất cả trạng thái dừng");
    await manager.activate(draft.id, "internal-key");
    const metadataPath = join(root, draft.id, "motionreal-agent.json");
    const baseline = JSON.parse(await readFile(metadataPath, "utf8")) as Record<string, unknown>;
    const states = ["collecting_assets", "preparing_brief", "authoring", "visual_refine"] as const;

    for (const productionState of states) {
      await writeFile(metadataPath, JSON.stringify({
        ...baseline,
        id: draft.id,
        title: draft.title,
        createdAt: draft.createdAt,
        workflowVersion: 2,
        workflowRevision: 1,
        productionState,
        activeJobId: "job-legacy",
        pausedFrom: productionState,
      }));

      await expect(manager.status(draft.id)).resolves.toMatchObject({ productionState, workflowRevision: 1 });
      await expect(readFile(metadataPath, "utf8")).resolves.not.toContain("pausedFrom");
    }
  });

  it("projects only allow-listed native tool activity without command or provider output", async () => {
    const { manager, history } = await activeManagerForTest();
    const draft = await manager.createDraft("Timeline an toàn");
    await manager.activate(draft.id, "internal-key");
    history.push({ event: { seq: 1, type: "tool/call", data: {
      callId: "call-search", name: "web_search", arguments: "secret query must not cross IPC",
    } } });
    history.push({ event: { seq: 2, type: "tool/result", data: {
      callId: "call-search", error: "raw provider failure must not cross IPC",
    } } });

    const status = await manager.status(draft.id, { includeActivities: true });

    expect(status.activities).toEqual([{ id: "1", label: "Tìm kiếm web", status: "failed" }]);
    expect(JSON.stringify(status.activities)).not.toContain("secret query");
    expect(JSON.stringify(status.activities)).not.toContain("provider failure");
  });

  it("marks nested native tool results as completed", async () => {
    const { manager, history } = await activeManagerForTest();
    const draft = await manager.createDraft("Kết quả tool native");
    await manager.activate(draft.id, "internal-key");
    history.push({ event: { seq: 1, type: "tool/call", data: { callId: "call-image", name: "read_image" } } });
    history.push({ event: { seq: 2, type: "tool/result", data: {
      message: {
        source: { kind: "tool", callId: "call-image" },
        content: [{ type: "tool-result", toolCallId: "call-image", isError: false }],
      },
    } } });

    await expect(manager.status(draft.id, { includeActivities: true })).resolves.toMatchObject({
      activities: [{ id: "1", label: "Đang xem ảnh", status: "completed" }],
    });
  });

  it("keeps attention visible until every native question and approval is resolved", async () => {
    const { manager, history } = await activeManagerForTest();
    const draft = await manager.createDraft("Nhiều tương tác đang chờ");
    await manager.activate(draft.id, "internal-key");
    history.push(
      { event: { seq: 1, type: "tool/call", data: { callId: "ask-a", name: "ask_user_question" } } },
      { event: { seq: 2, type: "tool/call", data: { callId: "ask-b", name: "ask_user_question" } } },
      { event: { seq: 3, type: "approval/asked", data: { id: "approval-a", toolName: "bash" } } },
      { event: { seq: 4, type: "tool/result", data: { callId: "ask-a" } } },
      { event: { seq: 5, type: "approval/decided", data: { id: "approval-a", outcome: "allowed-once" } } },
    );

    await expect(manager.status(draft.id, { includeActivities: true })).resolves.toMatchObject({ needsAttention: true });

    history.push({ event: { seq: 6, type: "tool/result", data: { callId: "ask-b" } } });
    expect((await manager.status(draft.id, { includeActivities: true })).needsAttention).toBeUndefined();
  });

  it("continues an incomplete asset turn twice, deduplicates polling, and preserves downloaded assets", async () => {
    const { manager, root, calls, history } = await activeManagerForTest();
    const draft = await manager.createDraft("Thiếu manifest");
    await manager.activate(draft.id, "internal-key");
    const collecting = await manager.prepareAssets(draft.id, draft.workflowRevision);
    const firstPrompt = calls.filter((call) => call.method === "session.prompt").at(-1);
    expect(firstPrompt?.rpcId).toMatch(/^[0-9a-f-]{36}$/i);
    await writeFile(join(root, draft.id, "assets", "kept.jpg"), ONE_PIXEL_PNG);
    history.push({ event: { seq: 1, type: "turn/start", data: { turn: 4 } } });
    history.push({ event: { seq: 2, type: "user/message", data: { source: { rpcId: firstPrompt?.rpcId } } } });
    history.push({ event: { seq: 3, type: "turn/end", data: { turn: 4, reason: { kind: "completed" } } } });

    const continued = await Promise.all(Array.from({ length: 3 }, () => manager.status(draft.id, { includeActivities: true })));
    expect(continued.every((state) => state.productionState === "collecting_assets")).toBe(true);
    expect(calls.filter((call) => call.method === "session.prompt")).toHaveLength(2);
    // Each newly completed continuation spends one attempt; replaying old history does not.
    for (const turn of [5, 6]) {
      const prompt = calls.filter((call) => call.method === "session.prompt").at(-1);
      history.push(
        { event: { seq: turn * 3, type: "turn/start", data: { turn } } },
        { event: { seq: turn * 3 + 1, type: "user/message", data: { source: { rpcId: prompt?.rpcId } } } },
        { event: { seq: turn * 3 + 2, type: "turn/end", data: { turn, reason: { kind: "completed" } } } },
      );
      await manager.status(draft.id, { includeActivities: true });
    }
    const failed = await manager.status(draft.id, { includeActivities: true });
    expect(calls.filter((call) => call.method === "session.prompt")).toHaveLength(3);
    expect(failed).toMatchObject({
      productionState: "error",
      failedPhase: "collecting_assets",
      activeJobId: collecting.activeJobId,
      lastError: expect.stringMatching(/chưa gửi manifest asset/i),
    });
    await expect(readFile(join(root, draft.id, "assets", "kept.jpg"))).resolves.toEqual(ONE_PIXEL_PNG);

    const retried = await manager.retryWorkflow(draft.id, failed.workflowRevision);
    const retryPrompt = calls.filter((call) => call.method === "session.prompt").at(-1);
    expect(retried).toMatchObject({ productionState: "collecting_assets", activeJobId: collecting.activeJobId });
    expect(retryPrompt?.rpcId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(retryPrompt?.rpcId).not.toBe(firstPrompt?.rpcId);
  });

  it("recovers a pre-marker asset draft when its native submission turn has already completed", async () => {
    const { manager, root, calls, history } = await activeManagerForTest();
    const draft = await manager.createDraft("Khôi phục draft cũ");
    await manager.activate(draft.id, "internal-key");
    await manager.prepareAssets(draft.id, draft.workflowRevision);
    const prompt = calls.filter((call) => call.method === "session.prompt").at(-1);
    const metadataPath = join(root, draft.id, "motionreal-agent.json");
    const legacy = JSON.parse(await readFile(metadataPath, "utf8")) as Record<string, unknown>;
    delete legacy.awaitingArtifactPromptId;
    await writeFile(metadataPath, JSON.stringify(legacy));
    history.push({ event: { seq: 1, type: "turn/start", data: { turn: 6 } } });
    history.push({ event: { seq: 2, type: "user/message", data: {
      message: { source: { kind: "rpc", rpcId: prompt?.rpcId }, content: [{ type: "text", text: "Hãy gọi motionreal_submit_assets." }] },
    } } });
    history.push({ event: { seq: 3, type: "turn/end", data: { turn: 6, reason: { kind: "completed" } } } });

    await expect(manager.status(draft.id, { includeActivities: true })).resolves.toMatchObject({
      productionState: "collecting_assets",
    });
  });

  it("continues incomplete authoring without replanning or replacing authored files", async () => {
    const { manager, root, calls, history } = await activeManagerForTest();
    const prepared = await prepareLinkedAuthoringDraft(manager, root, "job-missing-authoring", "project-missing-authoring");
    await manager.startAuthoring(prepared.draftId, "project-missing-authoring", prepared.projectRoot, []);
    await writeFile(join(prepared.projectRoot, "authored", "kept.tsx"), "// partial scene");
    const prompt = calls.filter((call) => call.method === "session.prompt").at(-1);
    history.push({ event: { seq: 1, type: "turn/start", data: { turn: 8 } } });
    history.push({ event: { seq: 2, type: "user/message", data: { source: { rpcId: prompt?.rpcId } } } });
    history.push({ event: { seq: 3, type: "turn/end", data: { turn: 8, reason: { kind: "completed" } } } });

    await expect(manager.status(prepared.draftId, { includeActivities: true })).resolves.toMatchObject({
      productionState: "authoring",
      projectId: "project-missing-authoring",
    });
    expect(calls.filter((call) => call.method === "session.prompt")).toHaveLength(2);
    await expect(readFile(join(prepared.projectRoot, "authored", "kept.tsx"), "utf8")).resolves.toBe("// partial scene");
  });

  it.each(["question", "approval"])("never auto-continues while a %s is pending", async (kind) => {
    const { manager, calls, history } = await activeManagerForTest();
    const draft = await manager.createDraft("Chờ người dùng");
    await manager.activate(draft.id, "internal-key");
    await manager.prepareAssets(draft.id, 0);
    const prompt = calls.filter((call) => call.method === "session.prompt").at(-1);
    history.push(
      { event: { seq: 1, type: "turn/start", data: { turn: 1 } } },
      { event: { seq: 2, type: "user/message", data: { source: { rpcId: prompt?.rpcId } } } },
      { event: { seq: 3, type: kind === "question" ? "tool/call" : "approval/asked", data: { callId: "ask", name: "ask_user_question", id: "approval" } } },
      { event: { seq: 4, type: "turn/end", data: { turn: 1, reason: { kind: "completed" } } } },
    );
    await expect(manager.status(draft.id, { includeActivities: true })).resolves.toMatchObject({ productionState: "collecting_assets", needsAttention: true });
    expect(calls.filter((call) => call.method === "session.prompt")).toHaveLength(1);
  });

  it.each([
    { reason: { kind: "aborted", reason: { kind: "user" } }, state: "paused", message: undefined },
    { reason: { kind: "blocked" }, state: "collecting_assets", message: undefined },
    { reason: { kind: "error", error: { code: "TRANSPORT", message: "secret provider payload" } }, state: "error", message: /kết nối/i },
    { reason: { kind: "error", error: { code: "UNKNOWN", message: "secret provider payload" } }, state: "error", message: /Harness/i },
    { reason: { kind: "max-tokens" }, state: "collecting_assets", message: undefined },
  ])("routes native termination $reason.kind without treating it as missing code", async ({ reason, state, message }) => {
    const { manager, calls, history } = await activeManagerForTest();
    const draft = await manager.createDraft("Phân loại kết thúc");
    await manager.activate(draft.id, "internal-key");
    await manager.prepareAssets(draft.id, 0);
    const prompt = calls.filter((call) => call.method === "session.prompt").at(-1);
    history.push(
      { event: { seq: 1, type: "turn/start", data: { turn: 1 } } },
      { event: { seq: 2, type: "user/message", data: { source: { rpcId: prompt?.rpcId } } } },
      { event: { seq: 3, type: "turn/end", data: { turn: 1, reason } } },
    );
    const result = await manager.status(draft.id, { includeActivities: true });
    expect(result.productionState).toBe(state);
    if (message) expect(result.lastError).toMatch(message);
    expect(JSON.stringify(result)).not.toContain("secret provider payload");
    expect(calls.filter((call) => call.method === "session.prompt")).toHaveLength(reason.kind === "max-tokens" ? 2 : 1);
  });

  it("reads native activity only when the caller explicitly requests it", async () => {
    const { manager, calls } = await activeManagerForTest();
    const draft = await manager.createDraft("Không poll history khi chat native đang mở");
    await manager.activate(draft.id, "internal-key");

    await manager.status(draft.id, { includeActivities: false });
    expect(calls.some((call) => call.method === "session.history")).toBe(false);

    await manager.status(draft.id, { includeActivities: true });
    expect(calls.some((call) => call.method === "session.history")).toBe(true);
  });

  it("resumes pending authoring when a second draft joins an existing runtime", async () => {
    const { manager, root, calls } = await activeManagerForTest();
    const first = await manager.createDraft("Đã mở runtime");
    await manager.activate(first.id, "internal-key");
    const second = await manager.createDraft("Cần tiếp tục authoring");
    const secondRoot = join(root, second.id);
    const metadataPath = join(secondRoot, "motionreal-agent.json");
    await writeFile(metadataPath, JSON.stringify({
      ...JSON.parse(await readFile(metadataPath, "utf8")),
      workflowRevision: 1,
      productionState: "authoring",
      activeJobId: "job-second-draft",
      projectId: "project-second-draft",
    }));
    await mkdir(join(secondRoot, "handoff"), { recursive: true });
    await writeFile(join(secondRoot, "handoff", "authoring-request.json"), JSON.stringify({ version: 1 }));
    const promptsBefore = calls.filter((call) => call.method === "session.prompt").length;

    await manager.activate(second.id, "internal-key");

    expect(calls.filter((call) => call.method === "session.prompt")).toHaveLength(promptsBefore + 1);
    await manager.activate(second.id, "internal-key");
    expect(calls.filter((call) => call.method === "session.prompt")).toHaveLength(promptsBefore + 1);
  });

  it("keeps automated activity visible after another draft becomes the iframe", async () => {
    const { manager, history } = await activeManagerForTest();
    const first = await manager.createDraft("Video đang chạy nền");
    await manager.activate(first.id, "internal-key");
    history.push({ event: { seq: 1, type: "tool/call", data: { callId: "asset-call", name: "glob" } } });

    const second = await manager.createDraft("Video đang mở");
    await manager.activate(second.id, "internal-key");

    await expect(manager.status(first.id, { includeActivities: true })).resolves.toMatchObject({
      activities: [{ id: "1", label: "Đang đọc workspace", status: "running" }],
    });
  });

  it("persists pause and returns when a native cancel RPC hangs", async () => {
    const localCancel = vi.fn();
    let blockCancel = false;
    const { manager, root } = await activeManagerForTest({
      cancelAuthoringStills: localCancel,
      cancelRpcTimeoutMs: 15,
      fetch: vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { method: string; payload: unknown };
        if (blockCancel && body.method === "session.cancel") return new Promise<Response>(() => {});
        const value = body.method === "host.describe"
          ? HARNESS_DESCRIPTION
          : body.method === "workspace.create"
          ? { workspace: { workspaceId: "workspace-assets" } }
          : body.method === "credentials.describe"
            ? { credentials: { DEEPSEEK_API_KEY: { configured: false, writable: true } } }
            : {};
        return Response.json({ type: "server-response", result: { ok: true, value } });
      }) as unknown as typeof globalThis.fetch,
    });
    const draft = await manager.createDraft("Dừng RPC treo");
    await manager.activate(draft.id, "internal-key");
    await manager.prepareAssets(draft.id, draft.workflowRevision);
    const metadataPath = join(root, draft.id, "motionreal-agent.json");
    await writeFile(metadataPath, JSON.stringify({
      ...JSON.parse(await readFile(metadataPath, "utf8")),
      projectId: "project-live",
    }));
    const live = await manager.status(draft.id);
    blockCancel = true;

    const paused = await manager.pauseWorkflow(draft.id, live.workflowRevision);

    expect(paused.productionState).toBe("paused");
    expect(localCancel).toHaveBeenCalledWith("project-live");
    await expect(manager.status(draft.id)).resolves.toMatchObject({ productionState: "paused" });
  });

  it("does not issue a late authoring repair after the workflow was paused", async () => {
    const { manager, calls } = await activeManagerForTest();
    const draft = await manager.createDraft("Chặn repair muộn");
    await manager.activate(draft.id, "internal-key");
    let current = await manager.transitionWorkflow(draft.id, {
      expectedRevision: 0, to: "collecting_assets", jobId: "job-stop",
    });
    current = await manager.transitionWorkflow(draft.id, {
      expectedRevision: current.workflowRevision, to: "asset_review", jobId: "job-stop",
    });
    current = await manager.transitionWorkflow(draft.id, {
      expectedRevision: current.workflowRevision, to: "brief_review", jobId: "job-stop",
    });
    current = await manager.transitionWorkflow(draft.id, {
      expectedRevision: current.workflowRevision, to: "queued_create", jobId: "job-stop",
    });
    const authoring = await manager.transitionWorkflow(draft.id, {
      expectedRevision: current.workflowRevision, to: "authoring", jobId: "job-stop",
    });
    await manager.pauseWorkflow(draft.id, authoring.workflowRevision);
    const promptCount = calls.filter((call) => call.method === "session.prompt").length;
    const internal = manager as unknown as {
      requestAuthoringRepair(record: { id: string }, message: string): Promise<void>;
    };

    await internal.requestAuthoringRepair(authoring, "validation failed");

    expect(calls.filter((call) => call.method === "session.prompt")).toHaveLength(promptCount);
  });

  it("resumes an outstanding authoring request after the Harness runtime restarts", async () => {
    const { manager, root, calls } = await activeManagerForTest();
    const draft = await manager.createDraft("Khôi phục authoring");
    await manager.activate(draft.id, "internal-key");
    let state = await manager.transitionWorkflow(draft.id, { expectedRevision: 0, to: "collecting_assets", jobId: "job-resume" });
    state = await manager.transitionWorkflow(draft.id, { expectedRevision: state.workflowRevision, to: "asset_review", jobId: "job-resume" });
    state = await manager.transitionWorkflow(draft.id, { expectedRevision: state.workflowRevision, to: "brief_review", jobId: "job-resume" });
    state = await manager.transitionWorkflow(draft.id, { expectedRevision: state.workflowRevision, to: "queued_create", jobId: "job-resume" });
    await manager.transitionWorkflow(draft.id, { expectedRevision: state.workflowRevision, to: "authoring", jobId: "job-resume" });
    await mkdir(join(root, draft.id, "handoff"), { recursive: true });
    await writeFile(join(root, draft.id, "handoff", "authoring-request.json"), JSON.stringify({ version: 1, phase: "repair" }));
    const promptsBeforeRestart = calls.filter((call) => call.method === "session.prompt").length;

    await manager.dispose();
    await manager.activate(draft.id, "internal-key");

    const prompts = calls.filter((call) => call.method === "session.prompt");
    expect(prompts).toHaveLength(promptsBeforeRestart + 1);
    expect(prompts.at(-1)).toMatchObject({
      payload: expect.objectContaining({
        content: [expect.objectContaining({ text: expect.stringContaining("authoring-request.json hiện tại") })],
      }),
    });
  });

  it("persists a bounded authoring repair budget instead of prompting the provider forever", async () => {
    const { manager, root, calls } = await activeManagerForTest({ maxAuthoringRepairs: () => 1 });
    const draft = await manager.createDraft("Giới hạn sửa cảnh");
    await manager.activate(draft.id, "internal-key");
    let state = await manager.transitionWorkflow(draft.id, { expectedRevision: 0, to: "collecting_assets", jobId: "job-repair" });
    state = await manager.transitionWorkflow(draft.id, { expectedRevision: state.workflowRevision, to: "asset_review", jobId: "job-repair" });
    state = await manager.transitionWorkflow(draft.id, { expectedRevision: state.workflowRevision, to: "brief_review", jobId: "job-repair" });
    state = await manager.transitionWorkflow(draft.id, { expectedRevision: state.workflowRevision, to: "queued_create", jobId: "job-repair" });
    state = await manager.transitionWorkflow(draft.id, { expectedRevision: state.workflowRevision, to: "authoring", jobId: "job-repair" });
    const rootOfDraft = join(root, draft.id);
    const metadataPath = join(rootOfDraft, "motionreal-agent.json");
    await mkdir(join(rootOfDraft, "handoff"), { recursive: true });
    await writeFile(metadataPath, JSON.stringify({
      ...JSON.parse(await readFile(metadataPath, "utf8")),
      projectId: "project-repair",
      briefRequestRevision: 1,
      authoringRequestRevision: 1,
    }));
    await writeFile(join(rootOfDraft, "handoff", "brief.json"), JSON.stringify({
      version: 1, job_id: "job-repair", request_revision: 1, brief_revision: 1,
      title: "Repair", prompt: "Nội dung đủ dài để kiểm thử giới hạn repair của Agent.", format: "tiktok",
      duration_tier: 2, video_language: "vi", voice_provider: "vieneu", selected_asset_ids: [], accepted: true,
    }));
    await writeFile(join(rootOfDraft, "handoff", "authoring-request.json"), JSON.stringify({
      version: 1, job_id: "job-repair", request_revision: 1, phase: "initial",
    }));
    const internal = manager as unknown as {
      requestAuthoringRepair(record: object, message: string): Promise<void>;
    };
    const first = await manager.status(draft.id);
    await internal.requestAuthoringRepair(first, "Scene thiếu transition.");
    const promptCount = calls.filter((call) => call.method === "session.prompt").length;
    const second = await manager.status(draft.id);
    await internal.requestAuthoringRepair(second, "Scene vẫn thiếu transition.");

    expect(calls.filter((call) => call.method === "session.prompt")).toHaveLength(promptCount);
    await expect(manager.status(draft.id)).resolves.toMatchObject({
      productionState: "error",
      lastError: expect.stringContaining("đã thử sửa"),
    });
    const failed = await manager.status(draft.id);
    const retried = await manager.retryWorkflow(draft.id, failed.workflowRevision);
    expect(retried).toMatchObject({ productionState: "authoring" });
    expect(calls.filter((call) => call.method === "session.prompt")).toHaveLength(promptCount + 1);
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

  it("projects model and access settings, validates options, then uses native Harness RPC", async () => {
    const setup = await activeManagerForTest();
    const { manager, calls } = setup;
    const fetch = vi.mocked(setup.deps.fetch!);
    const original = fetch.getMockImplementation()!;
    fetch.mockImplementation(async (input, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) as { method: string } : null;
      if (body?.method === "session.models") {
        calls.push(JSON.parse(String(init!.body)));
        return Response.json({ type: "server-response", result: { ok: true, value: {
          current: { provider: "ag", model: "gemini-current" },
          routable: true,
          groups: [{ id: "ag", name: "9router", models: [
            { id: "gemini-current", name: "Gemini Current" },
            { id: "gemini-next", name: "Gemini Next" },
          ] }],
          failures: [],
        } } });
      }
      if (body?.method === "session.history") {
        calls.push(JSON.parse(String(init!.body)));
        return Response.json({ type: "server-response", result: { ok: true, value: {
          events: [],
          hasMore: false,
          projections: { asOfSeq: 3, values: { permissions: {
            currentValue: "workspace-write",
            options: [
              { value: "workspace-write", name: "Workspace write", description: "Ghi trong workspace" },
              { value: "danger-full-access", name: "Full access", description: "Toàn quyền" },
            ],
          } } },
        } } });
      }
      return original(input, init);
    });
    const draft = await manager.createDraft("Settings");
    await manager.activate(draft.id, "internal-key");

    const settings = await manager.settings(draft.id);
    expect(settings).toMatchObject({
      searchProvider: "deepseek",
      webSearchConfigured: false,
    });
    expect(settings.modelOptions).toEqual([
      expect.objectContaining({ label: "Gemini Current" }),
      expect.objectContaining({ label: "Gemini Next" }),
    ]);
    expect(settings.currentModelId).toBe(settings.modelOptions[0]!.id);

    await manager.selectModel(draft.id, settings.modelOptions[1]!.id);
    expect([...calls].reverse().find((call) => call.method === "session.selectModel")).toMatchObject({
      payload: { provider: "ag", model: "gemini-next" },
    });
    await expect(manager.selectModel(draft.id, "not-in-catalog")).rejects.toThrow(/model/i);

  });

  it("changes search only on restart, resumes the same session and preserves DeepSeek credentials", async () => {
    const { manager, root, deps, calls } = await activeManagerForTest();
    const draft = await manager.createDraft("Search provider selection");
    const opened = await manager.activate(draft.id, "internal-key");
    const sessionId = JSON.parse(await readFile(join(root, draft.id, "motionreal-agent.json"), "utf8")).sessionId;
    expect(opened.searchProvider).toBe("deepseek");
    await manager.setSearchApiKey(draft.id, "deepseek-search-secret");
    await manager.setSearchProvider(draft.id, "exa");

    expect((await manager.status(draft.id)).searchProvider).toBe("deepseek");
    expect(deps.spawn).toHaveBeenCalledTimes(1);
    await expect(readFile(join(root, draft.id, "motionreal-agent.json"), "utf8")).resolves.not.toContain("searchProvider");
    await manager.dispose();

    const resumed = new HarnessManager(deps);
    activeManagers.push(resumed);
    expect(await resumed.activate(draft.id, "internal-key")).toMatchObject({ searchProvider: "exa", webSearchConfigured: true });
    expect(calls.filter((call) => call.method === "session.create").at(-1)).toMatchObject({ payload: { sessionId } });
    const patch = await readFile(join(deps.harnessHome, "motionreal-tools.patch.yml"), "utf8");
    expect(patch).toContain("exa:");
    expect(patch).toContain(JSON.stringify(deps.harnessCliPath));
    expect(patch).not.toContain("deepseek-search-secret");
    expect(patch).not.toContain("headers:");

    await resumed.setSearchProvider(draft.id, "deepseek");
    await resumed.dispose();
    expect(await resumed.activate(draft.id, "internal-key")).toMatchObject({ searchProvider: "deepseek", webSearchConfigured: true });
    expect(await readFile(join(deps.harnessHome, "motionreal-tools.patch.yml"), "utf8")).not.toContain("exa:");
    expect(calls.filter((call) => call.method === "credentials.set")).toHaveLength(1);
  });

  it("rejects unknown search providers without changing the saved choice", async () => {
    const { manager, deps } = await activeManagerForTest();
    const draft = await manager.createDraft("Search validation");
    await manager.activate(draft.id, "internal-key");
    await manager.setSearchProvider(draft.id, "exa");
    await expect(manager.setSearchProvider(draft.id, "https://untrusted.example")).rejects.toThrow(/không hợp lệ/);
    await expect(manager.setSearchProvider(draft.id, { provider: "exa" })).rejects.toThrow(/không hợp lệ/);
    expect(JSON.parse(await readFile(join(deps.harnessHome, "motionreal-search.json"), "utf8"))).toEqual({ provider: "exa" });
  });

  it.each(['{"provider":"unknown"}', '{"provider":', 'null'])("blocks malformed search config instead of silently choosing another provider: %s", async (contents) => {
    const { manager, deps } = await activeManagerForTest();
    await mkdir(deps.harnessHome, { recursive: true });
    await writeFile(join(deps.harnessHome, "motionreal-search.json"), contents);
    await expect(manager.start("internal-key")).rejects.toThrow(/Cấu hình dịch vụ tìm kiếm/);
    expect(deps.spawn).not.toHaveBeenCalled();
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
      planAuthoringContent: testPlanAuthoringContent,
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
    expect(waiting).toMatchObject({ productionState: "preparing_brief", workflowRevision: 3 });
    expect(calls.at(-1)).toMatchObject({ method: "session.prompt" });
    const request = JSON.parse(await readFile(join(draftRoot, "handoff", "brief-request.json"), "utf8"));
    expect(request).toMatchObject({
      job_id: collecting.activeJobId,
      request_revision: 1,
      selected_asset_ids: ["asset-01"],
    });
    expect(request).not.toHaveProperty("duration_options");
    expect(request.brief).not.toHaveProperty("duration_tier");
    expect(request.brief).not.toHaveProperty("voice_provider");

    await writeFile(join(draftRoot, "handoff", "brief.generated.json"), `\uFEFF${JSON.stringify({
      version: 1,
      job_id: collecting.activeJobId,
      request_revision: 1,
      brief_revision: 1,
      title: "Gemini là gì?",
      prompt: "Giải thích Gemini bằng mạch kể rõ ràng và dùng ảnh đã chọn làm trọng tâm thị giác.",
      format: "tiktok",
      video_language: "vi",
      selected_asset_ids: ["asset-01"],
    })}`);
    const review = await manager.status(draft.id);
    expect(review.productionState).toBe("brief_review");
    expect(review.briefReview).toMatchObject({ revision: 1, videoLanguage: "vi", selectedAssetIds: ["asset-01"] });
    expect(review.briefReview).not.toHaveProperty("durationTier");
    expect(review.briefReview).not.toHaveProperty("voiceProvider");
    expect(review.createReady).toBe(false);

    const promptCount = calls.filter((call) => call.method === "session.prompt").length;
    const back = await manager.returnToAssets(draft.id, review.workflowRevision);
    const reused = await manager.approveAssets(draft.id, back.workflowRevision, ["asset-01"]);
    expect(reused).toMatchObject({
      productionState: "brief_review",
      workflowRevision: 6,
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
      bgm: "motionreal-default.mp3",
      assetStrategy: "visualize-first",
    });
    expect(queued).toMatchObject({ productionState: "queued_create", workflowRevision: 7, createReady: true });
    await expect(manager.readCreateRequest(draft.id)).resolves.toMatchObject({
      prompt: expect.stringContaining("Gemini AI"),
      title: "Gemini AI là gì?",
      assets: [{ id: "asset-01", path: join(draftRoot, "assets", "one.png") }],
      choices: { durationTier: 2, videoLanguage: "vi", voiceProvider: "vivibe", bgm: "motionreal-default.mp3" },
    });
    const frozen = JSON.parse(await readFile(join(draftRoot, "handoff", "brief.json"), "utf8"));
    expect(frozen).toMatchObject({
      brief_revision: 2,
      accepted: true,
      duration_tier: 2,
      target_seconds: 90,
      bgm: "motionreal-default.mp3",
      asset_strategy: "visualize-first",
    });
    await expect(readFile(join(draftRoot, "motionreal.create.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await manager.linkProject(draft.id, "project-gemini");
    await expect(manager.status(draft.id)).resolves.toMatchObject({
      productionState: "authoring",
      projectId: "project-gemini",
      createReady: false,
    });
    await expect(manager.readCreateRequest(draft.id)).resolves.toMatchObject({
      title: "Gemini AI là gì?",
      choices: { durationTier: 2, videoLanguage: "vi", voiceProvider: "vivibe", bgm: "motionreal-default.mp3" },
    });
    await manager.linkProject(draft.id, "project-gemini");
    await expect(manager.linkProject(draft.id, "project-other")).rejects.toThrow(/project khác/);
    await manager.dispose();
  });

  it("keeps stale/invalid briefs in preparation and can return to the same asset selection", async () => {
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
    expect(invalid.productionState).toBe("preparing_brief");
    expect(invalid.briefReviewError).toMatch(/không khớp/);
    await expect(manager.readCreateRequest(draft.id)).rejects.toThrow(/duyệt brief/);

    const back = await manager.returnToAssets(draft.id, waiting.workflowRevision);
    expect(back).toMatchObject({ productionState: "asset_review", selectedAssetIds: ["asset-01"] });
    expect(back.assetReview).toHaveLength(1);
    await manager.dispose();
  });

  it("reissues a brief request with explicit feedback without accepting duration or voice from the model", async () => {
    const { manager, root, calls } = await activeManagerForTest();
    const draft = await manager.createDraft("Brief cần sửa");
    await manager.activate(draft.id, "internal-key");
    let state = await manager.transitionWorkflow(draft.id, { expectedRevision: 0, to: "collecting_assets", jobId: "job-brief-feedback" });
    state = await manager.transitionWorkflow(draft.id, { expectedRevision: state.workflowRevision, to: "asset_review", jobId: "job-brief-feedback" });
    state = await manager.transitionWorkflow(draft.id, { expectedRevision: state.workflowRevision, to: "brief_review", jobId: "job-brief-feedback" });
    const draftRoot = join(root, draft.id);
    const metadata = JSON.parse(await readFile(join(draftRoot, "motionreal-agent.json"), "utf8"));
    await writeFile(join(draftRoot, "motionreal-agent.json"), JSON.stringify({
      ...metadata,
      briefRequestRevision: 1,
      selectedAssetIds: ["asset-01"],
    }));
    await mkdir(join(draftRoot, "handoff"), { recursive: true });
    await writeFile(join(draftRoot, "handoff", "brief.generated.json"), JSON.stringify({
      version: 1,
      job_id: "job-brief-feedback",
      request_revision: 1,
      brief_revision: 1,
      title: "Bản cũ",
      prompt: "Một brief đủ dài để kiểm tra việc yêu cầu Agent viết lại có giữ đúng ngữ cảnh cũ.",
      format: "tiktok",
      video_language: "vi",
      selected_asset_ids: ["asset-01"],
    }));

    const next = await manager.requestBriefChanges(
      draft.id,
      state.workflowRevision,
      "Thêm ví dụ thực tế và mở đầu mạnh hơn.",
    );
    expect(next).toMatchObject({ productionState: "preparing_brief", workflowRevision: state.workflowRevision + 1 });
    const request = JSON.parse(await readFile(join(draftRoot, "handoff", "brief-request.json"), "utf8"));
    expect(request).toMatchObject({
      request_revision: 2,
      feedback: "Thêm ví dụ thực tế và mở đầu mạnh hơn.",
      base_brief: expect.objectContaining({ title: "Bản cũ" }),
    });
    expect(request).not.toHaveProperty("duration_options");
    expect(calls.filter((call) => call.method === "session.prompt")).toHaveLength(1);
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

  it("hands the selected-profile content plan directly to Harness without a visual-planner call", async () => {
    const planAuthoringContent = vi.fn(testPlanAuthoringContent);
    const { manager, root } = await activeManagerForTest({ planAuthoringContent });
    const prepared = await prepareLinkedAuthoringDraft(manager, root, "job-plan-once", "project-plan-once");
    const acceptedBriefPath = join(prepared.draftRoot, "handoff", "brief.json");
    await writeFile(acceptedBriefPath, JSON.stringify({
      ...JSON.parse(await readFile(acceptedBriefPath, "utf8")),
      asset_strategy: "visualize-first",
    }));
    await expect(manager.readCreateRequest(prepared.draftId)).resolves.toMatchObject({ choices: { bgm: null } });

    await manager.startAuthoring(prepared.draftId, "project-plan-once", prepared.projectRoot, []);
    await manager.startAuthoring(prepared.draftId, "project-plan-once", prepared.projectRoot, []);

    expect(planAuthoringContent).toHaveBeenCalledTimes(1);
    expect(planAuthoringContent).toHaveBeenCalledWith("project-plan-once", expect.objectContaining({
      text: "Giải thích chủ đề bằng một mạch kể rõ ràng và có điểm kết luận hữu ích.",
      urls: [],
      format: "tiktok",
      durationTier: 2,
      targetSeconds: 90,
      videoLanguage: "vi",
    }), expect.any(AbortSignal));
    const artifact = JSON.parse(await readFile(join(prepared.draftRoot, "handoff", "content-plan.json"), "utf8"));
    expect(artifact).toMatchObject({
      version: 1,
      job_id: "job-plan-once",
      request_revision: 1,
      content_plan: TEST_CONTENT_PLAN,
    });
    const request = JSON.parse(await readFile(join(prepared.draftRoot, "handoff", "authoring-request.json"), "utf8"));
    expect(request).toMatchObject({
      planning: false,
      content_plan: TEST_CONTENT_PLAN,
      expected_scene_ids: ["scene-01"],
      asset_strategy: "visualize-first",
    });
    const contract = await readFile(join(prepared.draftRoot, "handoff", "authoring-contract.md"), "utf8");
    expect(contract).toContain("PRESENTATION PROFILE: mechanism-explainer");
    expect(contract).not.toContain("PRESENTATION PROFILE: editorial-story");
    expect(contract).not.toContain("Bản đồ nội dung → hình thức");
    expect(request.instructions).toEqual(expect.arrayContaining([
      expect.stringMatching(/mọi beat id.*motionCueFrames/),
      expect.stringMatching(/ƯU TIÊN TỰ MINH HOẠ BẰNG CODE/),
    ]));
  });

  it("resumes from a persisted selected-profile plan without rerunning narrative planning", async () => {
    const planAuthoringContent = vi.fn(testPlanAuthoringContent);
    const { manager, root } = await activeManagerForTest({ planAuthoringContent });
    const prepared = await prepareLinkedAuthoringDraft(manager, root, "job-plan-resume", "project-plan-resume");
    await writeFile(join(prepared.draftRoot, "handoff", "content-plan.json"), JSON.stringify({
      version: 1,
      job_id: "job-plan-resume",
      request_revision: 1,
      content_plan: TEST_CONTENT_PLAN,
    }));

    await manager.startAuthoring(prepared.draftId, "project-plan-resume", prepared.projectRoot, []);

    expect(planAuthoringContent).not.toHaveBeenCalled();
    const request = JSON.parse(await readFile(join(prepared.draftRoot, "handoff", "authoring-request.json"), "utf8"));
    expect(request).toMatchObject({ planning: false, content_plan: TEST_CONTENT_PLAN });
  });

  it("recovers a legacy visual-planner error from its persisted base plan", async () => {
    const planAuthoringContent = vi.fn().mockRejectedValue(new Error("legacy visual planner failed"));
    const { manager, root, calls } = await activeManagerForTest({ planAuthoringContent });
    const prepared = await prepareLinkedAuthoringDraft(manager, root, "job-legacy-visual", "project-legacy-visual");

    await expect(manager.startAuthoring(prepared.draftId, "project-legacy-visual", prepared.projectRoot, []))
      .rejects.toThrow("legacy visual planner failed");
    const failed = await manager.status(prepared.draftId);
    await writeFile(join(prepared.draftRoot, "handoff", "content-plan.json"), JSON.stringify({
      version: 1,
      job_id: "job-legacy-visual",
      request_revision: 1,
      content_plan: TEST_CONTENT_PLAN,
    }));
    const promptCountBefore = calls.filter((call) => call.method === "session.prompt").length;

    await expect(manager.retryWorkflow(prepared.draftId, failed.workflowRevision))
      .resolves.toMatchObject({ productionState: "authoring" });
    expect(planAuthoringContent).toHaveBeenCalledTimes(1);
    expect(calls.filter((call) => call.method === "session.prompt")).toHaveLength(promptCountBefore + 1);
    const request = JSON.parse(await readFile(join(prepared.draftRoot, "handoff", "authoring-request.json"), "utf8"));
    expect(request).toMatchObject({ planning: false, content_plan: TEST_CONTENT_PLAN });
  });

  it("persists planner failure without prompting Harness, then retries the planner", async () => {
    const planAuthoringContent = vi.fn()
      .mockRejectedValueOnce(new Error("planner unavailable"))
      .mockResolvedValue({ contentPlan: TEST_CONTENT_PLAN, advisories: [] });
    const { manager, root, calls } = await activeManagerForTest({ planAuthoringContent });
    const prepared = await prepareLinkedAuthoringDraft(manager, root, "job-plan-retry", "project-plan-retry");
    const promptCountBefore = calls.filter((call) => call.method === "session.prompt").length;

    await expect(manager.startAuthoring(prepared.draftId, "project-plan-retry", prepared.projectRoot, []))
      .rejects.toThrow("planner unavailable");
    const failed = await manager.status(prepared.draftId);
    expect(failed).toMatchObject({ productionState: "error", failedPhase: "authoring" });
    expect(calls.filter((call) => call.method === "session.prompt")).toHaveLength(promptCountBefore);

    await expect(manager.retryWorkflow(prepared.draftId, failed.workflowRevision))
      .resolves.toMatchObject({ productionState: "authoring" });
    expect(planAuthoringContent).toHaveBeenCalledTimes(2);
    expect(calls.filter((call) => call.method === "session.prompt")).toHaveLength(promptCountBefore + 1);
  });

  it("aborts an in-flight Agent content plan on pause and ignores its late completion", async () => {
    let release: (() => void) | undefined;
    const planAuthoringContent = vi.fn((_projectId, _input, _signal: AbortSignal) => new Promise<PlannedAuthoringContent>((resolve) => {
      release = () => resolve({ contentPlan: TEST_CONTENT_PLAN, advisories: [] });
    }));
    const { manager, root } = await activeManagerForTest({ planAuthoringContent });
    const prepared = await prepareLinkedAuthoringDraft(manager, root, "job-plan-pause", "project-plan-pause");

    const starting = manager.startAuthoring(prepared.draftId, "project-plan-pause", prepared.projectRoot, []);
    await vi.waitFor(() => expect(planAuthoringContent).toHaveBeenCalledTimes(1));
    const authoring = await manager.status(prepared.draftId);
    await manager.pauseWorkflow(prepared.draftId, authoring.workflowRevision);
    release?.();
    await expect(starting).resolves.toBeUndefined();
    await expect(readFile(join(prepared.draftRoot, "handoff", "content-plan.json"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(manager.status(prepared.draftId)).resolves.toMatchObject({ productionState: "paused" });
  });


  it("authors final-quality first, then performs only the configured visual-refine pass", async () => {
    const sceneIds = ["scene-01", "scene-02", "scene-03"];
    const plannedNarration = "một hai ba bốn năm sáu bảy tám chín mười mười một mười hai mười ba";
    const stills: string[] = [];
    const evidencePaths: string[] = [];
    const renderAuthoringStills = vi.fn(async (_projectId: string, ids: string[], reviewRequest?: AuthoringReviewRequest) => {
      const artifacts: ReviewArtifact[] = reviewRequest ? [{
        path: evidencePaths[0]!, kind: "overview", sceneIds: [...reviewRequest.reviewSceneIds, ...reviewRequest.contextSceneIds],
        panels: [...reviewRequest.reviewSceneIds, ...reviewRequest.contextSceneIds].map((sceneId, index) => ({ index, sceneId, sample: "overview" })),
      }, ...reviewRequest.scenes.filter((scene) => scene.temporalMode !== "static").map((scene) => ({
        path: evidencePaths[1]!, kind: scene.temporalMode === "continuous" ? "dense-filmstrip" as const : "cue-filmstrip" as const,
        sceneIds: [scene.sceneId], panels: [
          { index: 0, sceneId: scene.sceneId, sample: "initial" as const },
          { index: 1, sceneId: scene.sceneId, sample: "after-cue" as const, cueId: "step-one" },
          { index: 2, sceneId: scene.sceneId, sample: "after-cue" as const, cueId: "step-two" },
        ],
      }))] : [];
      return { ok: true as const, stills: ids.map((id) => stills.find((path) => path.endsWith(`${id}.png`))!), reviewArtifacts: artifacts };
    });
    const acceptAuthoringStills = vi.fn(async () => undefined);
    const { manager, root, history } = await activeManagerForTest({
      renderAuthoringStills,
      acceptAuthoringStills,
      authoringRefinePolicy: async () => ({ refinePasses: 1, refineEarlyStop: true }),
      wordsPerSecond: async () => 1,
      planAuthoringContent: async () => ({
        contentPlan: {
        ...TEST_CONTENT_PLAN,
        scenes: sceneIds.map((sceneId) => ({
          ...TEST_CONTENT_PLAN.scenes[0]!,
          sceneId,
          narration: plannedNarration,
          temporalMode: sceneId === "scene-02" ? "stepped" as const : "static" as const,
          detailMode: "normal" as const,
          motionBeats: undefined,
          ...(sceneId === "scene-02" ? {
            motionProgression: "Quick entrance; semantic: reveal step one, then step two; final hold.",
            motionBeats: [
              { id: "step-one", anchor: "một hai", action: "Reveal step one" },
              { id: "step-two", anchor: "sáu bảy", action: "Reveal step two" },
            ],
          } : {}),
        })),
        },
        advisories: [],
      }),
    });
    const draft = await manager.createDraft("Author final trực tiếp");
    await manager.activate(draft.id, "internal-key");
    let state = await manager.transitionWorkflow(draft.id, { expectedRevision: 0, to: "collecting_assets", jobId: "job-final" });
    state = await manager.transitionWorkflow(draft.id, { expectedRevision: state.workflowRevision, to: "asset_review", jobId: "job-final" });
    state = await manager.transitionWorkflow(draft.id, { expectedRevision: state.workflowRevision, to: "brief_review", jobId: "job-final" });
    state = await manager.transitionWorkflow(draft.id, { expectedRevision: state.workflowRevision, to: "queued_create", jobId: "job-final" });
    const draftRoot = join(root, draft.id);
    const metadataPath = join(draftRoot, "motionreal-agent.json");
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    await writeFile(metadataPath, JSON.stringify({ ...metadata, briefRequestRevision: 1 }));
    await mkdir(join(draftRoot, "handoff"), { recursive: true });
    await writeFile(join(draftRoot, "handoff", "brief.json"), JSON.stringify({
      version: 1, accepted: true, job_id: "job-final", request_revision: 1, brief_revision: 1,
      title: "Author final", prompt: "Nội dung đủ dài cho bài kiểm tra author trực tiếp và refine ảnh có giới hạn.",
      format: "tiktok", duration_tier: 1, target_seconds: 45, video_language: "vi", voice_provider: "vivibe", selected_asset_ids: [],
    }));
    await manager.linkProject(draft.id, "project-final");
    const projectRoot = join(root, "projects", "project-final");
    await mkdir(join(projectRoot, "authored"), { recursive: true });
    await mkdir(join(projectRoot, "review"), { recursive: true });
    stills.push(
      ...sceneIds.map((id) => join(projectRoot, "review", `${id}.png`)),
    );
    await mkdir(join(projectRoot, "review", "evidence"), { recursive: true });
    evidencePaths.push(
      join(projectRoot, "review", "evidence", "overview-01.png"),
      join(projectRoot, "review", "evidence", "scene-02.motion.png"),
    );
    await Promise.all(stills.map((path) => writeFile(path, ONE_PIXEL_PNG)));
    await Promise.all(evidencePaths.map((path) => writeFile(path, REVIEW_EVIDENCE_PNG)));

    await manager.startAuthoring(draft.id, "project-final", projectRoot, []);
    const initial = JSON.parse(await readFile(join(draftRoot, "handoff", "authoring-request.json"), "utf8"));
    expect(initial).toMatchObject({ phase: "initial" });
    expect(initial).not.toHaveProperty("creative_stage");
    expect(initial.instructions.join(" ")).toContain("bản chất lượng cuối");

    await writeFile(join(projectRoot, "manifest.json"), JSON.stringify({
      title: "Author final", durationTier: 1, videoLanguage: "vi",
      scenes: sceneIds.map((id, index) => ({
        id, component: id, headline: id,
        ...(index < sceneIds.length - 1 ? { transitionToNext: { type: "fade", durationInFrames: 12 } } : {}),
      })),
    }));
    await Promise.all(sceneIds.map((id) => writeFile(join(projectRoot, "authored", `${id}.tsx`), registeredSceneSource(id, "final"))));
    await writeJson(join(draftRoot, "handoff", "authoring.json"), {
      version: 1, job_id: "job-final", request_revision: 1, scene_ids: sceneIds, used_asset_ids: [],
    });
    await vi.waitFor(async () => {
      const request = JSON.parse(await readFile(join(draftRoot, "handoff", "authoring-request.json"), "utf8"));
      expect(request).toMatchObject({ request_revision: 2, phase: "visual_refine", visual_refine_pass: 1 });
      expect(request).not.toHaveProperty("creative_stage");
    }, { timeout: 3_000 });
    expect(renderAuthoringStills).toHaveBeenCalledTimes(1);
    expect(renderAuthoringStills).toHaveBeenCalledWith("project-final", sceneIds, expect.objectContaining({
      reviewSceneIds: sceneIds,
      contextSceneIds: [],
      scenes: expect.arrayContaining([expect.objectContaining({ sceneId: "scene-02", temporalMode: "stepped" })]),
    }));
    const normalizedManifest = JSON.parse(await readFile(join(projectRoot, "manifest.json"), "utf8"));
    expect(normalizedManifest.scenes.map((scene: { narration?: string }) => scene.narration))
      .toEqual([plannedNarration, plannedNarration, plannedNarration]);
    expect(normalizedManifest.scenes[0].transitionToNext).toBe("fade");

    const firstRead = evidencePaths.slice(0, 1);
    for (const path of firstRead) {
      const callId = `read-${history.length}`;
      history.push({ event: { seq: history.length, type: "tool/call", data: { callId, name: "read_image", arguments: JSON.stringify({ file_path: `project/review/evidence/${path.split("\\").at(-1)}` }) } } });
      history.push({ event: { seq: history.length, type: "tool/result", data: { message: { content: [{
        type: "tool-result", toolCallId: callId, isError: false,
        content: [{ type: "image", attachment: { attachmentId: callId, mediaType: "image/png", bytes: 68, width: 1, height: 1 } }],
      }] } } } });
    }
    history.push({ event: { seq: history.length, type: "assistant/message", data: { message: { content: [{ type: "text", text: "Ảnh sạch, giữ nguyên source." }] } } } });
    await writeJson(join(draftRoot, "handoff", "authoring.json"), {
      version: 1, job_id: "job-final", request_revision: 2, scene_ids: sceneIds, used_asset_ids: [],
      reviewed_scene_ids: sceneIds, review_notes: "scene-01: clean; scene-02: clean; scene-03: clean — mechanism-explainer khớp, hierarchy rõ, không có lỗi trực quan cần sửa.",
    });
    const firstReviewRequest = JSON.parse(await readFile(join(draftRoot, "handoff", "authoring-request.json"), "utf8"));
    await vi.waitFor(async () => {
      await expect(readFile(join(draftRoot, "handoff", "authoring-request.json"), "utf8"))
        .resolves.toContain('"request_revision": 3');
    }, { timeout: 3_000 });
    const repairRequest = JSON.parse(await readFile(join(draftRoot, "handoff", "authoring-request.json"), "utf8"));
    expect(repairRequest.review_after_seq).toBe(firstReviewRequest.review_after_seq);
    expect(repairRequest.instructions.join(" ")).toMatch(/evidence artifact còn thiếu/);

    for (const path of evidencePaths.slice(1)) {
      const callId = `read-${history.length}`;
      history.push({ event: { seq: history.length, type: "tool/call", data: { callId, name: "read_image", arguments: JSON.stringify({ file_path: `project/review/evidence/${path.split("\\").at(-1)}` }) } } });
      history.push({ event: { seq: history.length, type: "tool/result", data: { message: { content: [{
        type: "tool-result", toolCallId: callId, isError: false,
        content: [{ type: "image", attachment: { attachmentId: callId, mediaType: "image/png", bytes: 68, width: 1, height: 1 } }],
      }] } } } });
    }
    history.push({ event: { seq: history.length, type: "assistant/message", data: { message: { content: [{ type: "text", text: "Đã mở nốt các ảnh còn thiếu." }] } } } });
    await writeJson(join(draftRoot, "handoff", "authoring.json"), {
      version: 1, job_id: "job-final", request_revision: 3, scene_ids: sceneIds, used_asset_ids: [],
      reviewed_scene_ids: sceneIds, review_notes: "scene-01: clean; scene-02: clean; scene-03: clean — mechanism-explainer khớp, hierarchy rõ, không có lỗi trực quan cần sửa.",
    });
    await vi.waitFor(() => expect(acceptAuthoringStills).toHaveBeenCalledWith("project-final"), { timeout: 3_000 });
    expect(renderAuthoringStills).toHaveBeenCalledTimes(1);
    await vi.waitFor(async () => {
      await expect(manager.status(draft.id)).resolves.toMatchObject({ productionState: "scene_review" });
    }, { timeout: 3_000 });

    await manager.requestSceneEdits(draft.id, "project-final", [{ sceneId: "scene-01", text: "Sửa điểm nhấn cảnh đầu." }], "");
    await writeFile(join(projectRoot, "authored", "scene-01.tsx"), registeredSceneSource("scene-01", "edited"));
    await writeJson(join(draftRoot, "handoff", "authoring.json"), {
      version: 1, job_id: "job-final", request_revision: 4,
      scene_ids: sceneIds, used_asset_ids: [],
    });
    await vi.waitFor(() => expect(renderAuthoringStills).toHaveBeenLastCalledWith("project-final", ["scene-01"], expect.objectContaining({
      reviewSceneIds: ["scene-01"], contextSceneIds: ["scene-02"],
    })), { timeout: 3_000 });
    await vi.waitFor(async () => expect(JSON.parse(await readFile(join(draftRoot, "handoff", "authoring-request.json"), "utf8")))
      .toMatchObject({ request_revision: 5, phase: "visual_refine", review_scene_ids: ["scene-01"] }), { timeout: 3_000 });
    await manager.dispose();
  });

  it("persists a failed authoring start and retries the existing initial request", async () => {
    let rejectNextPrompt = true;
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method: string };
      if (body.method === "host.describe") {
        return Response.json({ type: "server-response", result: { ok: true, value: HARNESS_DESCRIPTION } });
      }
      if (body.method === "workspace.create") {
        return Response.json({ type: "server-response", result: { ok: true, value: { workspace: { workspaceId: "workspace-retry" } } } });
      }
      if (body.method === "credentials.describe") {
        return Response.json({ type: "server-response", result: { ok: true, value: { credentials: {} } } });
      }
      if (body.method === "session.prompt" && rejectNextPrompt) {
        rejectNextPrompt = false;
        return Response.json({ type: "server-response", result: { ok: false, error: { code: "offline", message: "prompt transport failed" } } });
      }
      return Response.json({ type: "server-response", result: { ok: true, value: {} } });
    }) as unknown as typeof globalThis.fetch;
    const planAuthoringContent = vi.fn(testPlanAuthoringContent);
    const { manager, root } = await activeManagerForTest({ fetch, planAuthoringContent });
    const draft = await manager.createDraft("Retry authoring start");
    await manager.activate(draft.id, "internal-key");
    let state = await manager.transitionWorkflow(draft.id, { expectedRevision: 0, to: "collecting_assets", jobId: "job-retry-start" });
    state = await manager.transitionWorkflow(draft.id, { expectedRevision: state.workflowRevision, to: "asset_review", jobId: "job-retry-start" });
    state = await manager.transitionWorkflow(draft.id, { expectedRevision: state.workflowRevision, to: "brief_review", jobId: "job-retry-start" });
    state = await manager.transitionWorkflow(draft.id, { expectedRevision: state.workflowRevision, to: "queued_create", jobId: "job-retry-start" });
    const draftRoot = join(root, draft.id);
    const metadataPath = join(draftRoot, "motionreal-agent.json");
    await writeFile(metadataPath, JSON.stringify({ ...JSON.parse(await readFile(metadataPath, "utf8")), briefRequestRevision: 1 }));
    await mkdir(join(draftRoot, "handoff"), { recursive: true });
    await writeFile(join(draftRoot, "handoff", "brief.json"), JSON.stringify({
      version: 1, accepted: true, job_id: "job-retry-start", request_revision: 1, brief_revision: 1,
      title: "Retry authoring", prompt: "Nội dung đủ dài để kiểm tra retry authoring sau lỗi gửi yêu cầu.",
      format: "tiktok", duration_tier: 2, target_seconds: 90, video_language: "vi", voice_provider: "vivibe", selected_asset_ids: [],
    }));
    await manager.linkProject(draft.id, "project-retry-start");
    const projectRoot = join(root, "projects", "project-retry-start");
    await mkdir(join(projectRoot, "authored"), { recursive: true });

    await expect(manager.startAuthoring(draft.id, "project-retry-start", projectRoot, [])).rejects.toThrow("prompt transport failed");
    const failed = await manager.status(draft.id);
    expect(failed).toMatchObject({ productionState: "error", failedPhase: "authoring" });

    await expect(manager.retryWorkflow(draft.id, failed.workflowRevision)).resolves.toMatchObject({ productionState: "authoring" });
    expect(planAuthoringContent).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await readFile(join(draftRoot, "handoff", "authoring-request.json"), "utf8")))
      .toMatchObject({ request_revision: 1, phase: "initial" });
  });

  it("keeps a valid authoring submission and retries only still rendering when the runtime bridge fails", async () => {
    let stillResult: { ok: true; stills: string[]; reviewArtifacts: ReviewArtifact[] } | { ok: false; error: string; repairable: boolean } = {
      ok: false,
      error: "Cannot read properties of undefined (reading 'backend').",
      repairable: false,
    };
    const renderAuthoringStills = vi.fn(async () => stillResult);
    const acceptAuthoringStills = vi.fn(async () => undefined);
    const { manager, root, calls } = await activeManagerForTest({
      renderAuthoringStills,
      acceptAuthoringStills,
      authoringRefinePolicy: async () => ({ refinePasses: 0, refineEarlyStop: true }),
      wordsPerSecond: async () => 1,
      planAuthoringContent: async () => ({
        contentPlan: {
          ...TEST_CONTENT_PLAN,
          scenes: ["scene-01", "scene-02", "scene-03"].map((sceneId) => ({
            ...TEST_CONTENT_PLAN.scenes[0]!,
            sceneId,
            narration: "một hai ba bốn năm sáu bảy tám chín mười mười một mười hai mười ba",
          })),
        },
        advisories: [],
      }),
    });
    const draft = await manager.createDraft("Render still lỗi runtime");
    await manager.activate(draft.id, "internal-key");
    let state = await manager.transitionWorkflow(draft.id, { expectedRevision: 0, to: "collecting_assets", jobId: "job-runtime" });
    state = await manager.transitionWorkflow(draft.id, { expectedRevision: state.workflowRevision, to: "asset_review", jobId: "job-runtime" });
    state = await manager.transitionWorkflow(draft.id, { expectedRevision: state.workflowRevision, to: "brief_review", jobId: "job-runtime" });
    await manager.transitionWorkflow(draft.id, { expectedRevision: state.workflowRevision, to: "queued_create", jobId: "job-runtime" });

    const draftRoot = join(root, draft.id);
    const metadataPath = join(draftRoot, "motionreal-agent.json");
    await writeFile(metadataPath, JSON.stringify({
      ...JSON.parse(await readFile(metadataPath, "utf8")),
      briefRequestRevision: 1,
    }));
    await mkdir(join(draftRoot, "handoff"), { recursive: true });
    await writeFile(join(draftRoot, "handoff", "brief.json"), JSON.stringify({
      version: 1, accepted: true, job_id: "job-runtime", request_revision: 1, brief_revision: 1,
      title: "Runtime bridge", prompt: "Nội dung đủ dài để kiểm tra khi bridge render still của Agent gặp lỗi runtime.",
      format: "tiktok", duration_tier: 1, target_seconds: 45, video_language: "vi", voice_provider: "vivibe", selected_asset_ids: [],
    }));
    await manager.linkProject(draft.id, "project-runtime");
    const projectRoot = join(root, "projects", "project-runtime");
    await mkdir(join(projectRoot, "authored"), { recursive: true });
    await manager.startAuthoring(draft.id, "project-runtime", projectRoot, []);
    const promptCount = calls.filter((call) => call.method === "session.prompt").length;
    const sceneIds = ["scene-01", "scene-02", "scene-03"];
    await writeFile(join(projectRoot, "manifest.json"), JSON.stringify({
      title: "Runtime bridge", durationTier: 1, videoLanguage: "vi",
      scenes: sceneIds.map((id, index) => ({
        id, component: id, headline: id,
        narration: "một hai ba bốn năm sáu bảy tám chín mười mười một mười hai mười ba",
        ...(index < sceneIds.length - 1 ? { transitionToNext: "fade" } : {}),
      })),
    }));
    await Promise.all(sceneIds.map((id) => writeFile(join(projectRoot, "authored", `${id}.tsx`), registeredSceneSource(id, "runtime"))));
    await writeJson(join(draftRoot, "handoff", "authoring.json"), {
      version: 1, job_id: "job-runtime", request_revision: 1, scene_ids: sceneIds, used_asset_ids: [],
    });

    await manager.status(draft.id);
    await vi.waitFor(async () => {
      await expect(manager.status(draft.id)).resolves.toMatchObject({
        productionState: "error",
        failedPhase: "authoring",
        retryAction: "rerender_stills",
        lastError: "Cannot read properties of undefined (reading 'backend').",
      });
    }, { timeout: 3_000 });
    await expect(readFile(join(draftRoot, "handoff", "authoring.json"), "utf8")).resolves.toContain("scene-01");
    expect(calls.filter((call) => call.method === "session.prompt")).toHaveLength(promptCount);

    stillResult = { ok: true, stills: sceneIds.map((id) => join(projectRoot, "review", `${id}.png`)), reviewArtifacts: [] };
    const failed = await manager.status(draft.id);
    await manager.retryWorkflow(draft.id, failed.workflowRevision);
    await vi.waitFor(async () => {
      await expect(manager.status(draft.id)).resolves.toMatchObject({ productionState: "scene_review" });
    }, { timeout: 3_000 });
    expect(renderAuthoringStills).toHaveBeenCalledTimes(2);
    expect(calls.filter((call) => call.method === "session.prompt")).toHaveLength(promptCount);
  });

  it("removes the video workspace when the draft is removed", async () => {
    const { manager, root } = await managerForTest();
    const draft = await manager.createDraft("Xóa toàn bộ");
    await writeFile(join(root, draft.id, "assets", "research.txt"), "history");

    await manager.removeDraft(draft.id);
    expect(await manager.list()).toEqual([]);
  });

  it("removes only the exact pinned Harness session directory", async () => {
    const { manager, root } = await managerForTest({
      harnessRevision: async () => "d74a18cbd21c0fac2b63f51ae5f46556b4694d14",
    });
    const draft = await manager.createDraft("Xóa lịch sử thật");
    const plan = await manager.prepareDraftDeletion(draft.id);
    const projectKey = `--${plan.draftRoot.replace(/[:\\/]+/g, "-").replace(/^-+/, "")}--`;
    const sessionDir = join(root, "harness", "sessions", projectKey, plan.sessionIds[0]!);
    const otherSessionDir = join(root, "harness", "sessions", projectKey, "session-other");
    await mkdir(sessionDir, { recursive: true });
    await mkdir(otherSessionDir, { recursive: true });
    await writeFile(join(sessionDir, "session.jsonl"), "deleted history");
    await writeFile(join(otherSessionDir, "session.jsonl"), "retained history");

    await manager.removeDraft(draft.id);

    await expect(readFile(join(sessionDir, "session.jsonl"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(otherSessionDir, "session.jsonl"), "utf8")).resolves.toBe("retained history");
  });

  it("fails closed before touching persisted history when Harness revision differs", async () => {
    const { manager, root } = await managerForTest({ harnessRevision: async () => "0".repeat(40) });
    const draft = await manager.createDraft("Không xóa sai history");
    const plan = await manager.prepareDraftDeletion(draft.id);
    const projectKey = `--${plan.draftRoot.replace(/[:\\/]+/g, "-").replace(/^-+/, "")}--`;
    const sessionLog = join(root, "harness", "sessions", projectKey, plan.sessionIds[0]!, "session.jsonl");
    await mkdir(dirname(sessionLog), { recursive: true });
    await writeFile(sessionLog, "keep history");

    await expect(manager.removeDraft(draft.id)).rejects.toThrow(/không khớp/i);
    await expect(readFile(sessionLog, "utf8")).resolves.toBe("keep history");
    expect(await manager.status(draft.id)).toMatchObject({ id: draft.id });
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
      const value = method === "host.describe"
        ? HARNESS_DESCRIPTION
        : method === "workspace.create"
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
      planAuthoringContent: testPlanAuthoringContent,
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
    expect(opened.harnessUrl).toContain("&embedded=motionreal");
    expect(otherOpened.harnessUrl).toContain("&embedded=motionreal");
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
      planAuthoringContent: testPlanAuthoringContent,
      findPort: async () => 39875,
      spawn: vi.fn(() => child) as unknown as typeof import("node:child_process").spawn,
      fetch: vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (!init?.method) return new Response("ok", { status: 200 });
        const method = JSON.parse(String(init.body)).method as string;
        methods.push(method);
        const value = method === "host.describe"
          ? HARNESS_DESCRIPTION
          : method === "workspace.create"
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
      planAuthoringContent: testPlanAuthoringContent,
      nodeExecutable: "C:\\Program Files\\nodejs\\node.exe",
      findPort: async () => 39874,
      spawn: spawnChild,
      fetch: vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (!init?.method) return new Response("ok");
        const method = JSON.parse(String(init.body)).method as string;
        const value = method === "host.describe"
          ? HARNESS_DESCRIPTION
          : method === "workspace.create"
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
    const patch = await readFile(join(root, "harness", "motionreal-tools.patch.yml"), "utf8");
    expect(patch).toMatch(/motionreal-submission-tools[\s\S]*file:\/\//);
    expect(patch).toContain("- id: system-prompt\n  config:\n    includeHarnessIdentity: false");
    expect(patch).toContain("You are MotionReal Agent.");
    expect(patch).toContain("- id: web-search-deepseek\n  config:\n    apiKeyEnv: DEEPSEEK_API_KEY");
    // The custom 9router model has no upstream catalog entry to inherit vision from.
    // Declare only this model, not a route-wide capability for unknown future models.
    expect(patch).toContain("          - id: ag/gemini-3.7-flash-high\n            input: [text, image]\n");
    expect(patch).not.toContain("defaultInput:");
    const options = vi.mocked(spawnChild).mock.calls[0]?.[2];
    expect(options?.env).not.toHaveProperty("ELECTRON_RUN_AS_NODE");
    await manager.dispose();
  });

  it("migrates only MotionReal's legacy settings rows and preserves Harness settings", async () => {
    const { manager, deps } = await activeManagerForTest();
    await mkdir(deps.harnessHome, { recursive: true });
    const settingsPath = join(deps.harnessHome, "settings.yaml");
    await writeFile(settingsPath, [
      "system-prompt:",
      "  includeHarnessIdentity: false",
      "llm-pi-ai:",
      "  providers:",
      "    ninerouter:",
      "      apiKeyEnv: NINEROUTER_API_KEY",
      "agent-default-model:",
      "  provider: ninerouter",
      "  model: ag/gemini-3.7-flash-high",
      "web-search-deepseek:",
      "  apiKeyEnv: DEEPSEEK_API_KEY",
      "permission:",
      "  defaultPreset: workspace-write",
      "custom-user-section:",
      "  keep: true",
      "",
    ].join("\n"));

    const draft = await manager.createDraft("Giữ cấu hình Harness");
    await manager.activate(draft.id, "internal-key");

    await expect(readFile(settingsPath, "utf8")).resolves.toBe([
      "permission:",
      "  defaultPreset: workspace-write",
      "custom-user-section:",
      "  keep: true",
      "",
    ].join("\n"));
    const patch = await readFile(join(deps.harnessHome, "motionreal-tools.patch.yml"), "utf8");
    expect(patch).toContain("- id: system-prompt");
    expect(patch).toContain("- id: web-search-deepseek");

    await manager.dispose();
    await manager.activate(draft.id, "internal-key");
    await expect(readFile(settingsPath, "utf8")).resolves.toContain("defaultPreset: workspace-write");
  });

  it("does not overwrite legacy settings it cannot identify safely", async () => {
    const { manager, deps } = await activeManagerForTest();
    await mkdir(deps.harnessHome, { recursive: true });
    const settingsPath = join(deps.harnessHome, "settings.yaml");
    const original = "system-prompt: { includeHarnessIdentity: false }\npermission:\n  defaultPreset: workspace-write\n";
    await writeFile(settingsPath, original);

    const draft = await manager.createDraft("Không ghi đè cấu hình lạ");
    await manager.activate(draft.id, "internal-key");

    await expect(readFile(settingsPath, "utf8")).resolves.toBe(original);
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
      planAuthoringContent: testPlanAuthoringContent,
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

  it("reports the last health-check result when a cold start exceeds its deadline", async () => {
    const root = await mkdtemp(join(tmpdir(), "motionreal-agent-timeout-"));
    roots.push(root);
    const cli = join(root, "dsh.js");
    const plugin = join(root, "motionreal-tools.mjs");
    await writeFile(cli, "// test placeholder\n");
    await writeFile(plugin, "// test tool plugin\n");
    const child = Object.assign(new EventEmitter(), {
      stderr: new EventEmitter(),
      exitCode: null,
      kill: vi.fn(() => false),
    });
    const manager = new HarnessManager({
      draftsRoot: join(root, "drafts"),
      harnessHome: join(root, "harness"),
      harnessCliPath: cli,
      submissionPluginPath: plugin,
      planAuthoringContent: testPlanAuthoringContent,
      startTimeoutMs: 20,
      findPort: async () => 39874,
      spawn: vi.fn(() => child) as unknown as typeof import("node:child_process").spawn,
      fetch: vi.fn(async () => new Response(null, { status: 503 })) as unknown as typeof globalThis.fetch,
    });

    await expect(manager.start("internal-key")).rejects.toThrow(/HTTP 503/);
    expect(child.kill).toHaveBeenCalledOnce();
    await expect(readdir(join(root, "drafts"))).resolves.toEqual([]);
  });
});

describe("Task 1 — durable recovery", () => {
  function promptGatedFetch(failGate: { fail: boolean }, calls: Array<{ method: string; payload: unknown }>) {
    return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method: string; payload: unknown; rpcId?: string };
      calls.push(body);
      if (body.method === "host.describe") {
        return Response.json({ type: "server-response", result: { ok: true, value: HARNESS_DESCRIPTION } });
      }
      if (body.method === "workspace.create") {
        return Response.json({ type: "server-response", result: { ok: true, value: { workspace: { workspaceId: "workspace-task1" } } } });
      }
      if (body.method === "session.prompt" && failGate.fail) {
        return Response.json({ type: "server-response", result: { ok: false, error: { code: "offline", message: "prompt transport failed" } } });
      }
      return Response.json({ type: "server-response", result: { ok: true, value: {} } });
    }) as unknown as typeof globalThis.fetch;
  }

  function promptCount(calls: Array<{ method: string }>): number {
    return calls.filter((call) => call.method === "session.prompt").length;
  }

  async function prepareBriefDispatchDraft(failGate: { fail: boolean }) {
    const calls: Array<{ method: string; payload: unknown }> = [];
    const { manager, root } = await activeManagerForTest({ fetch: promptGatedFetch(failGate, calls) });
    const draft = await manager.createDraft("Brief dispatch lỗi");
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
    expect(assets.productionState).toBe("asset_review");
    return { manager, root, calls, draft, draftRoot, assets };
  }

  it("persists brief dispatch failure from approveAssets with retryable error", async () => {
    const failGate = { fail: false };
    const { manager, calls, draft, draftRoot, assets } = await prepareBriefDispatchDraft(failGate);
    failGate.fail = true;

    const failed = await manager.approveAssets(draft.id, assets.workflowRevision, ["asset-01"]);

    expect(failed).toMatchObject({ productionState: "error", failedPhase: "preparing_brief" });
    expect(failed.lastError).toMatch(/prompt transport failed/);
    expect(failed).not.toHaveProperty("briefReviewError");
    expect(failed).toMatchObject({ selectedAssetIds: ["asset-01"] });
    const persisted = JSON.parse(await readFile(join(draftRoot, "motionreal-agent.json"), "utf8"));
    expect(persisted).toMatchObject({ productionState: "error", failedPhase: "preparing_brief" });
    expect(typeof persisted.lastError).toBe("string");

    // Refresh retains retry availability.
    await expect(manager.status(draft.id)).resolves.toMatchObject({ productionState: "error", failedPhase: "preparing_brief" });
    failGate.fail = false;
    const promptsBefore = promptCount(calls);
    await expect(manager.retryWorkflow(draft.id, failed.workflowRevision))
      .resolves.toMatchObject({ productionState: "preparing_brief" });
    expect(promptCount(calls)).toBe(promptsBefore + 1);
    await manager.dispose();
  });

  it("persists brief dispatch failure from prepareBrief with retryable error", async () => {
    const failGate = { fail: false };
    const { manager, calls, draft, draftRoot, assets } = await prepareBriefDispatchDraft(failGate);
    const waiting = await manager.approveAssets(draft.id, assets.workflowRevision, ["asset-01"]);
    expect(waiting.productionState).toBe("preparing_brief");
    failGate.fail = true;

    const failed = await manager.prepareBrief(draft.id, waiting.workflowRevision);

    expect(failed).toMatchObject({ productionState: "error", failedPhase: "preparing_brief" });
    expect(failed.lastError).toMatch(/prompt transport failed/);
    expect(failed).not.toHaveProperty("briefReviewError");
    const persisted = JSON.parse(await readFile(join(draftRoot, "motionreal-agent.json"), "utf8"));
    expect(persisted).toMatchObject({ productionState: "error", failedPhase: "preparing_brief" });

    failGate.fail = false;
    const promptsBefore = promptCount(calls);
    await expect(manager.retryWorkflow(draft.id, failed.workflowRevision))
      .resolves.toMatchObject({ productionState: "preparing_brief" });
    expect(promptCount(calls)).toBe(promptsBefore + 1);
    await manager.dispose();
  });

  it("persists brief dispatch failure from requestBriefChanges with retryable error", async () => {
    const failGate = { fail: false };
    const calls: Array<{ method: string; payload: unknown }> = [];
    const { manager, root } = await activeManagerForTest({ fetch: promptGatedFetch(failGate, calls) });
    const draft = await manager.createDraft("Brief cần sửa lỗi dispatch");
    await manager.activate(draft.id, "internal-key");
    let state = await manager.transitionWorkflow(draft.id, { expectedRevision: 0, to: "collecting_assets", jobId: "job-brief-dispatch" });
    state = await manager.transitionWorkflow(draft.id, { expectedRevision: state.workflowRevision, to: "asset_review", jobId: "job-brief-dispatch" });
    state = await manager.transitionWorkflow(draft.id, { expectedRevision: state.workflowRevision, to: "brief_review", jobId: "job-brief-dispatch" });
    const draftRoot = join(root, draft.id);
    const metadata = JSON.parse(await readFile(join(draftRoot, "motionreal-agent.json"), "utf8"));
    await writeFile(join(draftRoot, "motionreal-agent.json"), JSON.stringify({
      ...metadata,
      briefRequestRevision: 1,
      selectedAssetIds: ["asset-01"],
    }));
    await mkdir(join(draftRoot, "handoff"), { recursive: true });
    await writeFile(join(draftRoot, "handoff", "brief.generated.json"), JSON.stringify({
      version: 1,
      job_id: "job-brief-dispatch",
      request_revision: 1,
      brief_revision: 1,
      title: "Bản cũ",
      prompt: "Một brief đủ dài để kiểm tra việc giữ lỗi dispatch khi yêu cầu Agent viết lại.",
      format: "tiktok",
      video_language: "vi",
      selected_asset_ids: ["asset-01"],
    }));
    failGate.fail = true;

    const failed = await manager.requestBriefChanges(draft.id, state.workflowRevision, "Thêm ví dụ thực tế.");

    expect(failed).toMatchObject({ productionState: "error", failedPhase: "preparing_brief" });
    expect(failed.lastError).toMatch(/prompt transport failed/);
    expect(failed).not.toHaveProperty("briefReviewError");

    failGate.fail = false;
    const promptsBefore = promptCount(calls);
    await expect(manager.retryWorkflow(draft.id, failed.workflowRevision))
      .resolves.toMatchObject({ productionState: "preparing_brief" });
    expect(promptCount(calls)).toBe(promptsBefore + 1);
    await manager.dispose();
  });

  it("defers the authoring prompt on resume until a paused initial plan completes", async () => {
    const releases: Array<() => void> = [];
    const planAuthoringContent = vi.fn(() => new Promise<PlannedAuthoringContent>((resolve) => {
      releases.push(() => resolve({ contentPlan: TEST_CONTENT_PLAN, advisories: [] }));
    }));
    const { manager, root, calls } = await activeManagerForTest({ planAuthoringContent });
    const prepared = await prepareLinkedAuthoringDraft(manager, root, "job-plan-resume-fence", "project-plan-resume-fence");

    const starting = manager.startAuthoring(prepared.draftId, "project-plan-resume-fence", prepared.projectRoot, []);
    await vi.waitFor(() => expect(planAuthoringContent).toHaveBeenCalledTimes(1));
    const authoring = await manager.status(prepared.draftId);
    const paused = await manager.pauseWorkflow(prepared.draftId, authoring.workflowRevision);
    expect(paused.productionState).toBe("paused");
    // The aborted first plan resolves late and must be ignored.
    releases[0]!();
    await expect(starting).resolves.toBeUndefined();
    await expect(readFile(join(prepared.draftRoot, "handoff", "content-plan.json"))).rejects.toMatchObject({ code: "ENOENT" });

    const promptsBefore = promptCount(calls);
    const resuming = manager.resumeWorkflow(prepared.draftId, paused.workflowRevision);
    await vi.waitFor(() => expect(planAuthoringContent).toHaveBeenCalledTimes(2));
    // Planning is still in flight: no authoring prompt may be sent yet.
    expect(promptCount(calls)).toBe(promptsBefore);
    releases[1]!();
    await expect(resuming).resolves.toMatchObject({ productionState: "authoring" });
    expect(promptCount(calls)).toBe(promptsBefore + 1);
    expect(planAuthoringContent).toHaveBeenCalledTimes(2);
    const request = JSON.parse(await readFile(join(prepared.draftRoot, "handoff", "authoring-request.json"), "utf8"));
    expect(request).toMatchObject({ planning: false, content_plan: TEST_CONTENT_PLAN });
    await manager.dispose();
  });

  it("records a failed resume plan without prompting, then retries the planner", async () => {
    const planAuthoringContent = vi.fn()
      .mockRejectedValueOnce(new Error("resume planner failed"))
      .mockResolvedValue({ contentPlan: TEST_CONTENT_PLAN, advisories: [] });
    const { manager, root, calls } = await activeManagerForTest({ planAuthoringContent });
    const prepared = await prepareLinkedAuthoringDraft(manager, root, "job-plan-resume-fail", "project-plan-resume-fail");
    await writeFile(join(prepared.draftRoot, "handoff", "authoring-request.json"), JSON.stringify({
      version: 1, job_id: "job-plan-resume-fail", request_revision: 1, phase: "initial", planning: true,
    }));
    const metadataPath = join(prepared.draftRoot, "motionreal-agent.json");
    await writeFile(metadataPath, JSON.stringify({
      ...JSON.parse(await readFile(metadataPath, "utf8")),
      productionState: "paused",
      pausedFrom: "authoring",
      authoringRequestRevision: 1,
    }));
    const promptsBefore = promptCount(calls);
    const paused = await manager.status(prepared.draftId);

    await expect(manager.resumeWorkflow(prepared.draftId, paused.workflowRevision)).rejects.toThrow("resume planner failed");
    await expect(manager.status(prepared.draftId)).resolves.toMatchObject({
      productionState: "error",
      failedPhase: "authoring",
    });
    expect(promptCount(calls)).toBe(promptsBefore);

    const failed = await manager.status(prepared.draftId);
    await expect(manager.retryWorkflow(prepared.draftId, failed.workflowRevision))
      .resolves.toMatchObject({ productionState: "authoring" });
    expect(promptCount(calls)).toBe(promptsBefore + 1);
    await manager.dispose();
  });

  it("rejects stale resume clicks without extra prompts or mutation", async () => {
    const { manager, calls } = await activeManagerForTest();
    const draft = await manager.createDraft("Resume trùng lặp");
    await manager.activate(draft.id, "internal-key");
    const collecting = await manager.prepareAssets(draft.id, draft.workflowRevision);
    const paused = await manager.pauseWorkflow(draft.id, collecting.workflowRevision);

    const promptsBefore = promptCount(calls);
    const resumed = await manager.resumeWorkflow(draft.id, paused.workflowRevision);
    expect(resumed).toMatchObject({ productionState: "collecting_assets", workflowRevision: paused.workflowRevision + 1 });
    await expect(manager.resumeWorkflow(draft.id, paused.workflowRevision)).rejects.toThrow(/thay đổi/);
    expect(promptCount(calls)).toBe(promptsBefore + 1);
    await expect(manager.status(draft.id)).resolves.toMatchObject({
      productionState: "collecting_assets",
      workflowRevision: resumed.workflowRevision,
    });
    await manager.dispose();
  });

  it("returns a failed pre-project draft to discovery and preserves session, files, and selection", async () => {
    const failGate = { fail: false };
    const { manager, calls, draft, draftRoot, assets } = await prepareBriefDispatchDraft(failGate);
    failGate.fail = true;
    const failed = await manager.approveAssets(draft.id, assets.workflowRevision, ["asset-01"]);
    expect(failed.productionState).toBe("error");
    const metadataBefore = JSON.parse(await readFile(join(draftRoot, "motionreal-agent.json"), "utf8")) as Record<string, unknown>;
    const briefRequestBefore = await readFile(join(draftRoot, "handoff", "brief-request.json"), "utf8");
    const promptsBefore = promptCount(calls);

    const returned = await manager.returnToDiscovery(draft.id, failed.workflowRevision);

    expect(returned).toMatchObject({ productionState: "discovery" });
    expect(returned).not.toHaveProperty("activeJobId");
    expect(returned).not.toHaveProperty("lastError");
    expect(returned).not.toHaveProperty("failedPhase");
    expect(returned).toMatchObject({ sessionId: metadataBefore.sessionId, selectedAssetIds: ["asset-01"] });
    expect(promptCount(calls)).toBe(promptsBefore);
    // Approved artifacts and files survive the return.
    await expect(readFile(join(draftRoot, "handoff", "assets.json"), "utf8")).resolves.toContain("asset-01");
    await expect(readFile(join(draftRoot, "handoff", "brief-request.json"), "utf8")).resolves.toBe(briefRequestBefore);
    // A late callback for the failed attempt cannot advance the returned draft.
    const internal = manager as unknown as {
      requestAuthoringRepair(record: object, message: string): Promise<void>;
    };
    await internal.requestAuthoringRepair({ id: draft.id, ...metadataBefore }, "late validation failed");
    expect(promptCount(calls)).toBe(promptsBefore);
    await expect(manager.status(draft.id)).resolves.toMatchObject({ productionState: "discovery" });
    // Discovery hands back into the normal funnel with a fresh job.
    failGate.fail = false;
    const again = await manager.prepareAssets(draft.id, returned.workflowRevision);
    expect(again).toMatchObject({ productionState: "collecting_assets" });
    expect(again.activeJobId).not.toBe(metadataBefore.activeJobId);
    await manager.dispose();
  });

  it("rejects returnToDiscovery for stale revisions, live states, and linked projects without mutation", async () => {
    const failGate = { fail: false };
    const rejectCalls: Array<{ method: string; payload: unknown }> = [];
    const { manager, root } = await activeManagerForTest({ fetch: promptGatedFetch(failGate, rejectCalls) });
    const draft = await manager.createDraft("Quay lại trao đổi bị từ chối");
    await manager.activate(draft.id, "internal-key");
    const collecting = await manager.prepareAssets(draft.id, 0);
    const draftRoot = join(root, draft.id);
    const metadataPath = join(draftRoot, "motionreal-agent.json");
    const liveBytes = await readFile(metadataPath, "utf8");

    // Live (non-error) state rejects.
    await expect(manager.returnToDiscovery(draft.id, collecting.workflowRevision)).rejects.toThrow(/báo lỗi/);
    expect(await readFile(metadataPath, "utf8")).toBe(liveBytes);

    // Linked-project error rejects without detaching the project.
    const linked = await prepareLinkedAuthoringDraft(manager, root, "job-linked-reject", "project-linked-reject");
    const linkedMetadataPath = join(linked.draftRoot, "motionreal-agent.json");
    const linkedBefore = await manager.transitionWorkflow(linked.draftId, {
      expectedRevision: (await manager.status(linked.draftId)).workflowRevision,
      to: "error",
      jobId: "job-linked-reject",
      error: "authoring exploded",
    });
    const linkedBytes = await readFile(linkedMetadataPath, "utf8");
    await expect(manager.returnToDiscovery(linked.draftId, linkedBefore.workflowRevision)).rejects.toThrow(/project/);
    expect(await readFile(linkedMetadataPath, "utf8")).toBe(linkedBytes);

    // Stale revision rejects without mutation.
    const briefCalls: Array<{ method: string; payload: unknown }> = [];
    const { manager: briefManager, root: briefRoot } = await activeManagerForTest({ fetch: promptGatedFetch(failGate, briefCalls) });
    const briefDraft = await briefManager.createDraft("Brief lỗi stale");
    await briefManager.activate(briefDraft.id, "internal-key");
    const briefCollecting = await briefManager.prepareAssets(briefDraft.id, 0);
    const briefDraftRoot = join(briefRoot, briefDraft.id);
    await writeFile(join(briefDraftRoot, "assets", "one.png"), ONE_PIXEL_PNG);
    await writeFile(join(briefDraftRoot, "handoff", "assets.json"), JSON.stringify({
      version: 1,
      job_id: briefCollecting.activeJobId,
      request_revision: 1,
      items: [{ id: "asset-01", path: "assets/one.png", source_url: "https://example.com/one.png" }],
    }));
    const briefAssets = await briefManager.status(briefDraft.id);
    failGate.fail = true;
    const briefFailed = await briefManager.approveAssets(briefDraft.id, briefAssets.workflowRevision, ["asset-01"]);
    expect(briefFailed.productionState).toBe("error");
    const failedBytes = await readFile(join(briefDraftRoot, "motionreal-agent.json"), "utf8");
    await expect(briefManager.returnToDiscovery(briefDraft.id, briefFailed.workflowRevision - 1)).rejects.toThrow(/thay đổi/);
    expect(await readFile(join(briefDraftRoot, "motionreal-agent.json"), "utf8")).toBe(failedBytes);
    // The valid revision still works afterwards (no fence consumed).
    await expect(briefManager.returnToDiscovery(briefDraft.id, briefFailed.workflowRevision))
      .resolves.toMatchObject({ productionState: "discovery" });
    await manager.dispose();
    await briefManager.dispose();
  });
});

describe("Task 3 — planner evidence and advisories", () => {
  const LAYOUT_ADVISORY = {
    check: "layout-diversity" as const,
    severity: "advisory" as const,
    message: "plans with 3+ scenes should use at least 2 layout families",
  };

  async function preparePlanningInputsDraft(jobId: string, projectId: string) {
    let plannedInput: AuthorInput | undefined;
    const planAuthoringContent = vi.fn(async (_projectId: string, input: AuthorInput, _signal: AbortSignal) => {
      plannedInput = input;
      return { contentPlan: TEST_CONTENT_PLAN, advisories: [] };
    });
    const { manager, root } = await activeManagerForTest({ planAuthoringContent });
    const prepared = await prepareLinkedAuthoringDraft(manager, root, jobId, projectId);
    const metadataPath = join(prepared.draftRoot, "motionreal-agent.json");
    await writeFile(metadataPath, JSON.stringify({
      ...JSON.parse(await readFile(metadataPath, "utf8")),
      assetRequestRevision: 1,
      selectedAssetIds: ["asset-01"],
    }));
    await writeFile(join(prepared.draftRoot, "handoff", "brief.json"), JSON.stringify({
      version: 1, accepted: true, job_id: jobId, request_revision: 1, brief_revision: 1,
      title: "Planner inputs",
      prompt: "Giải thích chủ đề. Đọc thêm tại https://example.com/article để lấy bối cảnh.",
      format: "tiktok", duration_tier: 2, target_seconds: 90, video_language: "vi", voice_provider: "vivibe",
      asset_strategy: "visualize-first", selected_asset_ids: ["asset-01"],
    }));
    await writeFile(join(prepared.draftRoot, "assets", "one.png"), ONE_PIXEL_PNG);
    await writeFile(join(prepared.draftRoot, "assets", "two.png"), ONE_PIXEL_PNG);
    await writeFile(join(prepared.draftRoot, "handoff", "assets.json"), JSON.stringify({
      version: 1, job_id: jobId, request_revision: 1,
      items: [
        { id: "asset-01", path: "assets/one.png", source_url: "https://example.com/one.png", role: "support" },
        { id: "asset-02", path: "assets/two.png", source_url: "https://example.com/two.png", role: "support" },
      ],
    }));
    await mkdir(join(prepared.projectRoot, "assets"), { recursive: true });
    await writeFile(join(prepared.projectRoot, "assets", "plan.png"), ONE_PIXEL_PNG);
    return { manager, root, planAuthoringContent, plannedInput: () => plannedInput, ...prepared };
  }

  it("passes brief URLs, approved image refs, and asset strategy into planning", async () => {
    const prepared = await preparePlanningInputsDraft("job-plan-inputs", "project-plan-inputs");

    await prepared.manager.startAuthoring(prepared.draftId, "project-plan-inputs", prepared.projectRoot, [
      { id: "asset-01", ref: "assets/plan.png", role: "support" },
    ]);

    expect(prepared.planAuthoringContent).toHaveBeenCalledTimes(1);
    const input = prepared.plannedInput();
    expect(input?.urls).toEqual(["https://example.com/article"]);
    expect(input?.assetStrategy).toBe("visualize-first");
    // Only the approved asset enters the planner pool with its project ref.
    expect(input?.images).toEqual([{ ref: "assets/plan.png", width: 1, height: 1 }]);
    await prepared.manager.dispose();
  });

  it("persists planner advisories into the content-plan artifact and authoring request", async () => {
    const planAuthoringContent = vi.fn(async () => ({ contentPlan: TEST_CONTENT_PLAN, advisories: [LAYOUT_ADVISORY] }));
    const { manager, root } = await activeManagerForTest({ planAuthoringContent });
    const prepared = await prepareLinkedAuthoringDraft(manager, root, "job-plan-advisory", "project-plan-advisory");

    await manager.startAuthoring(prepared.draftId, "project-plan-advisory", prepared.projectRoot, []);

    const artifact = JSON.parse(await readFile(join(prepared.draftRoot, "handoff", "content-plan.json"), "utf8"));
    expect(artifact).toMatchObject({ content_plan: TEST_CONTENT_PLAN, advisories: [LAYOUT_ADVISORY] });
    const request = JSON.parse(await readFile(join(prepared.draftRoot, "handoff", "authoring-request.json"), "utf8"));
    expect(request.content_plan_advisories).toEqual([LAYOUT_ADVISORY]);
    const instructions = (request.instructions as string[]).join("\n");
    expect(instructions).toContain("CONTENT PLAN ADVISORIES");
    expect(instructions).toContain("at least 2 layout families");
    await manager.dispose();
  });

  it("treats legacy plan artifacts without advisories as empty", async () => {
    const planAuthoringContent = vi.fn(async () => ({ contentPlan: TEST_CONTENT_PLAN, advisories: [] }));
    const { manager, root } = await activeManagerForTest({ planAuthoringContent });
    const prepared = await prepareLinkedAuthoringDraft(manager, root, "job-plan-legacy", "project-plan-legacy");
    await writeFile(join(prepared.draftRoot, "handoff", "content-plan.json"), JSON.stringify({
      version: 1,
      job_id: "job-plan-legacy",
      request_revision: 1,
      content_plan: TEST_CONTENT_PLAN,
    }));

    await manager.startAuthoring(prepared.draftId, "project-plan-legacy", prepared.projectRoot, []);

    expect(planAuthoringContent).not.toHaveBeenCalled();
    const request = JSON.parse(await readFile(join(prepared.draftRoot, "handoff", "authoring-request.json"), "utf8"));
    expect(request).toMatchObject({ planning: false, content_plan: TEST_CONTENT_PLAN });
    expect(request.content_plan_advisories ?? []).toEqual([]);
    expect((request.instructions as string[]).join("\n")).not.toContain("CONTENT PLAN ADVISORIES");
    await manager.dispose();
  });

  it("keeps advisories through planner retry", async () => {
    const planAuthoringContent = vi.fn()
      .mockRejectedValueOnce(new Error("planner unavailable"))
      .mockResolvedValue({ contentPlan: TEST_CONTENT_PLAN, advisories: [LAYOUT_ADVISORY] });
    const { manager, root } = await activeManagerForTest({ planAuthoringContent });
    const prepared = await prepareLinkedAuthoringDraft(manager, root, "job-plan-advisory-retry", "project-plan-advisory-retry");

    await expect(manager.startAuthoring(prepared.draftId, "project-plan-advisory-retry", prepared.projectRoot, []))
      .rejects.toThrow("planner unavailable");
    const failed = await manager.status(prepared.draftId);
    await expect(manager.retryWorkflow(prepared.draftId, failed.workflowRevision))
      .resolves.toMatchObject({ productionState: "authoring" });

    const artifact = JSON.parse(await readFile(join(prepared.draftRoot, "handoff", "content-plan.json"), "utf8"));
    expect(artifact).toMatchObject({ advisories: [LAYOUT_ADVISORY] });
    const request = JSON.parse(await readFile(join(prepared.draftRoot, "handoff", "authoring-request.json"), "utf8"));
    expect(request.content_plan_advisories).toEqual([LAYOUT_ADVISORY]);
    expect((request.instructions as string[]).join("\n")).toContain("at least 2 layout families");
    await manager.dispose();
  });
});

describe("chunked visual refine", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `scene-${String(i + 1).padStart(2, "0")}`);

  it("slices scenes into sequential 4-6 scene chunks", () => {
    expect(planReviewChunks({ sceneIds: ids(3) })).toEqual([ids(3)]);
    expect(planReviewChunks({ sceneIds: ids(5) })).toEqual([ids(5)]);
    expect(planReviewChunks({ sceneIds: ids(15) })).toEqual([ids(5), ids(10).slice(5), ids(15).slice(10)]);
    expect(planReviewChunks({ sceneIds: ids(7) })).toEqual([ids(5), ids(7).slice(5)]);
    expect(planReviewChunks({ sceneIds: [] })).toEqual([]);
    expect(planReviewChunks({ sceneIds: ids(6), maxScenes: Number.NaN })).toEqual([ids(5), ids(6).slice(5)]);
  });

  it("waives text mention requirement when scene_verdicts cover the reviewed scope", () => {
    const scope = ["scene-01", "scene-02"];
    const verdicts = [
      { scene_id: "scene-01", verdict: "clean" as const },
      { scene_id: "scene-02", verdict: "clean" as const },
    ];
    // Notes only mentions presentationProfile; scene_verdicts cover the scenes.
    expect(reviewNotesIssues("Tốt theo presentationProfile mechanism-explainer.", scope, "mechanism-explainer", verdicts)).toEqual([]);
    // Missing presentationProfile still flags profile issue even if scenes are covered.
    expect(reviewNotesIssues("Tốt.", scope, "mechanism-explainer", verdicts)).toEqual([
      "phải nêu rõ đánh giá theo presentationProfile mechanism-explainer.",
    ]);
    // Without verdicts covering scene-02, missing mention is reported.
    expect(reviewNotesIssues("Cảnh 1 tốt theo mechanism-explainer.", scope, "mechanism-explainer", [verdicts[0]!])).toEqual([
      "thiếu đánh giá cho: scene-02.",
    ]);
  });

  it("reviews advisory-targeted scenes first in narrative order", () => {
    const chunks = planReviewChunks({
      sceneIds: ids(8),
      advisorySceneIds: ["scene-07", "scene-03", "scene-99", "scene-03"],
    });
    expect(chunks[0]).toEqual(["scene-03", "scene-07"]);
    expect(chunks.slice(1).flat()).toEqual(["scene-01", "scene-02", "scene-04", "scene-05", "scene-06", "scene-08"]);
    expect(chunks.slice(1).every((chunk) => chunk.length <= 5)).toBe(true);
  });

  it("assigns each boundary transition to exactly one chunk", () => {
    const all = ids(6);
    const artifacts = [
      { path: "project/review/evidence/overview-01.png", kind: "overview", sceneIds: all },
      ...all.map((id) => ({ path: `project/review/evidence/${id}.motion.png`, kind: "cue-filmstrip", sceneIds: [id] })),
      { path: "project/review/evidence/scene-02.detail.png", kind: "detail", sceneIds: ["scene-02"] },
      { path: "project/review/evidence/scene-03-to-scene-04.transition.png", kind: "transition", sceneIds: ["scene-03", "scene-04"] },
      { path: "project/review/evidence/scene-05-to-scene-06.transition.png", kind: "transition", sceneIds: ["scene-05", "scene-06"] },
    ] as ReviewArtifact[];
    const first = artifactsForReviewChunk(artifacts, ["scene-01", "scene-02", "scene-03"], all);
    const second = artifactsForReviewChunk(artifacts, ["scene-04", "scene-05", "scene-06"], all);
    // Shared overview is visible to both chunks; boundary transitions belong to the later chunk only.
    expect(first.map((a) => a.path)).toContain("project/review/evidence/overview-01.png");
    expect(second.map((a) => a.path)).toContain("project/review/evidence/overview-01.png");
    expect(first.map((a) => a.path)).not.toContain("project/review/evidence/scene-03-to-scene-04.transition.png");
    expect(second.map((a) => a.path)).toContain("project/review/evidence/scene-03-to-scene-04.transition.png");
    expect(second.map((a) => a.path)).toContain("project/review/evidence/scene-05-to-scene-06.transition.png");
    expect(first.map((a) => a.path)).not.toContain("project/review/evidence/scene-04.motion.png");
    // Full coverage with no transition duplicated.
    const transitions = [...first, ...second].filter((a) => a.kind === "transition").map((a) => a.path);
    expect([...new Set(transitions)]).toHaveLength(transitions.length);
    expect(transitions).toHaveLength(2);
  });

  it("sweeps a 7-scene video in two chunks and finishes only after the last", async () => {
    const sceneIds = ids(7);
    const plannedNarration = "một hai ba bốn năm sáu bảy tám chín mười mười một mười hai mười ba";
    const stills: string[] = [];
    const evidence: Record<string, string> = {};
    const renderAuthoringStills = vi.fn(async (_projectId: string, renderIds: string[], reviewRequest?: AuthoringReviewRequest) => {
      const scope = reviewRequest ? [...reviewRequest.reviewSceneIds, ...reviewRequest.contextSceneIds] : renderIds;
      const artifacts: ReviewArtifact[] = [];
      for (let offset = 0; offset < scope.length; offset += 6) {
        const group = scope.slice(offset, offset + 6);
        artifacts.push({
          path: evidence[`overview-${offset / 6 + 1}`]!,
          kind: "overview",
          sceneIds: group,
          panels: group.map((sceneId, index) => ({ index, sceneId, sample: "overview" as const })),
        });
      }
      for (const sceneId of reviewRequest?.scenes.filter((s) => s.temporalMode !== "static").map((s) => s.sceneId) ?? []) {
        artifacts.push({
          path: evidence[`${sceneId}.motion`]!,
          kind: "cue-filmstrip" as const,
          sceneIds: [sceneId],
          panels: [
            { index: 0, sceneId, sample: "initial" as const },
            { index: 1, sceneId, sample: "after-cue" as const, cueId: "step-one" },
            { index: 2, sceneId, sample: "after-cue" as const, cueId: "step-two" },
          ],
        });
      }
      return {
        ok: true as const,
        stills: renderIds.map((id) => stills.find((path) => path.endsWith(`${id}.png`))!),
        reviewArtifacts: artifacts,
      };
    });
    const acceptAuthoringStills = vi.fn(async () => undefined);
    const { manager, root, history } = await activeManagerForTest({
      renderAuthoringStills,
      acceptAuthoringStills,
      authoringRefinePolicy: async () => ({ refinePasses: 1, refineEarlyStop: true }),
      wordsPerSecond: async () => 1,
      planAuthoringContent: async () => ({
        contentPlan: {
          ...TEST_CONTENT_PLAN,
          scenes: sceneIds.map((sceneId) => ({
            ...TEST_CONTENT_PLAN.scenes[0]!,
            sceneId,
            narration: plannedNarration,
            temporalMode: sceneId === "scene-02" || sceneId === "scene-06" ? "stepped" as const : "static" as const,
            detailMode: "normal" as const,
            motionBeats: undefined,
            ...(["scene-02", "scene-06"].includes(sceneId) ? {
              motionProgression: "Quick entrance; semantic: reveal step one, then step two; final hold.",
              motionBeats: [
                { id: "step-one", anchor: "một hai", action: "Reveal step one" },
                { id: "step-two", anchor: "sáu bảy", action: "Reveal step two" },
              ],
            } : {}),
          })),
        },
        advisories: [],
      }),
    });
    const draft = await manager.createDraft("Review theo chunk");
    await manager.activate(draft.id, "internal-key");
    let state = await manager.transitionWorkflow(draft.id, { expectedRevision: 0, to: "collecting_assets", jobId: "job-chunks" });
    state = await manager.transitionWorkflow(draft.id, { expectedRevision: state.workflowRevision, to: "asset_review", jobId: "job-chunks" });
    state = await manager.transitionWorkflow(draft.id, { expectedRevision: state.workflowRevision, to: "brief_review", jobId: "job-chunks" });
    state = await manager.transitionWorkflow(draft.id, { expectedRevision: state.workflowRevision, to: "queued_create", jobId: "job-chunks" });
    const draftRoot = join(root, draft.id);
    const metadataPath = join(draftRoot, "motionreal-agent.json");
    await writeFile(metadataPath, JSON.stringify({ ...JSON.parse(await readFile(metadataPath, "utf8")), briefRequestRevision: 1 }));
    await mkdir(join(draftRoot, "handoff"), { recursive: true });
    await writeFile(join(draftRoot, "handoff", "brief.json"), JSON.stringify({
      version: 1, accepted: true, job_id: "job-chunks", request_revision: 1, brief_revision: 1,
      title: "Chunks", prompt: "Nội dung đủ dài cho bài kiểm tra review visual theo từng chunk nhỏ.",
      format: "tiktok", duration_tier: 1, target_seconds: 45, video_language: "vi", voice_provider: "vivibe", selected_asset_ids: [],
    }));
    await manager.linkProject(draft.id, "project-chunks");
    const projectRoot = join(root, "projects", "project-chunks");
    await mkdir(join(projectRoot, "authored"), { recursive: true });
    await mkdir(join(projectRoot, "review"), { recursive: true });
    stills.push(...sceneIds.map((id) => join(projectRoot, "review", `${id}.png`)));
    await mkdir(join(projectRoot, "review", "evidence"), { recursive: true });
    evidence["overview-1"] = join(projectRoot, "review", "evidence", "overview-01.png");
    evidence["overview-2"] = join(projectRoot, "review", "evidence", "overview-02.png");
    evidence["scene-02.motion"] = join(projectRoot, "review", "evidence", "scene-02.motion.png");
    evidence["scene-06.motion"] = join(projectRoot, "review", "evidence", "scene-06.motion.png");
    await Promise.all(stills.map((path) => writeFile(path, ONE_PIXEL_PNG)));
    await Promise.all(Object.values(evidence).map((path) => writeFile(path, REVIEW_EVIDENCE_PNG)));

    await manager.startAuthoring(draft.id, "project-chunks", projectRoot, []);
    await writeFile(join(projectRoot, "manifest.json"), JSON.stringify({
      title: "Chunks", durationTier: 1, videoLanguage: "vi",
      scenes: sceneIds.map((id, index) => ({
        id, component: id, headline: id, narration: plannedNarration,
        ...(index < sceneIds.length - 1 ? { transitionToNext: "fade" } : {}),
      })),
    }));
    await Promise.all(sceneIds.map((id) => writeFile(join(projectRoot, "authored", `${id}.tsx`), registeredSceneSource(id, "chunks"))));
    await writeJson(join(draftRoot, "handoff", "authoring.json"), {
      version: 1, job_id: "job-chunks", request_revision: 1, scene_ids: sceneIds, used_asset_ids: [],
    });

    // Chunk 0 covers scenes 01-05 only.
    await vi.waitFor(async () => {
      const request = JSON.parse(await readFile(join(draftRoot, "handoff", "authoring-request.json"), "utf8"));
      expect(request).toMatchObject({
        request_revision: 2, phase: "visual_refine", visual_refine_pass: 1,
        review_scene_ids: sceneIds.slice(0, 5), review_chunk_index: 0,
      });
      expect(request.review_chunks).toEqual([sceneIds.slice(0, 5), sceneIds.slice(5)]);
      expect(request.stills.map((p: string) => p.split("/").at(-1)).sort()).toEqual(
        ["overview-01.png", "scene-02.motion.png"].sort(),
      );
    }, { timeout: 3_000 });
    expect(renderAuthoringStills).toHaveBeenCalledTimes(1);

    const pushReads = (files: string[]) => {
      for (const file of files) {
        const callId = `read-${history.length}`;
        history.push({ event: { seq: history.length, type: "tool/call", data: { callId, name: "read_image", arguments: JSON.stringify({ file_path: `project/review/evidence/${file}` }) } } });
        history.push({ event: { seq: history.length, type: "tool/result", data: { message: { content: [{
          type: "tool-result", toolCallId: callId, isError: false,
          content: [{ type: "image", attachment: { attachmentId: callId, mediaType: "image/png", bytes: 68, width: 1, height: 1 } }],
        }] } } } });
      }
      history.push({ event: { seq: history.length, type: "assistant/message", data: { message: { content: [{ type: "text", text: "Đã xem still chunk hiện tại." }] } } } });
    };
    pushReads(["overview-01.png", "scene-02.motion.png"]);
    // Notes without scene coverage are repaired, not accepted.
    await writeJson(join(draftRoot, "handoff", "authoring.json"), {
      version: 1, job_id: "job-chunks", request_revision: 2, scene_ids: sceneIds, used_asset_ids: [],
      reviewed_scene_ids: sceneIds.slice(0, 5), review_notes: "Ảnh sạch.",
    });
    await vi.waitFor(async () => {
      const request = JSON.parse(await readFile(join(draftRoot, "handoff", "authoring-request.json"), "utf8"));
      expect(request).toMatchObject({ request_revision: 3 });
      expect(String(request.render_error)).toMatch(/scene-01/);
    }, { timeout: 3_000 });

    pushReads(["overview-01.png", "scene-02.motion.png"]);
    await writeJson(join(draftRoot, "handoff", "authoring.json"), {
      version: 1, job_id: "job-chunks", request_revision: 3, scene_ids: sceneIds, used_asset_ids: [],
      reviewed_scene_ids: sceneIds.slice(0, 5),
      review_notes: "scene-01: clean; scene-02: clean; scene-03: clean; scene-04: clean; scene-05: clean — mechanism-explainer khớp, motion đúng beats.",
    });
    // Chunk 1 reuses the shared overview and finishes the sweep.
    await vi.waitFor(async () => {
      const request = JSON.parse(await readFile(join(draftRoot, "handoff", "authoring-request.json"), "utf8"));
      expect(request).toMatchObject({
        request_revision: 4, phase: "visual_refine", review_scene_ids: sceneIds.slice(5), review_chunk_index: 1,
      });
      expect(request.stills.map((p: string) => p.split("/").at(-1)).sort()).toEqual(
        ["overview-01.png", "overview-02.png", "scene-06.motion.png"].sort(),
      );
    }, { timeout: 3_000 });
    expect(renderAuthoringStills).toHaveBeenCalledTimes(1);

    pushReads(["overview-01.png", "overview-02.png", "scene-06.motion.png"]);
    await writeJson(join(draftRoot, "handoff", "authoring.json"), {
      version: 1, job_id: "job-chunks", request_revision: 4, scene_ids: sceneIds, used_asset_ids: [],
      reviewed_scene_ids: sceneIds.slice(5),
      review_notes: "scene-06: clean; scene-07: clean — mechanism-explainer khớp, không có lỗi trực quan cần sửa.",
    });
    await vi.waitFor(() => expect(acceptAuthoringStills).toHaveBeenCalledWith("project-chunks"), { timeout: 3_000 });
    await vi.waitFor(async () => {
      await expect(manager.status(draft.id)).resolves.toMatchObject({ productionState: "scene_review" });
    }, { timeout: 3_000 });
    await manager.dispose();
  });

  it("resumes a paused chunked review with chunk progress in the prompt", async () => {
    const { manager, root, calls } = await activeManagerForTest();
    const draft = await manager.createDraft("Resume chunk");
    await manager.activate(draft.id, "internal-key");
    let state = await manager.transitionWorkflow(draft.id, { expectedRevision: 0, to: "collecting_assets", jobId: "job-chunk-resume" });
    state = await manager.transitionWorkflow(draft.id, { expectedRevision: state.workflowRevision, to: "asset_review", jobId: "job-chunk-resume" });
    state = await manager.transitionWorkflow(draft.id, { expectedRevision: state.workflowRevision, to: "brief_review", jobId: "job-chunk-resume" });
    state = await manager.transitionWorkflow(draft.id, { expectedRevision: state.workflowRevision, to: "queued_create", jobId: "job-chunk-resume" });
    await manager.transitionWorkflow(draft.id, { expectedRevision: state.workflowRevision, to: "authoring", jobId: "job-chunk-resume" });
    const draftRoot = join(root, draft.id);
    const metadataPath = join(draftRoot, "motionreal-agent.json");
    await writeFile(metadataPath, JSON.stringify({
      ...JSON.parse(await readFile(metadataPath, "utf8")),
      productionState: "paused",
      pausedFrom: "visual_refine",
      projectId: "project-chunk-resume",
    }));
    await mkdir(join(draftRoot, "handoff"), { recursive: true });
    await writeFile(join(draftRoot, "handoff", "authoring-request.json"), JSON.stringify({
      version: 1, job_id: "job-chunk-resume", request_revision: 2, phase: "visual_refine",
      review_scene_ids: ["scene-06", "scene-07"],
      review_chunks: [["scene-01", "scene-02", "scene-03", "scene-04", "scene-05"], ["scene-06", "scene-07"]],
      review_chunk_index: 1,
    }));
    const paused = await manager.status(draft.id);
    expect(paused.productionState).toBe("paused");

    await manager.resumeWorkflow(draft.id, paused.workflowRevision);
    const prompts = calls.filter((call) => call.method === "session.prompt");
    expect(prompts).toHaveLength(1);
    expect(JSON.stringify(prompts[0]!.payload)).toContain("chunk 2/2");
    await manager.dispose();
  });
});
