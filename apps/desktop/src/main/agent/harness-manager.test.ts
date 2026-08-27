import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HarnessManager } from "./harness-manager.js";

const roots: string[] = [];

async function managerForTest(): Promise<{ manager: HarnessManager; root: string }> {
  const root = await mkdtemp(join(tmpdir(), "motionreal-agent-"));
  roots.push(root);
  return {
    root,
    manager: new HarnessManager({
      draftsRoot: root,
      harnessHome: join(root, "harness"),
      harnessCliPath: join(root, "missing-harness.js"),
      mediaUrl: (path) => `media://${path}`,
    }),
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function activeManagerForTest(): Promise<{
  manager: HarnessManager;
  root: string;
  calls: Array<{ method: string; payload: unknown }>;
}> {
  const root = await mkdtemp(join(tmpdir(), "motionreal-agent-active-"));
  roots.push(root);
  const cli = join(root, "dsh.js");
  await writeFile(cli, "// test placeholder\n");
  const child = Object.assign(new EventEmitter(), { kill: vi.fn() });
  const calls: Array<{ method: string; payload: unknown }> = [];
  const manager = new HarnessManager({
    draftsRoot: root,
    harnessHome: join(root, "harness"),
    harnessCliPath: cli,
    findPort: async () => 39872,
    spawn: vi.fn(() => child) as unknown as typeof import("node:child_process").spawn,
    fetch: vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method: string; payload: unknown };
      calls.push(body);
      const value = body.method === "workspace.create" ? { workspace: { workspaceId: "workspace-assets" } } : {};
      return Response.json({ type: "server-response", result: { ok: true, value } });
    }) as unknown as typeof globalThis.fetch,
    mediaUrl: (path) => `media://${path}`,
  });
  return { manager, root, calls };
}

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

describe("HarnessManager draft lifecycle", () => {
  it("creates a video workspace with Harness instructions", async () => {
    const { manager, root } = await managerForTest();
    const draft = await manager.createDraft("Video về ChatGPT");
    const draftRoot = join(root, draft.id);

    expect(draft.title).toBe("Video về ChatGPT");
    await expect(readFile(join(draftRoot, "AI_CONTRACT.md"), "utf8")).resolves.toMatch(/isolated research workspace/);
    await expect(writeFile(join(draftRoot, "assets", "logo.png"), "image")).resolves.toBeUndefined();
    await expect(writeFile(join(draftRoot, "motionreal.create.json"), '{"version":1,"prompt":"Tạo video","images":["assets/logo.png"]}')).resolves.toBeUndefined();

    await expect(manager.readCreateRequest(draft.id)).rejects.toThrow(/duyệt brief/);
    expect((await manager.status(draft.id)).createReady).toBe(false);
  });

  it("persists workflow transitions and opens legacy records in discovery", async () => {
    const { manager, root } = await managerForTest();
    const draft = await manager.createDraft("Workflow bền vững");

    expect(draft).toMatchObject({
      workflowVersion: 1,
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
    expect(review.assetReview).toEqual([expect.objectContaining({ id: "asset-01", width: 1, height: 1 })]);
    await expect(manager.status(draft.id)).resolves.toMatchObject({ productionState: "asset_review", workflowRevision: 2 });
    expect(calls.at(-1)).toMatchObject({
      method: "session.prompt",
      payload: { sessionId: expect.stringMatching(/^session-/), mode: "queue" },
    });

    const approved = await manager.approveAssets(draft.id, review.workflowRevision, ["asset-01"]);
    expect(approved).toMatchObject({ productionState: "brief_review", selectedAssetIds: ["asset-01"] });
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
      mediaUrl: (path) => `media://${path}`,
    });
    await expect(reopened.status(draft.id)).resolves.toMatchObject({ selectedAssetIds: ["asset-01"] });
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

    await writeFile(requestFile, '{"version":1,"prompt":"x","images":["../secret.png"]}');
    await expect(manager.readCreateRequest(draft.id)).rejects.toThrow(/workspace/);

    await writeFile(requestFile, '{"version":1,"prompt":"x","images":[".harness/sessions/a.png"]}');
    await expect(manager.readCreateRequest(draft.id)).rejects.toThrow(/workspace/);
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
      "workspace.create",
      "workspace.rename",
      "session.create",
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
    const child = Object.assign(new EventEmitter(), { kill: vi.fn() });
    const methods: string[] = [];
    const manager = new HarnessManager({
      draftsRoot: root,
      harnessHome: join(root, "harness"),
      harnessCliPath: cli,
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
      "workspace.create", "workspace.rename", "session.create",
      "workspace.create", "workspace.rename", "session.create",
    ]);
    await manager.dispose();
  });

  it("uses a real Node executable instead of Electron run-as-node", async () => {
    const root = await mkdtemp(join(tmpdir(), "motionreal-agent-"));
    roots.push(root);
    const cli = join(root, "dsh.js");
    await writeFile(cli, "// test placeholder\n");
    const child = Object.assign(new EventEmitter(), { kill: vi.fn() });
    const spawnChild = vi.fn(() => child) as unknown as typeof import("node:child_process").spawn;
    const manager = new HarnessManager({
      draftsRoot: root,
      harnessHome: join(root, "harness"),
      harnessCliPath: cli,
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
      [cli, "web", "--host", "127.0.0.1", "--port", "39874", "--no-open"],
      expect.objectContaining({
        cwd: root,
        stdio: ["ignore", "ignore", "pipe"],
        env: expect.objectContaining({ NINEROUTER_API_KEY: "internal-key" }),
      }),
    );
    const options = vi.mocked(spawnChild).mock.calls[0]?.[2];
    expect(options?.env).not.toHaveProperty("ELECTRON_RUN_AS_NODE");
    await manager.dispose();
  });

  it("reports an early Harness dependency failure instead of waiting for a timeout", async () => {
    const root = await mkdtemp(join(tmpdir(), "motionreal-agent-"));
    roots.push(root);
    const cli = join(root, "dsh.js");
    await writeFile(cli, "// test placeholder\n");
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
