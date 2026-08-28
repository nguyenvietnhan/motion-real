import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { archiveHarnessAuthoringV1, assertHarnessCreativeRewrite } from "./harness-creative-rewrite.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "motionreal-rewrite-"));
  roots.push(root);
  const project = join(root, "project");
  await mkdir(join(project, "authored"), { recursive: true });
  await mkdir(join(project, "review"), { recursive: true });
  await writeFile(join(project, "manifest.json"), JSON.stringify({
    scenes: [
      { id: "scene-01", component: "hook" },
      { id: "scene-02", component: "proof" },
    ],
  }));
  await writeFile(join(project, "authored", "hook.tsx"), "export const hook = 1;\n");
  await writeFile(join(project, "authored", "proof.tsx"), "export const proof = 1;\n");
  await writeFile(join(project, "review", "scene-01.png"), "one");
  await writeFile(join(project, "review", "scene-02.png"), "two");
  return { root, project };
}

describe("Harness mandatory creative rewrite", () => {
  it("archives source and still evidence once, then detects unchanged scene modules", async () => {
    const { root, project } = await fixture();
    const result = await archiveHarnessAuthoringV1({
      draftRoot: root,
      manifestPath: join(project, "manifest.json"),
      authoredDir: join(project, "authored"),
      stills: ["scene-01", "scene-02"].map((sceneId) => ({ sceneId, path: join(project, "review", `${sceneId}.png`) })),
    });
    expect(result).toEqual({
      baseline: "handoff/authoring-v1",
      stills: [
        "handoff/authoring-v1/stills/scene-01.png",
        "handoff/authoring-v1/stills/scene-02.png",
      ],
    });
    await expect(readFile(join(root, "handoff", "authoring-v1", "authored", "hook.tsx"), "utf8"))
      .resolves.toBe("export const hook = 1;\n");
    await expect(assertHarnessCreativeRewrite({
      baselineDir: join(root, "handoff", "authoring-v1"),
      authoredDir: join(project, "authored"),
    })).rejects.toThrow(/hook\.tsx, proof\.tsx/);
  });

  it("passes only after every V1 scene module changed", async () => {
    const { root, project } = await fixture();
    await archiveHarnessAuthoringV1({
      draftRoot: root,
      manifestPath: join(project, "manifest.json"),
      authoredDir: join(project, "authored"),
      stills: ["scene-01", "scene-02"].map((sceneId) => ({ sceneId, path: join(project, "review", `${sceneId}.png`) })),
    });
    await writeFile(join(project, "authored", "hook.tsx"), "export const hook = 2;\n");
    await expect(assertHarnessCreativeRewrite({
      baselineDir: join(root, "handoff", "authoring-v1"),
      authoredDir: join(project, "authored"),
    })).rejects.toThrow(/proof\.tsx/);
    await writeFile(join(project, "authored", "proof.tsx"), "export const proof = 2;\n");
    await expect(assertHarnessCreativeRewrite({
      baselineDir: join(root, "handoff", "authoring-v1"),
      authoredDir: join(project, "authored"),
    })).resolves.toBeUndefined();
  });

  it.each(["missing", "directory"] as const)("rejects %s V2 source rather than treating it as a rewrite", async (kind) => {
    const { root, project } = await fixture();
    await archiveHarnessAuthoringV1({
      draftRoot: root,
      manifestPath: join(project, "manifest.json"),
      authoredDir: join(project, "authored"),
      stills: ["scene-01", "scene-02"].map((sceneId) => ({ sceneId, path: join(project, "review", `${sceneId}.png`) })),
    });
    await writeFile(join(project, "authored", "hook.tsx"), "export const hook = 2;\n");
    const file = join(project, "authored", "proof.tsx");
    await rm(file);
    if (kind === "directory") await mkdir(file);
    await expect(assertHarnessCreativeRewrite({
      baselineDir: join(root, "handoff", "authoring-v1"),
      authoredDir: join(project, "authored"),
    })).rejects.toThrow();
    // Failure must not mutate the archived evidence.
    await expect(readFile(join(root, "handoff", "authoring-v1", "authored", "proof.tsx"), "utf8"))
      .resolves.toBe("export const proof = 1;\n");
  });
});
