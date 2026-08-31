import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { decodePng, encodePngRGBA } from "../safety/png.js";
import {
  buildReviewEvidence,
  composeReviewPng,
  replaceEvidenceDirectory,
  reviewFrameSamples,
  transitionReviewSamples,
  type SceneReviewProfile,
} from "./review-evidence.js";
import type { LockedVideoSpec } from "@motionreal/schema";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

function lockedSpec(): LockedVideoSpec {
  return {
    version: 1,
    title: "Review evidence",
    format: "tiktok",
    durationTier: 1,
    language: "vi",
    fps: 30,
    durationInFrames: 330,
    audio: {},
    captions: [],
    scenes: [
      { id: "scene-01", component: "scene-01", headline: "One", narration: "one", props: {}, durationInSeconds: 4, startFrame: 0, durationInFrames: 120, transitionToNext: "zoom" },
      { id: "scene-02", component: "scene-02", headline: "Two", narration: "one two three four", props: {}, durationInSeconds: 4.5, startFrame: 105, durationInFrames: 135, motionBeats: [{ id: "one", anchor: "one two", action: "one" }, { id: "two", anchor: "three four", action: "two" }], motionCueFrames: { one: 30, two: 75 }, transitionToNext: "fade" },
      { id: "scene-03", component: "scene-03", headline: "Three", narration: "three", props: {}, durationInSeconds: 3.5, startFrame: 225, durationInFrames: 105 },
    ],
  };
}

function profile(temporalMode: SceneReviewProfile["temporalMode"]): SceneReviewProfile {
  return {
    sceneId: "scene-02",
    temporalMode,
    detailMode: "normal",
  };
}

describe("reviewFrameSamples", () => {
  it("samples stepped scenes before the first cue and after every settled cue", () => {
    const samples = reviewFrameSamples(lockedSpec(), 1, profile("stepped"));
    expect(samples.map((sample) => sample.panel.sample)).toEqual(["initial", "after-cue", "after-cue"]);
    expect(samples.map((sample) => sample.panel.cueId)).toEqual([undefined, "one", "two"]);
    expect(samples.map((sample) => sample.frame)).toEqual([134, 146, 191]);
  });

  it("adds the largest-gap midpoint for continuous scenes and keeps frames ordered", () => {
    const samples = reviewFrameSamples(lockedSpec(), 1, profile("continuous"));
    expect(samples).toHaveLength(5);
    expect(samples.map((sample) => sample.frame)).toEqual([...samples.map((sample) => sample.frame)].sort((a, b) => a - b));
    expect(samples.some((sample) => sample.panel.sample === "between-cues")).toBe(true);
    expect(samples.at(-1)?.panel.sample).toBe("final");
  });

  it("falls back to f18/mid/f82 for legacy semantic scenes without cue frames", () => {
    const spec = lockedSpec();
    spec.scenes[1] = { ...spec.scenes[1]!, motionBeats: undefined, motionCueFrames: undefined };
    expect(reviewFrameSamples(spec, 1, profile("stepped")).map((sample) => sample.frame)).toEqual([139, 173, 206]);
  });

  it("rejects a structured dynamic scene whose cue frames were not resolved", () => {
    const spec = lockedSpec();
    spec.scenes[1] = { ...spec.scenes[1]!, motionCueFrames: undefined };
    expect(() => reviewFrameSamples(spec, 1, profile("stepped"))).toThrow(/motionCueFrames/);
  });

  it("rejects structured cues that collapse onto the same evidence frame", () => {
    const spec = lockedSpec();
    spec.scenes[1] = { ...spec.scenes[1]!, motionCueFrames: { one: 30, two: 30 } };
    expect(() => reviewFrameSamples(spec, 1, profile("stepped"))).toThrow(/distinct|riêng/i);
  });

  it("samples only critical zoom/wipe boundaries", () => {
    expect(transitionReviewSamples(lockedSpec(), 0).map((sample) => sample.panel.sample))
      .toEqual(["transition-before", "transition-mid", "transition-after"]);
    expect(transitionReviewSamples(lockedSpec(), 1)).toEqual([]);
  });
});

describe("review evidence PNG composition", () => {
  it("builds overview, cue-aware motion, fine detail and critical transition artifacts", async () => {
    const root = await mkdtemp(join(tmpdir(), "motionreal-review-build-"));
    roots.push(root);
    const reviewDir = join(root, "review");
    await mkdir(reviewDir);
    const png = encodePngRGBA(4, 8, new Uint8Array(4 * 8 * 4).fill(255));
    await Promise.all(lockedSpec().scenes.map((scene) => writeFile(join(reviewDir, `${scene.id}.png`), png)));
    const renderFrame = async (_frame: number, output: string) => writeFile(output, png);

    const artifacts = await buildReviewEvidence({
      spec: lockedSpec(),
      reviewDir,
      request: {
        reviewSceneIds: ["scene-01", "scene-02", "scene-03"],
        contextSceneIds: [],
        scenes: [
          { sceneId: "scene-01", temporalMode: "static", detailMode: "normal" },
          { sceneId: "scene-02", temporalMode: "continuous", detailMode: "fine" },
          { sceneId: "scene-03", temporalMode: "static", detailMode: "normal" },
        ],
      },
      renderFrame,
    });

    expect(artifacts.map((artifact) => artifact.kind)).toEqual(["overview", "dense-filmstrip", "detail", "transition"]);
    expect(artifacts[0]?.panels.map((panel) => panel.sceneId)).toEqual(["scene-01", "scene-02", "scene-03"]);
    expect(artifacts[1]?.panels).toHaveLength(5);
    expect(artifacts[2]?.panels).toEqual([{ index: 0, sceneId: "scene-02", sample: "detail" }]);
    for (const artifact of artifacts) {
      const buffer = await readFile(artifact.path);
      expect(() => decodePng(buffer)).not.toThrow();
    }
    await expect(readdir(join(reviewDir, "evidence"))).resolves.not.toContain("frames");
  });

  it("resizes without distortion, preserves panel order and emits a decodable grid", async () => {
    const root = await mkdtemp(join(tmpdir(), "motionreal-review-evidence-"));
    roots.push(root);
    const colors = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]] as const;
    const paths = await Promise.all(colors.map(async (color, index) => {
      const path = join(root, `${index}.png`);
      await writeFile(path, encodePngRGBA(2, 4, new Uint8Array(Array.from({ length: 8 }, () => color).flat())));
      return path;
    }));
    const output = join(root, "grid.png");
    await composeReviewPng(paths, output, { columns: 2, cellWidth: 4, gutter: 1 });
    const decoded = decodePng(await readFile(output));
    expect({ width: decoded.width, height: decoded.height }).toEqual({ width: 11, height: 19 });
    expect([...decoded.data.slice((1 * decoded.width + 1) * 4, (1 * decoded.width + 1) * 4 + 4)]).toEqual(colors[0]);
    expect([...decoded.data.slice((1 * decoded.width + 6) * 4, (1 * decoded.width + 6) * 4 + 4)]).toEqual(colors[1]);
  });

  it("keeps the previous evidence directory when a replacement build fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "motionreal-review-swap-"));
    roots.push(root);
    const target = join(root, "evidence");
    await mkdir(target);
    await writeFile(join(target, "old.txt"), "old");
    await expect(replaceEvidenceDirectory(target, async (temp) => {
      await writeFile(join(temp, "partial.txt"), "partial");
      throw new Error("cancelled");
    })).rejects.toThrow("cancelled");
    await expect(readFile(join(target, "old.txt"), "utf8")).resolves.toBe("old");
  });

  it("reports both promote and restore failures without hiding the recoverable backup", async () => {
    const root = await mkdtemp(join(tmpdir(), "motionreal-review-restore-"));
    roots.push(root);
    const target = join(root, "evidence");
    await mkdir(target);
    await writeFile(join(target, "old.txt"), "old");
    let moves = 0;
    await expect(replaceEvidenceDirectory(target, async (temp) => {
      await writeFile(join(temp, "next.txt"), "next");
    }, {
      rename: async (from, to) => {
        moves += 1;
        if (moves === 1) return rename(from, to);
        throw new Error(moves === 2 ? "promote failed" : "restore failed");
      },
      rm,
    })).rejects.toThrow(/promote failed.*restore failed.*backup/is);
    await expect(readdir(root)).resolves.toEqual(expect.arrayContaining([expect.stringMatching(/^\.evidence\.backup-/)]));
  });
});
