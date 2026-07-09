import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readProjectEvidence, writeProjectEvidence } from "./project-evidence.js";

const PREV = process.env.VIDEO_TOOL_HOME;

describe("project-evidence store", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "mr-ev-"));
    process.env.VIDEO_TOOL_HOME = home;
  });

  afterEach(async () => {
    if (PREV === undefined) delete process.env.VIDEO_TOOL_HOME;
    else process.env.VIDEO_TOOL_HOME = PREV;
    await rm(home, { recursive: true, force: true });
  });

  it("writes atomically and reads back", async () => {
    await mkdir(join(home, ".video-tool", "projects", "p1"), { recursive: true });
    const evidence = {
      version: 1 as const,
      sources: [{ id: "source-01", sourceUrl: "https://a.example", title: "A", fetchedAt: "2026-01-01T00:00:00.000Z" }],
      claims: [{ id: "claim-01", text: "Fact", support: "source_material" as const, sourceRef: { sourceId: "source-01", excerpt: "x".repeat(20) } }],
      scenes: [{ sceneId: "scene-01", evidenceClaimIds: ["claim-01"] }],
    };
    await writeProjectEvidence("p1", evidence);
    await expect(readProjectEvidence("p1")).resolves.toEqual(evidence);
  });

  it("returns null for missing or corrupt artifacts", async () => {
    await mkdir(join(home, ".video-tool", "projects", "p2"), { recursive: true });
    await expect(readProjectEvidence("p2")).resolves.toBeNull();
    await writeFile(join(home, ".video-tool", "projects", "p2", "evidence.json"), "{broken", "utf8");
    await expect(readProjectEvidence("p2")).resolves.toBeNull();
  });
});
