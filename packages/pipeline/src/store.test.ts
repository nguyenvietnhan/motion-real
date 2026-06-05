import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendEvent,
  createProjectId,
  ensureProject,
  listProjects,
  projectPaths,
  projectsRoot,
  setState,
  videoToolHome,
  writeBrief,
} from "./store.js";
import type { ProjectBrief } from "./types.js";

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
    for (const dir of [p.root, p.audioDir, p.rendersDir, p.reviewDir, p.logsDir]) {
      expect(existsSync(dir)).toBe(true);
    }
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
});
