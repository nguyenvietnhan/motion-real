import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { encodePngRGBA, type AuthoringReviewRequest, type ReviewArtifact } from "@motionreal/pipeline";
import { assertHarnessReviewArtifacts } from "./harness-review-artifacts.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function fixture() {
  const projectRoot = await mkdtemp(join(tmpdir(), "motionreal-artifacts-"));
  roots.push(projectRoot);
  const evidence = join(projectRoot, "review", "evidence");
  await mkdir(evidence, { recursive: true });
  const png = encodePngRGBA(2, 4, new Uint8Array(2 * 4 * 4).fill(255));
  const pathOf = async (name: string) => {
    const path = join(evidence, name);
    await writeFile(path, png);
    return path;
  };
  const request: AuthoringReviewRequest = {
    reviewSceneIds: ["scene-01", "scene-02"],
    contextSceneIds: ["scene-03"],
    scenes: [
      { sceneId: "scene-01", temporalMode: "static", detailMode: "normal" },
      { sceneId: "scene-02", temporalMode: "stepped", detailMode: "fine", motionBeatIds: ["one", "two"] },
    ],
  };
  const artifacts: ReviewArtifact[] = [
    {
      path: await pathOf("overview-01.png"), kind: "overview", sceneIds: ["scene-01", "scene-02", "scene-03"],
      panels: ["scene-01", "scene-02", "scene-03"].map((sceneId, index) => ({ index, sceneId, sample: "overview" })),
    },
    {
      path: await pathOf("scene-02.motion.png"), kind: "cue-filmstrip", sceneIds: ["scene-02"],
      panels: [
        { index: 0, sceneId: "scene-02", sample: "initial" },
        { index: 1, sceneId: "scene-02", sample: "after-cue", cueId: "one" },
        { index: 2, sceneId: "scene-02", sample: "after-cue", cueId: "two" },
      ],
    },
    { path: await pathOf("scene-02.detail.png"), kind: "detail", sceneIds: ["scene-02"], panels: [{ index: 0, sceneId: "scene-02", sample: "detail" }] },
  ];
  return { projectRoot, request, artifacts };
}

describe("assertHarnessReviewArtifacts", () => {
  it("accepts one overview panel per scoped scene plus required motion and detail evidence", async () => {
    const input = await fixture();
    await expect(assertHarnessReviewArtifacts(input)).resolves.toBeUndefined();
  });

  it("rejects missing dynamic evidence and foreign context panels", async () => {
    const missing = await fixture();
    await expect(assertHarnessReviewArtifacts({ ...missing, artifacts: missing.artifacts.filter((artifact) => artifact.kind !== "cue-filmstrip") }))
      .rejects.toThrow(/scene-02.*cue-filmstrip/i);
    const foreign = await fixture();
    foreign.artifacts[0]!.panels.push({ index: 3, sceneId: "scene-99", sample: "overview" });
    await expect(assertHarnessReviewArtifacts(foreign)).rejects.toThrow(/scene lạ/i);
  });

  it("rejects a filmstrip that duplicates one cue while omitting another", async () => {
    const input = await fixture();
    input.artifacts[1]!.panels[2] = { index: 2, sceneId: "scene-02", sample: "after-cue", cueId: "one" };
    await expect(assertHarnessReviewArtifacts(input)).rejects.toThrow(/motion beat|cue/i);
  });

  it("rejects corrupt PNGs and paths outside review/evidence", async () => {
    const corrupt = await fixture();
    await writeFile(corrupt.artifacts[0]!.path, "not-png");
    await expect(assertHarnessReviewArtifacts(corrupt)).rejects.toThrow(/PNG/i);
    const outside = await fixture();
    outside.artifacts[0]!.path = join(outside.projectRoot, "review", "scene-01.png");
    await writeFile(outside.artifacts[0]!.path, "not-png");
    await expect(assertHarnessReviewArtifacts(outside)).rejects.toThrow(/review\/evidence/i);
  });
});
