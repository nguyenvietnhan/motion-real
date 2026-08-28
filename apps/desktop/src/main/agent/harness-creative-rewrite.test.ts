import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { admitAuthoredSceneFiles } from "@motionreal/pipeline";
import { archiveHarnessAuthoringV1, assertHarnessCreativeRewrite, harnessReviewFingerprint } from "./harness-creative-rewrite.js";

const roots: string[] = [];

function sceneSource(id: string, version = 1): string {
  return `import { registerComponent } from "@motionreal/compositions";
import { z } from "zod";
export const schema = z.object({});
export const example = {};
export default registerComponent({ id: "${id}", displayName: "${id}", schema, example,
  Component: () => <div>Version ${version}</div> });\n`;
}

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
  await writeFile(join(project, "authored", "hook.tsx"), sceneSource("hook"));
  await writeFile(join(project, "authored", "proof.tsx"), sceneSource("proof"));
  await writeFile(join(project, "review", "scene-01.png"), "one");
  await writeFile(join(project, "review", "scene-02.png"), "two");
  return { root, project };
}

describe("Harness mandatory creative rewrite", () => {
  it("binds the review to source and image bytes while ignoring generated entries", async () => {
    const { project } = await fixture();
    const stills = [join(project, "review", "scene-01.png"), join(project, "review", "scene-02.png")];
    const before = await harnessReviewFingerprint(project, stills);
    await writeFile(join(project, "authored", "_generated.tsx"), "temporary runtime entry");
    await expect(harnessReviewFingerprint(project, stills)).resolves.toBe(before);
    await writeFile(join(project, "authored", "hook.tsx"), sceneSource("hook", 2));
    const afterCode = await harnessReviewFingerprint(project, stills);
    expect(afterCode).not.toBe(before);
    await writeFile(stills[0]!, "different pixels");
    await expect(harnessReviewFingerprint(project, stills)).resolves.not.toBe(afterCode);
    await rm(stills[0]!);
    await expect(harnessReviewFingerprint(project, stills)).rejects.toThrow();
  });

  it("rejects external review files and traversal asset references", async () => {
    const { root, project } = await fixture();
    const external = join(root, "outside.png");
    await writeFile(external, "external");
    await expect(harnessReviewFingerprint(project, [external])).rejects.toThrow(/bên trong project/);
    await writeFile(join(project, "manifest.json"), JSON.stringify({ scenes: [
      { component: "hook", image: { ref: "assets/../../outside.png" } },
    ] }));
    await expect(harnessReviewFingerprint(project)).rejects.toThrow(/assets/);
  });

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
      .resolves.toBe(sceneSource("hook"));
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
    await writeFile(join(project, "authored", "hook.tsx"), sceneSource("hook", 2));
    await expect(assertHarnessCreativeRewrite({
      baselineDir: join(root, "handoff", "authoring-v1"),
      authoredDir: join(project, "authored"),
    })).rejects.toThrow(/proof\.tsx/);
    await writeFile(join(project, "authored", "proof.tsx"), sceneSource("proof", 2));
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
    await writeFile(join(project, "authored", "hook.tsx"), sceneSource("hook", 2));
    const file = join(project, "authored", "proof.tsx");
    await rm(file);
    if (kind === "directory") await mkdir(file);
    await expect(assertHarnessCreativeRewrite({
      baselineDir: join(root, "handoff", "authoring-v1"),
      authoredDir: join(project, "authored"),
    })).rejects.toThrow();
    // Failure must not mutate the archived evidence.
    await expect(readFile(join(root, "handoff", "authoring-v1", "authored", "proof.tsx"), "utf8"))
      .resolves.toBe(sceneSource("proof"));
  });

  it("resolves registered ids independently of filenames and rejects rename-only V2", async () => {
    const { root, project } = await fixture();
    const authoredDir = join(project, "authored");
    await rename(join(authoredDir, "hook.tsx"), join(authoredDir, "OpeningShot.tsx"));
    await rename(join(authoredDir, "proof.tsx"), join(authoredDir, "EvidenceShot.tsx"));
    // These modules already satisfy the same admission used for real rendering.
    await expect(admitAuthoredSceneFiles([
      join(authoredDir, "OpeningShot.tsx"), join(authoredDir, "EvidenceShot.tsx"),
    ])).resolves.toMatchObject({ ok: true, componentIds: ["hook", "proof"] });
    await archiveHarnessAuthoringV1({
      draftRoot: root, manifestPath: join(project, "manifest.json"), authoredDir,
      stills: ["scene-01", "scene-02"].map((sceneId) => ({ sceneId, path: join(project, "review", `${sceneId}.png`) })),
    });
    const input = { baselineDir: join(root, "handoff", "authoring-v1"), authoredDir };
    await rename(join(authoredDir, "OpeningShot.tsx"), join(authoredDir, "OpeningShotV2.tsx"));
    await expect(assertHarnessCreativeRewrite(input)).rejects.toThrow(/chưa viết lại/);
    await writeFile(join(authoredDir, "OpeningShotV2.tsx"), sceneSource("hook", 2));
    await expect(assertHarnessCreativeRewrite(input)).rejects.toThrow(/EvidenceShot/);
    await writeFile(join(authoredDir, "EvidenceShot.tsx"), sceneSource("proof", 2));
    await expect(assertHarnessCreativeRewrite(input)).resolves.toBeUndefined();
    await expect(readFile(join(input.baselineDir, "authored", "OpeningShot.tsx"), "utf8"))
      .resolves.toBe(sceneSource("hook"));
  });
});
