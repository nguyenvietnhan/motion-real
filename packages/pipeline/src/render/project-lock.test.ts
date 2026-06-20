import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureProject, projectPaths } from "../store/store.js";
import { PROJECT_RENDER_LOCK_STALE_MS, withProjectRenderLock } from "./project-lock.js";

let home: string;
const prevHome = process.env.VIDEO_TOOL_HOME;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "news-render-lock-"));
  process.env.VIDEO_TOOL_HOME = join(home, ".video-tool");
});

afterEach(async () => {
  process.env.VIDEO_TOOL_HOME = prevHome;
  await rm(home, { recursive: true, force: true });
});

describe("project render lock", () => {
  it("rejects a concurrent render for the same project in the same process", async () => {
    const projectId = "lock-00000001";
    await ensureProject(projectId);
    let entered!: () => void;
    let release!: () => void;
    const enteredLock = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const first = withProjectRenderLock(projectId, "draft", () => new Promise<string>((resolve) => {
      entered();
      release = () => resolve("first");
    }));
    await enteredLock;

    await expect(withProjectRenderLock(projectId, "full", async () => "second")).rejects.toMatchObject({ stage: "render-lock" });
    release();
    await expect(first).resolves.toBe("first");
    await expect(withProjectRenderLock(projectId, "full", async () => "after")).resolves.toBe("after");
  });

  it("breaks a stale/dead lock file and releases it after success", async () => {
    const projectId = "lock-00000002";
    await ensureProject(projectId);
    const lockPath = join(projectPaths(projectId).root, ".render.lock");
    await writeFile(lockPath, JSON.stringify({ pid: -1, startedAt: new Date().toISOString(), purpose: "draft" }), "utf8");

    await expect(withProjectRenderLock(projectId, "full", async () => "ok")).resolves.toBe("ok");
    expect(existsSync(lockPath)).toBe(false);
  });

  it("preserves and rejects an active lock owned by a live process", async () => {
    const projectId = "lock-00000005";
    await ensureProject(projectId);
    const lockPath = join(projectPaths(projectId).root, ".render.lock");
    await writeFile(
      lockPath,
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), purpose: "full", nonce: "active" }),
      "utf8",
    );

    await expect(withProjectRenderLock(projectId, "draft", async () => "nope")).rejects.toMatchObject({ stage: "render-lock" });
    expect(existsSync(lockPath)).toBe(true);
  });

  it("breaks an over-age lock file even when the pid still exists", async () => {
    const projectId = "lock-00000003";
    await ensureProject(projectId);
    const lockPath = join(projectPaths(projectId).root, ".render.lock");
    const old = new Date(Date.now() - PROJECT_RENDER_LOCK_STALE_MS - 1000).toISOString();
    await writeFile(lockPath, JSON.stringify({ pid: process.pid, startedAt: old, purpose: "stills" }), "utf8");

    await expect(withProjectRenderLock(projectId, "thumbnail", async () => "ok")).resolves.toBe("ok");
    expect(existsSync(lockPath)).toBe(false);
  });

  it("recovers an old malformed lock left by a crash during metadata write", async () => {
    const projectId = "lock-00000006";
    await ensureProject(projectId);
    const lockPath = join(projectPaths(projectId).root, ".render.lock");
    await writeFile(lockPath, "{", "utf8");
    const old = new Date(Date.now() - PROJECT_RENDER_LOCK_STALE_MS - 1000);
    await utimes(lockPath, old, old);

    await expect(withProjectRenderLock(projectId, "stills", async () => "ok")).resolves.toBe("ok");
    expect(existsSync(lockPath)).toBe(false);
  });

  it("releases the lock after the protected render throws", async () => {
    const projectId = "lock-00000004";
    await ensureProject(projectId);
    const lockPath = join(projectPaths(projectId).root, ".render.lock");

    await expect(withProjectRenderLock(projectId, "draft", async () => {
      throw new Error("boom");
    })).rejects.toThrow("boom");
    expect(existsSync(lockPath)).toBe(false);
    await expect(withProjectRenderLock(projectId, "draft", async () => "retry")).resolves.toBe("retry");
  });
});
