import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { harnessReviewFingerprint } from "./harness-creative-rewrite.js";

const roots: string[] = [];

function sceneSource(id: string, version = 1): string {
  return `export default function ${id}() { return <div>Version ${version}</div>; }\n`;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const project = await mkdtemp(join(tmpdir(), "motionreal-refine-"));
  roots.push(project);
  await mkdir(join(project, "authored"), { recursive: true });
  await mkdir(join(project, "review"), { recursive: true });
  await writeFile(join(project, "manifest.json"), JSON.stringify({
    scenes: [{ id: "scene-01", component: "hook" }, { id: "scene-02", component: "proof" }],
  }));
  await writeFile(join(project, "authored", "hook.tsx"), sceneSource("Hook"));
  await writeFile(join(project, "authored", "proof.tsx"), sceneSource("Proof"));
  await writeFile(join(project, "review", "scene-01.png"), "one");
  await writeFile(join(project, "review", "scene-02.png"), "two");
  return project;
}

describe("Harness visual-refine fingerprint", () => {
  it("binds review evidence to source and still bytes, ignoring generated entries", async () => {
    const project = await fixture();
    const stills = [join(project, "review", "scene-01.png"), join(project, "review", "scene-02.png")];
    const before = await harnessReviewFingerprint(project, stills);
    await writeFile(join(project, "authored", "_generated.tsx"), "temporary runtime entry");
    await expect(harnessReviewFingerprint(project, stills)).resolves.toBe(before);
    await writeFile(join(project, "authored", "hook.tsx"), sceneSource("Hook", 2));
    const afterCode = await harnessReviewFingerprint(project, stills);
    expect(afterCode).not.toBe(before);
    await writeFile(stills[0]!, "different pixels");
    await expect(harnessReviewFingerprint(project, stills)).resolves.not.toBe(afterCode);
  });

  it("rejects external review files and traversal asset references", async () => {
    const project = await fixture();
    const external = join(tmpdir(), `motionreal-external-${Date.now()}.png`);
    await writeFile(external, "external");
    try {
      await expect(harnessReviewFingerprint(project, [external])).rejects.toThrow(/bên trong project/);
      await writeFile(join(project, "manifest.json"), JSON.stringify({
        scenes: [{ component: "hook", image: { ref: "assets/../../outside.png" } }],
      }));
      await expect(harnessReviewFingerprint(project)).rejects.toThrow(/assets/);
    } finally {
      await rm(external, { force: true });
    }
  });
});
