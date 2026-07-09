import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readProjectDiagnostics } from "./project-diagnostics.js";

const PREV = process.env.VIDEO_TOOL_HOME;

describe("readProjectDiagnostics", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "mr-diag-"));
    process.env.VIDEO_TOOL_HOME = home;
  });

  afterEach(async () => {
    if (PREV === undefined) delete process.env.VIDEO_TOOL_HOME;
    else process.env.VIDEO_TOOL_HOME = PREV;
    await rm(home, { recursive: true, force: true });
  });

  async function seed(projectId: string, lines: string[]): Promise<void> {
    const root = join(home, ".video-tool", "projects", projectId);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "events.ndjson"), lines.join("\n") + (lines.length ? "\n" : ""), "utf8");
  }

  it("handles missing event files without throwing", async () => {
    await mkdir(join(home, ".video-tool", "projects", "p1"), { recursive: true });
    await expect(readProjectDiagnostics("p1")).resolves.toEqual({
      projectId: "p1",
      entries: [],
      truncated: false,
    });
  });

  it("maps known safe lifecycle events and ignores unknown/malformed lines", async () => {
    await seed("p2", [
      "{not-json",
      JSON.stringify({ type: "unknown.thing", at: "2026-01-01T00:00:00.000Z", prompt: "secret" }),
      JSON.stringify({ type: "tts.done", at: "2026-01-01T00:00:02.000Z", provider: "vivibe" }),
      JSON.stringify({ type: "render.done", at: "2026-01-01T00:00:03.000Z", outPath: "C:\\\\secret\\\\out.mp4", hash: "abc" }),
      JSON.stringify({ type: "error", at: "2026-01-01T00:00:04.000Z", message: "N14 boom in /p/authored/x.tsx" }),
      JSON.stringify({
        type: "project.scaffolded",
        at: "2026-01-01T00:00:01.000Z",
        prompt: "RAW PROMPT WITH SECRETS",
      }),
    ]);
    const report = await readProjectDiagnostics("p2");
    expect(report.entries.map((e) => e.message)).toEqual([
      "Đã gặp lỗi xử lý",
      "Đã render xong",
      "Đã tạo giọng đọc",
      "Đã tạo khung dự án",
    ]);
    const blob = JSON.stringify(report);
    expect(blob).not.toContain("RAW PROMPT");
    expect(blob).not.toContain("N14");
    expect(blob).not.toContain("authored");
    expect(blob).not.toContain("C:\\\\secret");
    expect(blob).not.toContain("abc");
  });

  it("maps authoring.failure and repair states safely", async () => {
    await seed("p3", [
      JSON.stringify({
        type: "authoring.failure",
        at: "2026-01-01T00:00:01.000Z",
        failureClass: "admission",
        level: "error",
        projectId: "p3",
        detail: "should never appear",
        rawReply: "MODEL REPLY",
      }),
      JSON.stringify({ type: "repair.attempted", at: "2026-01-01T00:00:02.000Z", sceneId: "scene-01" }),
      JSON.stringify({ type: "repair.resolved", at: "2026-01-01T00:00:03.000Z", sceneId: "scene-01" }),
      JSON.stringify({ type: "repair.reverted", at: "2026-01-01T00:00:04.000Z" }),
    ]);
    const report = await readProjectDiagnostics("p3");
    expect(report.entries[0]).toMatchObject({ kind: "repair", state: "reverted", message: "Đã hoàn nguyên bản nháp trước" });
    expect(report.entries.some((e) => e.message === "Lỗi khi soạn nội dung")).toBe(true);
    expect(JSON.stringify(report)).not.toContain("MODEL REPLY");
    expect(JSON.stringify(report)).not.toContain("should never appear");
  });

  it("caps entries and reports truncation", async () => {
    const lines = Array.from({ length: 100 }, (_, i) =>
      JSON.stringify({ type: "build.ok", at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString() }),
    );
    await seed("p4", lines);
    const report = await readProjectDiagnostics("p4", { limit: 10 });
    expect(report.entries).toHaveLength(10);
    expect(report.truncated).toBe(true);
  });
});
