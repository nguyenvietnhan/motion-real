import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendEvent,
  createProjectId,
  ensureProject,
  listProjects,
  projectPaths,
  projectsRoot,
  pruneCacheDir,
  reconcileStaleStates,
  renderCacheDir,
  setState,
  ttsCacheDir,
  videoToolHome,
  writeBrief,
  writeJson,
} from "./store.js";
import type { ProjectBrief } from "../types.js";

let home: string;
const prevHome = process.env.VIDEO_TOOL_HOME;
const prevCwd = process.cwd();

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "news-store-"));
  process.env.VIDEO_TOOL_HOME = join(home, ".video-tool");
});

afterEach(async () => {
  process.env.VIDEO_TOOL_HOME = prevHome;
  process.chdir(prevCwd);
  await rm(home, { recursive: true, force: true });
});

function sampleBrief(projectId: string): ProjectBrief {
  return {
    projectId,
    prompt: "test prompt",
    duration: 60,
    styleId: "clean-luxury-tech",
    ratio: "9:16",
    language: "vi",
    aiProvider: "mock",
    tts: { provider: "none", speed: 1.0 },
    state: "planning",
    currentStep: "init",
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("project store", () => {
  it("creates ids that are filesystem-safe and slugged from the prompt", () => {
    const id = createProjectId("Vì sao chip AI đang đắt đỏ?");
    expect(id).toMatch(/^[a-z0-9-]+-[0-9a-f]{8}$/);
    expect(id.startsWith("vi-sao-chip-ai")).toBe(true);
    // Vietnamese diacritics are stripped, no spaces or punctuation remain.
    expect(id).not.toMatch(/[àáảãạăắ/?\s]/u);
  });

  it("derives the home under .video-tool and lays out the project tree", async () => {
    expect(videoToolHome().endsWith(".video-tool")).toBe(true);
    const id = "demo-12345678";
    await ensureProject(id);
    const p = projectPaths(id);
    for (const dir of [p.root, p.audioDir, p.rendersDir, p.reviewDir, p.logsDir, p.assetsDir]) {
      expect(existsSync(dir)).toBe(true);
    }
    // assetsDir is the project-relative image store (Phase 2 Block A).
    expect(p.assetsDir).toBe(join(p.root, "assets"));
    // The project lives under projects/, which lives under the .video-tool home.
    expect(p.root.startsWith(projectsRoot())).toBe(true);
    expect(projectsRoot().startsWith(videoToolHome())).toBe(true);
  });

  it("does not write anything to the repository root (cwd)", async () => {
    const sandboxCwd = await mkdtemp(join(tmpdir(), "news-cwd-"));
    process.chdir(sandboxCwd);
    process.env.VIDEO_TOOL_HOME = join(home, ".video-tool");
    const id = createProjectId("hello world");
    await ensureProject(id);
    await writeBrief(sampleBrief(id));
    await appendEvent(id, { type: "project.created" });
    // The sandbox cwd must remain empty: artifacts only go under VIDEO_TOOL_HOME.
    const { readdir } = await import("node:fs/promises");
    const cwdEntries = await readdir(sandboxCwd);
    expect(cwdEntries).toEqual([]);
    process.chdir(prevCwd);
    await rm(sandboxCwd, { recursive: true, force: true });
  });

  it("persists brief, updates state, and appends events", async () => {
    const id = "stateful-abcdef12";
    await ensureProject(id);
    await writeBrief(sampleBrief(id));
    const updated = await setState(id, { state: "planned", currentStep: "spec written" });
    expect(updated.state).toBe("planned");
    expect(updated.currentStep).toBe("spec written");

    await appendEvent(id, { type: "spec.created", scenes: 12 });
    await appendEvent(id, { type: "project.ready" });
    const events = (await readFile(projectPaths(id).events, "utf8")).trim().split("\n");
    expect(events).toHaveLength(2);
    expect(JSON.parse(events[0]!).type).toBe("spec.created");
    expect(JSON.parse(events[1]!).type).toBe("project.ready");
  });

  it("lists known projects newest-first", async () => {
    const a = "alpha-00000001";
    const b = "bravo-00000002";
    await ensureProject(a);
    await writeBrief({ ...sampleBrief(a), updatedAt: "2026-01-01T00:00:00.000Z" });
    await ensureProject(b);
    await writeBrief({ ...sampleBrief(b), updatedAt: "2026-02-01T00:00:00.000Z" });
    const list = await listProjects();
    expect(list.map((s) => s.projectId)).toEqual([b, a]);
    expect(list.every((s) => s.hasRender === false)).toBe(true);
  });

  it("writes JSON atomically: no temp residue after a successful write", async () => {
    const id = "atomic-00000001";
    await ensureProject(id);
    await writeBrief(sampleBrief(id));
    // The brief is present and valid…
    const written = JSON.parse(await readFile(projectPaths(id).brief, "utf8"));
    expect(written.projectId).toBe(id);
    // …and no `.tmp-*` sidecar is left behind in the project dir.
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(projectPaths(id).root);
    expect(entries.some((e) => e.includes(".tmp-"))).toBe(false);
  });

  it("leaves the original file intact when the atomic rename fails mid-write", async () => {
    const id = "atomic-00000002";
    await ensureProject(id);
    const original = sampleBrief(id);
    await writeBrief(original);
    // A second write whose serialization throws (circular ref) must NOT truncate
    // the existing good file — the temp-then-rename design guarantees this.
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await expect(writeJson(projectPaths(id).brief, circular)).rejects.toBeTruthy();
    const still = JSON.parse(await readFile(projectPaths(id).brief, "utf8"));
    expect(still.projectId).toBe(id);
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(projectPaths(id).root);
    expect(entries.some((e) => e.includes(".tmp-"))).toBe(false);
  });

  it("reconciles stale non-terminal states from a crashed session to failed", async () => {
    const stuck = "stuck-00000001";
    const done = "done-00000002";
    await ensureProject(stuck);
    await writeBrief({ ...sampleBrief(stuck), state: "rendering", currentStep: "rendering" });
    await ensureProject(done);
    await writeBrief({ ...sampleBrief(done), state: "done", currentStep: "done" });

    const reset = await reconcileStaleStates();
    expect(reset).toEqual([stuck]);

    const stuckBrief = JSON.parse(await readFile(projectPaths(stuck).brief, "utf8"));
    expect(stuckBrief.state).toBe("failed");
    // A terminal state is never touched.
    const doneBrief = JSON.parse(await readFile(projectPaths(done).brief, "utf8"));
    expect(doneBrief.state).toBe("done");
  });
});

describe("cache pruning (bounded size, LRU by mtime)", () => {
  /** Write a file of `size` bytes with a fixed mtime so age order is deterministic. */
  async function writeAged(dir: string, name: string, size: number, mtimeSec: number): Promise<string> {
    await mkdir(dir, { recursive: true });
    const abs = join(dir, name);
    await writeFile(abs, Buffer.alloc(size, 0));
    await utimes(abs, mtimeSec, mtimeSec);
    return abs;
  }

  it("is a no-op when the dir is absent or already under cap", async () => {
    // Absent dir → 0 reclaimed, no throw.
    expect(await pruneCacheDir(join(videoToolHome(), "cache", "nope"), 1000)).toBe(0);
    // Under cap → nothing evicted.
    const dir = renderCacheDir();
    await writeAged(dir, "a.mp4", 100, 1000);
    await writeAged(dir, "b.mp4", 100, 2000);
    expect(await pruneCacheDir(dir, 1000)).toBe(0);
    expect(existsSync(join(dir, "a.mp4"))).toBe(true);
    expect(existsSync(join(dir, "b.mp4"))).toBe(true);
  });

  it("evicts oldest-first until back under the cap", async () => {
    const dir = renderCacheDir();
    await writeAged(dir, "old.mp4", 500, 1000); // oldest
    await writeAged(dir, "mid.mp4", 500, 2000);
    await writeAged(dir, "new.mp4", 500, 3000); // newest
    // 1500 total, cap 1000 → must drop the single oldest (500) to land at 1000.
    const reclaimed = await pruneCacheDir(dir, 1000);
    expect(reclaimed).toBe(500);
    expect(existsSync(join(dir, "old.mp4"))).toBe(false); // evicted
    expect(existsSync(join(dir, "mid.mp4"))).toBe(true);
    expect(existsSync(join(dir, "new.mp4"))).toBe(true);
  });

  it("evicts a TTS clip's .srt sidecar together with the clip (no orphan)", async () => {
    const dir = ttsCacheDir();
    const oldClip = await writeAged(dir, "old.mp3", 500, 1000);
    await writeAged(dir, "old.mp3.srt", 50, 1000); // sidecar of the evicted clip
    await writeAged(dir, "new.mp3", 500, 3000);
    await writeAged(dir, "new.mp3.srt", 50, 3000); // sidecar of the kept clip
    // Sidecars are not counted/ranked; only the two clips (1000) exceed a 600 cap
    // → evict the oldest clip + its sidecar.
    await pruneCacheDir(dir, 600);
    expect(existsSync(oldClip)).toBe(false);
    expect(existsSync(join(dir, "old.mp3.srt"))).toBe(false); // sidecar gone with it
    expect(existsSync(join(dir, "new.mp3"))).toBe(true);
    expect(existsSync(join(dir, "new.mp3.srt"))).toBe(true); // kept clip keeps captions
  });
});
