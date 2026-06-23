import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { createRenderJob, executeRenderJob, createFileServer, closeCaptureSession, createCaptureSession, initializeSession, captureFrameToBuffer } from "@hyperframes/producer";
import { geometry, T_TRANSITION_SECONDS, type LockedSceneSpec, type LockedVideoSpec } from "@news/schema";
import { appendEvent, projectPaths } from "../store/store.js";
import { createLogger } from "../log/logger.js";
import { ensureHyperframesVendor, normalizeHyperframesSceneHtml } from "../authoring/hyperframes.js";
import type {
  MeasuredBlock,
  RenderFrameOptions,
  RenderSceneStillsOptions,
  RenderVideoOptions,
  RenderVideoResult,
} from "./renderer.js";

const execFileAsync = promisify(execFile);
const log = createLogger("hyperframes-renderer");

type PreparedHyperframesScene = {
  scene: LockedSceneSpec;
  chunkDir: string;
  indexPath: string;
  contentDurationSeconds: number;
  durationSeconds: number;
  width: number;
  height: number;
};

export async function renderHyperframesVideo(opts: RenderVideoOptions): Promise<RenderVideoResult> {
  const projectRoot = requireProjectRoot(opts.projectRoot);
  const outPath = resolve(opts.outPath);
  const prepared = await prepareHyperframesScenes(opts.spec, projectRoot, {
    tailPaddingSeconds: (index) => (index < opts.spec.scenes.length - 1 ? T_TRANSITION_SECONDS : 0),
  });
  await mkdir(dirname(outPath), { recursive: true });
  const chunksDir = join(projectRoot, "renders", "chunks");
  await mkdir(chunksDir, { recursive: true });

  const chunkPaths: string[] = [];
  let completedFrames = 0;
  const totalFrames = Math.max(1, opts.spec.scenes.reduce((sum, scene) => sum + scene.durationInFrames, 0));
  for (const sceneProject of prepared) {
    const chunkPath = join(chunksDir, `${sceneProject.scene.id}.mp4`);
    await emitHyperframesEvent(projectRoot, {
      type: "hyperframes.chunk_render",
      phase: "start",
      sceneId: sceneProject.scene.id,
      outPath: chunkPath,
    });
    await renderHyperframesChunk({
      sceneProject,
      outPath: chunkPath,
      fps: opts.spec.fps,
      quality: opts.quality === "draft" ? "draft" : "standard",
      workers: normalizeWorkers(opts.concurrency),
      signal: opts.signal,
      onProgress: (ratio) => {
        const sceneFrames = sceneProject.scene.durationInFrames;
        opts.onProgress?.((completedFrames + ratio * sceneFrames) / totalFrames);
      },
    });
    await emitHyperframesEvent(projectRoot, {
      type: "hyperframes.chunk_render",
      phase: "done",
      sceneId: sceneProject.scene.id,
      outPath: chunkPath,
      durationInFrames: sceneProject.scene.durationInFrames,
    });
    completedFrames += sceneProject.scene.durationInFrames;
    chunkPaths.push(chunkPath);
  }

  const silentPath = hasGlobalAudio(opts.spec) ? join(dirname(outPath), `${stripExt(outPath)}.silent.mp4`) : outPath;
  await emitHyperframesEvent(projectRoot, {
    type: "hyperframes.assemble",
    phase: "start",
    chunks: chunkPaths.length,
    outPath: silentPath,
    overlapSeconds: prepared.length > 1 ? T_TRANSITION_SECONDS : 0,
  });
  await assembleHyperframesChunks({
    chunkPaths,
    outPath: silentPath,
    durations: prepared.map((p) => p.scene.durationInFrames / opts.spec.fps),
    overlapSeconds: prepared.length > 1 ? T_TRANSITION_SECONDS : 0,
  });
  await emitHyperframesEvent(projectRoot, {
    type: "hyperframes.assemble",
    phase: "done",
    chunks: chunkPaths.length,
    outPath: silentPath,
  });

  if (hasGlobalAudio(opts.spec)) {
    await muxGlobalAudio(silentPath, resolveProjectFile(projectRoot, opts.spec.audio.narrationSrc!), outPath);
  }

  await assertRenderedDuration(outPath, opts.spec.durationInFrames / opts.spec.fps, 1 / opts.spec.fps);
  opts.onProgress?.(1);
  return { outPath, durationInFrames: opts.spec.durationInFrames, fps: opts.spec.fps };
}

export async function renderHyperframesSceneStills(
  spec: LockedVideoSpec,
  outDir: string,
  opts: RenderSceneStillsOptions = {},
): Promise<string[]> {
  const projectRoot = requireProjectRoot(opts.projectRoot);
  const stillDir = resolve(outDir);
  await mkdir(stillDir, { recursive: true });
  const prepared = await prepareHyperframesScenes(spec, projectRoot);
  const byScene = new Map(prepared.map((p) => [p.scene.id, p] as const));
  const onlyIds = opts.sceneIds && opts.sceneIds.length > 0 ? new Set(opts.sceneIds) : null;
  const outputs: string[] = [];
  const scenes = spec.scenes.filter((scene) => !onlyIds || onlyIds.has(scene.id));

  await emitHyperframesEvent(projectRoot, { type: "hyperframes.inspect", phase: "start", scenes: scenes.length });
  for (const [progressIndex, scene] of scenes.entries()) {
    const sceneProject = byScene.get(scene.id);
    if (!sceneProject) continue;
    const output = join(stillDir, `${scene.id}.png`);
    await captureHyperframesStill(sceneProject, Math.floor(scene.durationInFrames / 2), spec.fps, output, opts.signal);
    outputs.push(output);

    for (const fraction of opts.extraFractions ?? []) {
      const frame = Math.min(
        Math.max(0, Math.round(scene.durationInFrames * fraction)),
        Math.max(0, scene.durationInFrames - 1),
      );
      await captureHyperframesStill(sceneProject, frame, spec.fps, join(stillDir, `${scene.id}.f${Math.round(fraction * 100)}.png`), opts.signal);
    }

    opts.onProgress?.(progressIndex + 1, scenes.length);
  }
  await emitHyperframesEvent(projectRoot, { type: "hyperframes.inspect", phase: "done", scenes: outputs.length });
  return outputs;
}

export async function renderHyperframesFrameTwice(
  spec: LockedVideoSpec,
  frame: number,
  outputs: readonly [string, string],
  opts: RenderFrameOptions = {},
): Promise<[string, string]> {
  const projectRoot = requireProjectRoot(opts.projectRoot);
  const scene = sceneAtFrame(spec, frame);
  const prepared = await prepareHyperframesScene(spec, scene, projectRoot);
  const localFrame = Math.min(Math.max(0, frame - scene.startFrame), Math.max(0, scene.durationInFrames - 1));
  await emitHyperframesEvent(projectRoot, { type: "hyperframes.inspect", phase: "start", sceneId: scene.id, frame });
  await captureHyperframesStill(prepared, localFrame, spec.fps, resolve(outputs[0]), opts.signal);
  await captureHyperframesStill(prepared, localFrame, spec.fps, resolve(outputs[1]), opts.signal);
  await emitHyperframesEvent(projectRoot, { type: "hyperframes.inspect", phase: "done", sceneId: scene.id, frame });
  return [resolve(outputs[0]), resolve(outputs[1])];
}

export async function measureHyperframesSceneLayouts(
  spec: LockedVideoSpec,
  opts: RenderSceneStillsOptions = {},
): Promise<Record<string, MeasuredBlock[]>> {
  const onlyIds = opts.sceneIds && opts.sceneIds.length > 0 ? new Set(opts.sceneIds) : null;
  const out: Record<string, MeasuredBlock[]> = {};
  const scenes = spec.scenes.filter((scene) => !onlyIds || onlyIds.has(scene.id));
  const projectRoot = opts.projectRoot ? resolve(opts.projectRoot) : undefined;
  if (projectRoot) await emitHyperframesEvent(projectRoot, { type: "hyperframes.inspect", phase: "start", scenes: scenes.length, target: "layout" });
  for (const [index, scene] of scenes.entries()) {
    out[scene.id] = [];
    opts.onProgress?.(index + 1, scenes.length);
  }
  if (projectRoot) await emitHyperframesEvent(projectRoot, { type: "hyperframes.inspect", phase: "done", scenes: scenes.length, target: "layout" });
  return out;
}

async function prepareHyperframesScenes(
  spec: LockedVideoSpec,
  projectRoot: string,
  opts: { tailPaddingSeconds?: (index: number, scene: LockedSceneSpec) => number } = {},
): Promise<PreparedHyperframesScene[]> {
  const out: PreparedHyperframesScene[] = [];
  for (const [index, scene] of spec.scenes.entries()) {
    out.push(
      await prepareHyperframesScene(spec, scene, projectRoot, {
        extraDurationSeconds: Math.max(0, opts.tailPaddingSeconds?.(index, scene) ?? 0),
      }),
    );
  }
  return out;
}

async function prepareHyperframesScene(
  spec: LockedVideoSpec,
  scene: LockedSceneSpec,
  projectRoot: string,
  opts: { extraDurationSeconds?: number } = {},
): Promise<PreparedHyperframesScene> {
  const paths = projectPaths(projectIdFromRoot(projectRoot));
  await ensureHyperframesVendor(projectIdFromRoot(projectRoot));
  const g = geometry(spec.format);
  const source = join(paths.hyperframesScenesDir, `${scene.id}.html`);
  if (!existsSync(source)) throw new Error(`Missing HyperFrames scene source for ${scene.id}: ${source}`);
  const chunkDir = join(paths.hyperframesChunksDir, scene.id);
  await mkdir(chunkDir, { recursive: true });
  await copyHyperframesChunkVendor(paths.hyperframesVendorDir, chunkDir);
  const contentDurationSeconds = scene.durationInFrames / spec.fps;
  const durationSeconds = contentDurationSeconds + (opts.extraDurationSeconds ?? 0);
  const html = rewriteSceneHtmlForChunk(await readFile(source, "utf8"), {
    projectRoot,
    chunkDir,
    scene,
    width: g.canvas.width,
    height: g.canvas.height,
    durationSeconds,
  });
  const indexPath = join(chunkDir, "index.html");
  await writeFile(indexPath, html, "utf8");
  return { scene, chunkDir, indexPath, contentDurationSeconds, durationSeconds, width: g.canvas.width, height: g.canvas.height };
}

function rewriteSceneHtmlForChunk(
  html: string,
  opts: {
    projectRoot: string;
    chunkDir: string;
    scene: LockedSceneSpec;
    width: number;
    height: number;
    durationSeconds: number;
  },
): string {
  const normalized = normalizeHyperframesSceneHtml(html);
  // Keep this string-based so authored formatting mostly survives. Admission has
  // already guaranteed exactly one root with these attributes.
  let out = normalized
    .replace(/data-width=(["'])(.*?)\1/i, `data-width="${opts.width}"`)
    .replace(/data-height=(["'])(.*?)\1/i, `data-height="${opts.height}"`)
    .replace(/data-duration=(["'])(.*?)\1/i, `data-duration="${opts.durationSeconds.toFixed(4)}"`)
    .replace(/src=(["'])(?:\.\.\/)+vendor\/gsap\.min\.js\1/gi, `src="vendor/gsap.min.js"`);

  if (opts.scene.image?.ref) {
    const chunkRelativeImage = relative(opts.chunkDir, resolveProjectFile(opts.projectRoot, opts.scene.image.ref))
      .split(/[\\/]/)
      .join("/");
    out = out.replace(/(<img\b[^>]*?\bsrc=)(["'])(.*?)\2/gi, `$1$2${chunkRelativeImage}$2`);
  }
  return out;
}

async function copyHyperframesChunkVendor(vendorDir: string, chunkDir: string): Promise<void> {
  const chunkVendorDir = join(chunkDir, "vendor");
  await mkdir(chunkVendorDir, { recursive: true });
  await copyFile(join(vendorDir, "gsap.min.js"), join(chunkVendorDir, "gsap.min.js"));
}

async function renderHyperframesChunk(opts: {
  sceneProject: PreparedHyperframesScene;
  outPath: string;
  fps: number;
  quality: "draft" | "standard" | "high";
  workers?: number;
  signal?: AbortSignal;
  onProgress?: (ratio: number) => void;
}): Promise<void> {
  const job = createRenderJob({
    fps: { num: opts.fps, den: 1 },
    quality: opts.quality,
    format: "mp4",
    entryFile: "index.html",
    ...(opts.workers ? { workers: opts.workers } : {}),
  });
  await executeRenderJob(
    job,
    opts.sceneProject.chunkDir,
    opts.outPath,
    (renderJob) => opts.onProgress?.(Math.max(0, Math.min(1, renderJob.progress))),
    opts.signal,
  );
}

async function captureHyperframesStill(
  sceneProject: PreparedHyperframesScene,
  localFrame: number,
  fps: number,
  output: string,
  signal?: AbortSignal,
): Promise<void> {
  await mkdir(dirname(output), { recursive: true });
  const server = await createFileServer({ projectDir: sceneProject.chunkDir });
  let session: Awaited<ReturnType<typeof createCaptureSession>> | null = null;
  try {
    if (signal?.aborted) throw new Error("HyperFrames still capture cancelled before start.");
    session = await createCaptureSession(server.url, dirname(output), {
      width: sceneProject.width,
      height: sceneProject.height,
      fps: { num: fps, den: 1 },
      format: "png",
      lockWarmupTicks: true,
    });
    await initializeSession(session);
    const frame = Math.min(Math.max(0, Math.floor(localFrame)), Math.max(0, sceneProject.scene.durationInFrames - 1));
    const result = await captureFrameToBuffer(session, frame, frame / fps);
    await writeFile(output, result.buffer);
  } finally {
    if (session) await closeCaptureSession(session);
    server.close();
  }
}

async function assembleHyperframesChunks(opts: {
  chunkPaths: readonly string[];
  durations: readonly number[];
  overlapSeconds: number;
  outPath: string;
}): Promise<void> {
  if (opts.chunkPaths.length === 0) throw new Error("Cannot assemble zero HyperFrames chunks.");
  await mkdir(dirname(opts.outPath), { recursive: true });
  if (opts.chunkPaths.length === 1) {
    await copyFile(opts.chunkPaths[0]!, opts.outPath);
    return;
  }

  const inputs = opts.chunkPaths.flatMap((path) => ["-i", path]);
  let accumulated = opts.durations[0]!;
  let prev = "[0:v]";
  const filters: string[] = [];
  for (let i = 1; i < opts.chunkPaths.length; i += 1) {
    const out = i === opts.chunkPaths.length - 1 ? "[vout]" : `[v${i}]`;
    const offset = Math.max(0, accumulated - opts.overlapSeconds);
    filters.push(`${prev}[${i}:v]xfade=transition=fade:duration=${opts.overlapSeconds.toFixed(4)}:offset=${offset.toFixed(4)},format=yuv420p${out}`);
    accumulated = accumulated + opts.durations[i]! - opts.overlapSeconds;
    prev = out;
  }

  await execFileAsync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    ...inputs,
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[vout]",
    "-an",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    opts.outPath,
  ]);
}

async function muxGlobalAudio(videoPath: string, audioPath: string, outPath: string): Promise<void> {
  await execFileAsync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-i",
    videoPath,
    "-i",
    audioPath,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-shortest",
    outPath,
  ]);
}

async function assertRenderedDuration(path: string, expectedSeconds: number, toleranceSeconds: number): Promise<void> {
  const actual = await ffprobeDuration(path);
  if (Math.abs(actual - expectedSeconds) > toleranceSeconds + 0.02) {
    throw new Error(
      `HyperFrames assembled duration ${actual.toFixed(3)}s does not match locked duration ${expectedSeconds.toFixed(3)}s.`,
    );
  }
}

async function ffprobeDuration(path: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=nw=1:nk=1",
    path,
  ]);
  const duration = Number(String(stdout).trim());
  if (!Number.isFinite(duration)) throw new Error(`Unable to probe duration for ${path}.`);
  return duration;
}

function sceneAtFrame(spec: LockedVideoSpec, frame: number): LockedSceneSpec {
  const clamped = Math.min(Math.max(0, Math.floor(frame)), Math.max(0, spec.durationInFrames - 1));
  return spec.scenes.find((scene) => clamped >= scene.startFrame && clamped < scene.startFrame + scene.durationInFrames) ?? spec.scenes[0]!;
}

function hasGlobalAudio(spec: LockedVideoSpec): boolean {
  return Boolean(spec.audio?.narrationSrc);
}

function requireProjectRoot(projectRoot: string | undefined): string {
  if (!projectRoot) throw new Error("HyperFrames renderer requires projectRoot.");
  return resolve(projectRoot);
}

function resolveProjectFile(root: string, src: string): string {
  return resolve(root, src);
}

function normalizeWorkers(value: number | string | null | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.floor(value);
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

function projectIdFromRoot(root: string): string {
  return basenameLike(root);
}

function basenameLike(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function stripExt(path: string): string {
  const name = basenameLike(path);
  const index = name.lastIndexOf(".");
  return index === -1 ? name : name.slice(0, index);
}

async function emitHyperframesEvent(
  projectRoot: string,
  event: { type: string; [key: string]: unknown },
): Promise<void> {
  try {
    await appendEvent(projectIdFromRoot(projectRoot), event);
  } catch (error) {
    log.warn({ err: error instanceof Error ? error.message : String(error), event: event.type }, "failed to append HyperFrames lifecycle event");
  }
}
