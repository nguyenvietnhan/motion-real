import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { transitionFrames, type LockedVideoSpec } from "@motionreal/schema";
import { decodePng, encodePngRGBA, type DecodedImage } from "../safety/png.js";

export type SceneTemporalMode = "static" | "stepped" | "continuous";
export type SceneDetailMode = "normal" | "fine";

export type SceneReviewProfile = {
  sceneId: string;
  temporalMode: SceneTemporalMode;
  detailMode: SceneDetailMode;
  overview: true;
  motionArtifact: "none" | "cue-filmstrip" | "dense-filmstrip";
  detailArtifact: boolean;
  reasons: readonly string[];
};

export type AuthoringReviewSceneRequest = {
  sceneId: string;
  temporalMode: SceneTemporalMode;
  detailMode: SceneDetailMode;
};

export type AuthoringReviewRequest = {
  reviewSceneIds: string[];
  contextSceneIds: string[];
  scenes: AuthoringReviewSceneRequest[];
};

export type ReviewPanel = {
  index: number;
  sceneId: string;
  sample: "overview" | "initial" | "after-cue" | "between-cues" | "final" | "detail"
    | "transition-before" | "transition-mid" | "transition-after";
  cueId?: string;
};

export type ReviewArtifact = {
  path: string;
  kind: "overview" | "cue-filmstrip" | "dense-filmstrip" | "detail" | "transition";
  sceneIds: string[];
  panels: ReviewPanel[];
};

export type ReviewFrameSample = { frame: number; panel: Omit<ReviewPanel, "index"> };

export type BuildReviewEvidenceInput = {
  spec: LockedVideoSpec;
  reviewDir: string;
  request: AuthoringReviewRequest;
  renderFrame: (frame: number, output: string) => Promise<void>;
};

function cleanSpeechWindow(spec: LockedVideoSpec, index: number): { start: number; end: number } {
  const scene = spec.scenes[index]!;
  const transition = spec.scenes.length > 1 ? transitionFrames(spec.fps) : 0;
  const head = index === 0 ? 0 : transition;
  const tail = index === spec.scenes.length - 1 ? 0 : transition;
  return {
    start: scene.startFrame + head,
    end: scene.startFrame + scene.durationInFrames - tail - 1,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function uniqueSorted(samples: ReviewFrameSample[]): ReviewFrameSample[] {
  const byFrame = new Map<number, ReviewFrameSample>();
  for (const sample of samples) if (!byFrame.has(sample.frame)) byFrame.set(sample.frame, sample);
  return [...byFrame.values()].sort((a, b) => a.frame - b.frame);
}

export function reviewFrameSamples(
  spec: LockedVideoSpec,
  sceneIndex: number,
  profile: SceneReviewProfile,
): ReviewFrameSample[] {
  const scene = spec.scenes[sceneIndex];
  if (!scene || profile.temporalMode === "static") return [];
  const window = cleanSpeechWindow(spec, sceneIndex);
  const cueEntries = scene.motionBeats
    ?.flatMap((beat) => scene.motionCueFrames?.[beat.id] === undefined
      ? []
      : [{ id: beat.id, frame: scene.startFrame + scene.motionCueFrames[beat.id]! }]) ?? [];
  if ((scene.motionBeats?.length ?? 0) > 0 && cueEntries.length !== scene.motionBeats!.length) {
    throw new Error(`${scene.id} thiếu motionCueFrames cho structured motion beats.`);
  }
  if (cueEntries.length !== scene.motionBeats?.length || cueEntries.length === 0) {
    const span = Math.max(1, window.end - window.start + 1);
    return [0.18, 0.5, 0.82].map((fraction, index) => ({
      frame: clamp(window.start + span * fraction, window.start, window.end),
      panel: { sceneId: scene.id, sample: index === 0 ? "initial" : index === 2 ? "final" : "between-cues" },
    }));
  }

  const settleFrames = Math.max(2, Math.round(spec.fps * 0.35));
  const firstCue = clamp(cueEntries[0]!.frame - 1, window.start, window.end);
  const samples: ReviewFrameSample[] = [{ frame: firstCue, panel: { sceneId: scene.id, sample: "initial" } }];
  for (const cue of cueEntries) {
    samples.push({
      frame: clamp(cue.frame + settleFrames, window.start, window.end),
      panel: { sceneId: scene.id, sample: "after-cue", cueId: cue.id },
    });
  }
  if (profile.temporalMode === "stepped") return uniqueSorted(samples).slice(0, 5);

  samples.push({ frame: window.end, panel: { sceneId: scene.id, sample: "final" } });
  let ordered = uniqueSorted(samples);
  while (ordered.length < 5 && ordered.length < 7) {
    let gapIndex = -1;
    let gap = 1;
    for (let index = 0; index < ordered.length - 1; index += 1) {
      const currentGap = ordered[index + 1]!.frame - ordered[index]!.frame;
      if (currentGap > gap) {
        gap = currentGap;
        gapIndex = index;
      }
    }
    if (gapIndex < 0) break;
    const frame = Math.floor((ordered[gapIndex]!.frame + ordered[gapIndex + 1]!.frame) / 2);
    ordered = uniqueSorted([...ordered, { frame, panel: { sceneId: scene.id, sample: "between-cues" } }]);
  }
  return ordered.slice(0, 7);
}

export function transitionReviewSamples(spec: LockedVideoSpec, sceneIndex: number): ReviewFrameSample[] {
  const scene = spec.scenes[sceneIndex];
  const next = spec.scenes[sceneIndex + 1];
  if (!scene || !next || !["wipe", "clockWipe", "zoom"].includes(scene.transitionToNext ?? "")) return [];
  const transition = transitionFrames(spec.fps);
  return [
    { frame: Math.max(0, next.startFrame - 1), panel: { sceneId: scene.id, sample: "transition-before" } },
    { frame: Math.min(spec.durationInFrames - 1, next.startFrame + Math.floor(transition / 2)), panel: { sceneId: scene.id, sample: "transition-mid" } },
    { frame: Math.min(spec.durationInFrames - 1, next.startFrame + transition), panel: { sceneId: next.id, sample: "transition-after" } },
  ];
}

export async function composeReviewPng(
  paths: readonly string[],
  output: string,
  options: { columns: number; cellWidth: number; gutter: number },
): Promise<void> {
  if (paths.length === 0) throw new Error("Review composite requires at least one panel.");
  const images = await Promise.all(paths.map(async (path) => decodePng(await readFile(path))));
  const columns = Math.max(1, Math.min(paths.length, Math.floor(options.columns)));
  const cellWidth = Math.max(1, Math.floor(options.cellWidth));
  const gutter = Math.max(0, Math.floor(options.gutter));
  const cellHeight = Math.max(1, Math.round(Math.max(...images.map((image) => image.height / image.width)) * cellWidth));
  const rows = Math.ceil(images.length / columns);
  const width = columns * cellWidth + (columns + 1) * gutter;
  const height = rows * cellHeight + (rows + 1) * gutter;
  const data = new Uint8Array(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = 18;
    data[offset + 1] = 20;
    data[offset + 2] = 27;
    data[offset + 3] = 255;
  }
  images.forEach((image, index) => {
    const scaled = resizeToFit(image, cellWidth, cellHeight);
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = gutter + column * (cellWidth + gutter) + Math.floor((cellWidth - scaled.width) / 2);
    const top = gutter + row * (cellHeight + gutter) + Math.floor((cellHeight - scaled.height) / 2);
    blit(data, width, scaled, left, top);
  });
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, encodePngRGBA(width, height, data));
}

function resizeToFit(image: DecodedImage, maxWidth: number, maxHeight: number): DecodedImage {
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(image.height - 1, Math.floor(y / scale));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(image.width - 1, Math.floor(x / scale));
      const source = (sourceY * image.width + sourceX) * 4;
      const target = (y * width + x) * 4;
      data.set(image.data.subarray(source, source + 4), target);
    }
  }
  return { width, height, data };
}

function blit(target: Uint8Array, targetWidth: number, source: DecodedImage, left: number, top: number): void {
  for (let y = 0; y < source.height; y += 1) {
    const sourceStart = y * source.width * 4;
    const targetStart = ((top + y) * targetWidth + left) * 4;
    target.set(source.data.subarray(sourceStart, sourceStart + source.width * 4), targetStart);
  }
}

export async function replaceEvidenceDirectory(
  target: string,
  build: (temp: string) => Promise<void>,
): Promise<void> {
  const parent = dirname(target);
  const temp = join(parent, `.evidence.tmp-${randomUUID()}`);
  const backup = join(parent, `.evidence.backup-${randomUUID()}`);
  await mkdir(temp, { recursive: true });
  let movedPrevious = false;
  try {
    await build(temp);
    if (await stat(target).then(() => true, () => false)) {
      await rename(target, backup);
      movedPrevious = true;
    }
    try {
      await rename(temp, target);
    } catch (error) {
      if (movedPrevious) await rename(backup, target).catch(() => undefined);
      throw error;
    }
    if (movedPrevious) await rm(backup, { recursive: true, force: true });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

export async function buildReviewEvidence(input: BuildReviewEvidenceInput): Promise<ReviewArtifact[]> {
  const sceneById = new Map(input.spec.scenes.map((scene, index) => [scene.id, { scene, index }] as const));
  const profileById = new Map(input.request.scenes.map((scene) => [scene.sceneId, scene] as const));
  const reviewIds = uniqueKnownIds(input.request.reviewSceneIds, sceneById);
  if (reviewIds.length !== input.request.reviewSceneIds.length || reviewIds.some((id) => !profileById.has(id))
    || profileById.size !== input.request.scenes.length || profileById.size !== reviewIds.length) {
    throw new Error("Review request does not classify every in-scope scene.");
  }
  const contextIds = uniqueKnownIds(input.request.contextSceneIds, sceneById);
  if (contextIds.length !== input.request.contextSceneIds.length || contextIds.some((id) => reviewIds.includes(id))) {
    throw new Error("Review request has invalid context scenes.");
  }
  const overviewIds = input.spec.scenes
    .map((scene) => scene.id)
    .filter((id) => reviewIds.includes(id) || contextIds.includes(id));
  if (overviewIds.length === 0) throw new Error("Review request has no overview scenes.");

  const evidenceDir = join(input.reviewDir, "evidence");
  const artifacts: ReviewArtifact[] = [];
  await replaceEvidenceDirectory(evidenceDir, async (temp) => {
    const frameDir = join(temp, "frames");
    await mkdir(frameDir, { recursive: true });

    for (let offset = 0; offset < overviewIds.length; offset += 6) {
      const ids = overviewIds.slice(offset, offset + 6);
      const name = `overview-${String(offset / 6 + 1).padStart(2, "0")}.png`;
      await composeReviewPng(ids.map((id) => join(input.reviewDir, `${id}.png`)), join(temp, name), {
        columns: 3,
        cellWidth: 320,
        gutter: 12,
      });
      artifacts.push({
        path: join(evidenceDir, name),
        kind: "overview",
        sceneIds: ids,
        panels: ids.map((sceneId, index) => ({ index, sceneId, sample: "overview" })),
      });
    }

    for (const sceneId of reviewIds) {
      const located = sceneById.get(sceneId)!;
      const requested = profileById.get(sceneId)!;
      const profile: SceneReviewProfile = {
        ...requested,
        overview: true,
        motionArtifact: requested.temporalMode === "static"
          ? "none"
          : requested.temporalMode === "stepped" ? "cue-filmstrip" : "dense-filmstrip",
        detailArtifact: requested.detailMode === "fine",
        reasons: [requested.temporalMode, ...(requested.detailMode === "fine" ? ["fine-detail"] : [])],
      };
      const samples = reviewFrameSamples(input.spec, located.index, profile);
      if (samples.length > 0) {
        const framePaths = await renderSamples(samples, frameDir, sceneId, input.renderFrame);
        const name = `${sceneId}.motion.png`;
        await composeReviewPng(framePaths, join(temp, name), { columns: 3, cellWidth: 320, gutter: 12 });
        artifacts.push({
          path: join(evidenceDir, name),
          kind: profile.motionArtifact === "dense-filmstrip" ? "dense-filmstrip" : "cue-filmstrip",
          sceneIds: [sceneId],
          panels: samples.map((sample, index) => ({ index, ...sample.panel })),
        });
      }
      if (profile.detailArtifact) {
        const name = `${sceneId}.detail.png`;
        if (samples.length > 0) {
          await input.renderFrame(samples.at(-1)!.frame, join(temp, name));
        } else {
          await copyFile(join(input.reviewDir, `${sceneId}.png`), join(temp, name));
        }
        artifacts.push({
          path: join(evidenceDir, name),
          kind: "detail",
          sceneIds: [sceneId],
          panels: [{ index: 0, sceneId, sample: "detail" }],
        });
      }
    }

    for (let index = 0; index < input.spec.scenes.length - 1; index += 1) {
      const current = input.spec.scenes[index]!;
      const next = input.spec.scenes[index + 1]!;
      if (!reviewIds.includes(current.id) && !reviewIds.includes(next.id)) continue;
      const samples = transitionReviewSamples(input.spec, index);
      if (samples.length === 0) continue;
      const framePaths = await renderSamples(samples, frameDir, `${current.id}-to-${next.id}`, input.renderFrame);
      const name = `${current.id}-to-${next.id}.transition.png`;
      await composeReviewPng(framePaths, join(temp, name), { columns: 3, cellWidth: 320, gutter: 12 });
      artifacts.push({
        path: join(evidenceDir, name),
        kind: "transition",
        sceneIds: [current.id, next.id],
        panels: samples.map((sample, panelIndex) => ({ index: panelIndex, ...sample.panel })),
      });
    }
    await rm(frameDir, { recursive: true, force: true });
  });
  return artifacts;
}

function uniqueKnownIds<T>(ids: readonly string[], known: ReadonlyMap<string, T>): string[] {
  return [...new Set(ids)].filter((id) => known.has(id));
}

async function renderSamples(
  samples: readonly ReviewFrameSample[],
  frameDir: string,
  prefix: string,
  renderFrame: BuildReviewEvidenceInput["renderFrame"],
): Promise<string[]> {
  const paths: string[] = [];
  for (const [index, sample] of samples.entries()) {
    const path = join(frameDir, `${prefix}-${String(index + 1).padStart(2, "0")}.png`);
    await renderFrame(sample.frame, path);
    paths.push(path);
  }
  return paths;
}
