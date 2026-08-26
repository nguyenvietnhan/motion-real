import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendEvent,
  assertSafeProjectId,
  createProjectId,
  ensureProject,
  listProjects,
  mapWithConcurrency,
  projectPaths,
  projectsRoot,
  pruneCacheDir,
  reconcileStaleStates,
  resetStaleStateIfUnchanged,
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
    // assetsDir is the project-relative image store (create-time image staging).
    expect(p.assetsDir).toBe(join(p.root, "assets"));
    // The project lives under projects/, which lives under the.video-tool home.
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

  it("bounds project metadata work to 16 workers and preserves input order", async () => {
    let active = 0;
    let maxActive = 0;
    const values = Array.from({ length: 500 }, (_, index) => index);
    const mapped = await mapWithConcurrency(values, 16, async (value) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return value * 2;
    });
    expect(maxActive).toBe(16);
    expect(mapped).toEqual(values.map((value) => value * 2));
  });

  it("lists a 500-project fixture and tolerates one malformed brief", async () => {
    const root = projectsRoot();
    await mkdir(root, { recursive: true });
    await Promise.all(Array.from({ length: 500 }, async (_, index) => {
      const id = `fixture-${String(index).padStart(8, "0")}`;
      const projectRoot = join(root, id);
      await mkdir(projectRoot, { recursive: true });
      await writeFile(
        join(projectRoot, "brief.json"),
        index === 123
          ? "{broken"
          : JSON.stringify({
            ...sampleBrief(id),
            updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
          }),
        "utf8",
      );
    }));

    const list = await listProjects();
    expect(list).toHaveLength(500);
    expect(list[0]?.projectId).toBe("fixture-00000499");
    expect(list.at(-1)?.projectId).toBe("fixture-00000123");
    expect(list.at(-1)?.brief).toBeUndefined();
  });

  it("surfaces the manifest title on the summary, and omits it when there's no (valid) manifest", async () => {
    // The gallery prefers the AI-authored display title over the raw prompt. The
    // store reads it from manifest.json at list time (manifest is the single
    // source of truth — no denormalized copy in the brief to drift). An authored
    // project carries its title; a scaffolded-but-unauthored one (no manifest, or
    // a manifest with a blank/missing title) omits it so the VM falls back to the
    // prompt.
    const authored = "authored-00000001";
    const blank = "blank-00000002";
    const scaffolded = "scaffold-00000003";
    await ensureProject(authored);
    await writeBrief(sampleBrief(authored));
    await writeJson(projectPaths(authored).manifest, { title: "  Gemma 3 chạy trên máy nhà  ", scenes: [] });
    await ensureProject(blank);
    await writeBrief(sampleBrief(blank));
    await writeJson(projectPaths(blank).manifest, { title: "   ", scenes: [] });
    await ensureProject(scaffolded);
    await writeBrief(sampleBrief(scaffolded));

    const byId = new Map((await listProjects()).map((s) => [s.projectId, s]));
    expect(byId.get(authored)?.title).toBe("Gemma 3 chạy trên máy nhà"); // trimmed
    expect(byId.get(blank)?.title).toBeUndefined(); // blank ⇒ omitted
    expect(byId.get(scaffolded)?.title).toBeUndefined(); // no manifest ⇒ omitted
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

  it("rejects a traversal projectId at the path-building boundary (assertSafeProjectId)", () => {
    // Without this guard a crafted IPC payload like `..\\..\\Users\\me\\Documents`
    // survives the bare `String(projectId)` at handlers, `join` resolves the
    // `..`, and the traversed path flows into `rm(recursive,force)` (delete),
    // `shell.openPath` (reveal), and artifact reads (save) — i.e. arbitrary
    // recursive delete / read outside the sandbox. The chokepoint must throw
    // before any path is built.
    for (const evil of ["..", "../escape", "..\\escape", "C:\\Windows", "a/b", "a\\b", "with space", "with.dot", ""]) {
      expect(() => assertSafeProjectId(evil)).toThrow(/Invalid project id/);
    }
    // The known-safe shape (createProjectId output) must still pass.
    const safe = createProjectId("ok");
    expect(assertSafeProjectId(safe)).toBe(safe);
  });

  it("rejects Windows device-reserved project ids on every platform", () => {
    for (const reserved of ["CON", "prn", "Aux", "NUL", "COM1", "com9", "LPT1", "lpt9"]) {
      expect(() => assertSafeProjectId(reserved)).toThrow(/Invalid project id/);
    }
    expect(assertSafeProjectId("con-video-12345678")).toBe("con-video-12345678");
  });

  it("listProjects skips an unsafe folder name instead of throwing (a stray dotfile must not break the gallery)", async () => {
    const root = projectsRoot();
    await mkdir(root, { recursive: true });
    // A real project + a stray dotfile-style dir (e.g. `.DS_Store`, `Thumbs.db`)
    // — readdir will return the latter, but it isn't a valid id and must be
    // skipped, not abort the whole listing.
    const ok = "good-12345678";
    await ensureProject(ok);
    await writeBrief(sampleBrief(ok));
    await mkdir(join(root, ".DS_Store"), { recursive: true });
    const list = await listProjects();
    expect(list.map((s) => s.projectId)).toEqual([ok]);
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

  it("serializes concurrent event appends into complete NDJSON records", async () => {
    const id = "events-00000004";
    await ensureProject(id);
    await Promise.all(Array.from({ length: 50 }, (_, index) => appendEvent(id, { type: "parallel", index })));

    const lines = (await readFile(projectPaths(id).events, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(50);
    const indexes = lines.map((line) => JSON.parse(line).index as number).sort((a, b) => a - b);
    expect(indexes).toEqual(Array.from({ length: 50 }, (_, index) => index));
    expect(existsSync(join(projectPaths(id).root, ".events.lock"))).toBe(false);
  });

  it("rotates events.ndjson before an append would exceed the configured cap", async () => {
    const id = "events-00000005";
    await ensureProject(id);
    await appendEvent(id, { type: "first", payload: "x".repeat(80) }, { maxBytes: 140 });
    await appendEvent(id, { type: "second", payload: "y".repeat(80) }, { maxBytes: 140 });

    const current = (await readFile(projectPaths(id).events, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    const archived = (await readFile(`${projectPaths(id).events}.1`, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(current.map((event) => event.type)).toEqual(["second"]);
    expect(archived.map((event) => event.type)).toEqual(["first"]);
  });

  it("does not overwrite a brief changed after the stale snapshot was observed", async () => {
    const id = "race-00000003";
    await ensureProject(id);
    const observed = { ...sampleBrief(id), state: "rendering" as const, updatedAt: "2026-01-01T00:00:00.000Z" };
    await writeBrief(observed);
    await writeBrief({ ...observed, state: "done", currentStep: "done", updatedAt: "2026-01-01T00:00:01.000Z" });

    expect(await resetStaleStateIfUnchanged(observed)).toBe(false);
    const current = JSON.parse(await readFile(projectPaths(id).brief, "utf8"));
    expect(current.state).toBe("done");
    expect(current.updatedAt).toBe("2026-01-01T00:00:01.000Z");
  });
});

describe("cache pruning (bounded size, oldest mtime first)", () => {
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
