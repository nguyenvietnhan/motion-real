import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
    manager: new HarnessManager({ draftsRoot: root, harnessCliPath: join(root, "missing-harness.js") }),
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("HarnessManager draft lifecycle", () => {
  it("creates an isolated per-video home with Harness instructions and runtime config", async () => {
    const { manager, root } = await managerForTest();
    const draft = await manager.createDraft("Video về ChatGPT");
    const draftRoot = join(root, draft.id);

    expect(draft.title).toBe("Video về ChatGPT");
    await expect(writeFile(join(draftRoot, "assets", "logo.png"), "image")).resolves.toBeUndefined();
    await expect(writeFile(join(draftRoot, "motionreal.create.json"), '{"version":1,"prompt":"Tạo video","images":["assets/logo.png"]}')).resolves.toBeUndefined();

    const request = await manager.readCreateRequest(draft.id);
    expect(request.prompt).toBe("Tạo video");
    expect(request.imagePaths).toEqual([join(draftRoot, "assets", "logo.png")]);
    expect((await manager.status(draft.id)).createReady).toBe(true);
  });

  it("refuses a create request that reaches outside the video workspace or into Harness history", async () => {
    const { manager, root } = await managerForTest();
    const draft = await manager.createDraft("An toàn đường dẫn");
    const requestFile = join(root, draft.id, "motionreal.create.json");

    await writeFile(requestFile, '{"version":1,"prompt":"x","images":["../secret.png"]}');
    await expect(manager.readCreateRequest(draft.id)).rejects.toThrow(/workspace/);

    await writeFile(requestFile, '{"version":1,"prompt":"x","images":[".harness/sessions/a.png"]}');
    await expect(manager.readCreateRequest(draft.id)).rejects.toThrow(/workspace/);
  });

  it("removes the complete isolated Harness home when the draft is removed", async () => {
    const { manager, root } = await managerForTest();
    const draft = await manager.createDraft("Xóa toàn bộ");
    await writeFile(join(root, draft.id, ".harness", "sessions-note.txt"), "history");

    await manager.removeDraft(draft.id);
    expect(await manager.list()).toEqual([]);
  });

  it("starts one Harness against its isolated home, then adopts and names the workspace through the real RPC shape", async () => {
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
    const manager = new HarnessManager({
      draftsRoot: root,
      harnessCliPath: cli,
      fetch: fakeFetch,
      findPort: async () => 39876,
      spawn: vi.fn(() => child) as unknown as typeof import("node:child_process").spawn,
      processExecPath: "node",
    });
    const draft = await manager.createDraft("Video mới");

    const opened = await manager.activate(draft.id, "only-child-env");
    expect(opened.harnessUrl).toBe("http://127.0.0.1:39876/");
    expect(calls.slice(1).map((call) => JSON.parse(String(call.init?.body)).method)).toEqual([
      "workspace.create",
      "workspace.rename",
      "session.create",
    ]);
    expect(JSON.parse(String(calls[2]?.init?.body)).payload).toEqual({ workspaceId: "workspace-1", title: "Video mới" });
    await manager.dispose();
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it("keeps the prior Harness session on a later app launch instead of creating a blank replacement", async () => {
    const root = await mkdtemp(join(tmpdir(), "motionreal-agent-"));
    roots.push(root);
    const cli = join(root, "dsh.js");
    await writeFile(cli, "// test placeholder\n");
    const child = Object.assign(new EventEmitter(), { kill: vi.fn() });
    const methods: string[] = [];
    const manager = new HarnessManager({
      draftsRoot: root,
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
      processExecPath: "node",
    });
    const draft = await manager.createDraft("Giữ lịch sử");

    await manager.activate(draft.id, "only-child-env");
    expect(methods).toEqual(["workspace.create", "workspace.rename"]);
    await manager.dispose();
  });
});
