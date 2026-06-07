import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle, type WebpackOverrideFn } from "@remotion/bundler";
import { ensureBrowser, renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import type { VideoImageFormat } from "@remotion/renderer";
import type { LockedVideoSpec } from "@news/schema";

const DEFAULT_COMPOSITION_ID = "NewsVideo";

type LogLevel = "trace" | "verbose" | "info" | "warn" | "error";

type RenderBaseOptions = {
  compositionId?: string;
  entryPoint?: string;
  remotionRoot?: string;
  projectRoot?: string;
  publicDir?: string | null;
  logLevel?: LogLevel;
};

/**
 * Render quality. `full` = the final high-quality h264 (slow-ish). `draft` =
 * a fast, low-resolution preview (half scale + ultrafast x264 + jpeg frames) so
 * the AI / user can eyeball motion and pacing quickly in the review loop before
 * committing to the expensive full render. Timing/fps are identical in both, so
 * a draft is a faithful (just softer/smaller) preview of the final cut.
 */
export type RenderQuality = "full" | "draft";

/** Fast-preview encode knobs applied when quality === "draft". */
const DRAFT_ENCODE = {
  scale: 0.5,
  crf: 30,
  jpegQuality: 70,
  imageFormat: "jpeg" as VideoImageFormat,
  x264Preset: "ultrafast" as const,
};

export type RenderVideoOptions = RenderBaseOptions & {
  spec: LockedVideoSpec;
  outPath: string;
  concurrency?: number | string | null;
  onProgress?: (ratio: number) => void;
  /** `draft` renders a fast low-res preview; defaults to `full`. */
  quality?: RenderQuality;
};

export type RenderVideoResult = {
  outPath: string;
  durationInFrames: number;
  fps: number;
};

export type RenderSceneStillsOptions = RenderBaseOptions & {
  onProgress?: (done: number, total: number) => void;
};

type PreparedComposition = {
  serveUrl: string;
  composition: Awaited<ReturnType<typeof selectComposition>>;
  inputProps: { spec: LockedVideoSpec };
};

/** Node API path: ensure Chromium, bundle the Remotion app, select composition, render h264 MP4. */
export async function renderVideo(opts: RenderVideoOptions): Promise<RenderVideoResult> {
  const outPath = resolve(opts.outPath);
  const prepared = await prepareComposition(opts.spec, {
    ...opts,
    artifactPath: outPath,
  });

  await mkdir(dirname(outPath), { recursive: true });
  const draft = opts.quality === "draft";
  await renderMedia({
    composition: prepared.composition,
    serveUrl: prepared.serveUrl,
    codec: "h264",
    outputLocation: outPath,
    inputProps: prepared.inputProps,
    concurrency: opts.concurrency ?? null,
    overwrite: true,
    logLevel: opts.logLevel ?? "warn",
    onProgress: ({ progress }) => opts.onProgress?.(progress),
    ...(draft
      ? {
          scale: DRAFT_ENCODE.scale,
          crf: DRAFT_ENCODE.crf,
          jpegQuality: DRAFT_ENCODE.jpegQuality,
          imageFormat: DRAFT_ENCODE.imageFormat,
          x264Preset: DRAFT_ENCODE.x264Preset,
        }
      : {}),
  });

  return {
    outPath,
    durationInFrames: prepared.composition.durationInFrames,
    fps: prepared.composition.fps,
  };
}

/** Render one PNG per scene at the scene midpoint for the later review loop. */
export async function renderSceneStills(
  spec: LockedVideoSpec,
  outDir: string,
  opts: RenderSceneStillsOptions = {},
): Promise<string[]> {
  const stillDir = resolve(outDir);
  const prepared = await prepareComposition(spec, {
    ...opts,
    artifactPath: stillDir,
  });
  await mkdir(stillDir, { recursive: true });

  const outputs: string[] = [];
  for (const [index, scene] of spec.scenes.entries()) {
    const output = join(stillDir, `${scene.id}.png`);
    const midpoint = scene.startFrame + Math.floor(scene.durationInFrames / 2);
    const frame = Math.min(Math.max(0, midpoint), Math.max(0, spec.durationInFrames - 1));
    await renderStill({
      composition: prepared.composition,
      serveUrl: prepared.serveUrl,
      output,
      frame,
      inputProps: prepared.inputProps,
      imageFormat: "png",
      overwrite: true,
      logLevel: opts.logLevel ?? "warn",
    });
    outputs.push(output);
    opts.onProgress?.(index + 1, spec.scenes.length);
  }
  return outputs;
}

export type RenderFrameOptions = RenderBaseOptions;

/**
 * Render one frame of the locked spec twice (same bundle, same composition)
 * to two output PNGs. This is the low-level primitive behind the determinism
 * guard (N16): bundling once and rendering the same frame twice means any
 * per-render nondeterminism in scene code (hidden Math.random / Date / time)
 * surfaces as differing bytes. Pixel comparison + reporting lives in
 * determinism.ts so this stays a thin renderer helper.
 */
export async function renderFrameTwice(
  spec: LockedVideoSpec,
  frame: number,
  outputs: readonly [string, string],
  opts: RenderFrameOptions = {},
): Promise<[string, string]> {
  const outA = resolve(outputs[0]);
  const outB = resolve(outputs[1]);
  const prepared = await prepareComposition(spec, { ...opts, artifactPath: outA });
  const clamped = Math.min(Math.max(0, Math.floor(frame)), Math.max(0, spec.durationInFrames - 1));

  const result: string[] = [];
  for (const output of [outA, outB]) {
    await mkdir(dirname(output), { recursive: true });
    await renderStill({
      composition: prepared.composition,
      serveUrl: prepared.serveUrl,
      output,
      frame: clamped,
      inputProps: prepared.inputProps,
      imageFormat: "png",
      overwrite: true,
      logLevel: opts.logLevel ?? "warn",
    });
    result.push(output);
  }
  return [result[0]!, result[1]!];
}

export function remotionEntry(): string {
  return join(remotionAppRoot(), "src", "index.ts");
}

export function remotionAppRoot(): string {
  return join(workspaceRoot(), "apps", "remotion");
}

export function workspaceRoot(): string {
  // This file lives at packages/pipeline/src/render/renderer.ts → up 4 to repo root.
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
}

async function prepareComposition(
  spec: LockedVideoSpec,
  opts: RenderBaseOptions & { artifactPath: string },
): Promise<PreparedComposition> {
  const inputProps = { spec };
  const publicDir = resolvePublicDir(opts);
  assertStaticAudioCanResolve(spec, publicDir);

  await ensureBrowser({ logLevel: opts.logLevel ?? "warn" });
  const serveUrl = await bundle({
    entryPoint: opts.entryPoint ?? remotionEntry(),
    rootDir: opts.remotionRoot ?? remotionAppRoot(),
    publicDir,
    webpackOverride: makeWorkspaceWebpackOverride(workspaceRoot()),
  });
  const composition = await selectComposition({
    serveUrl,
    id: opts.compositionId ?? DEFAULT_COMPOSITION_ID,
    inputProps,
    logLevel: opts.logLevel ?? "warn",
  });

  if (composition.durationInFrames !== spec.durationInFrames) {
    throw new Error(
      `Selected composition duration ${composition.durationInFrames} does not match locked spec ${spec.durationInFrames}.`,
    );
  }

  return { serveUrl, composition, inputProps };
}

function resolvePublicDir(opts: RenderBaseOptions & { artifactPath: string }): string | null {
  if (opts.publicDir !== undefined) return opts.publicDir ? resolve(opts.publicDir) : null;
  if (opts.projectRoot) return resolve(opts.projectRoot);
  return inferProjectRootFromArtifactPath(opts.artifactPath);
}

function inferProjectRootFromArtifactPath(path: string): string | null {
  const dir = dirname(resolve(path));
  const folder = dir.split(/[\\/]/).at(-1);
  return folder === "renders" || folder === "review" ? dirname(dir) : null;
}

function assertStaticAudioCanResolve(spec: LockedVideoSpec, publicDir: string | null): void {
  const narrationSrc = spec.audio?.narrationSrc;
  if (narrationSrc && !/^https?:\/\//i.test(narrationSrc) && !publicDir) {
    throw new Error(
      `Locked spec uses local narration "${narrationSrc}". Pass projectRoot/publicDir or render under a project renders/review directory so Remotion staticFile() can resolve it.`,
    );
  }
}

/**
 * Webpack override that lets the bundler resolve the workspace's TypeScript
 * sources directly: it maps each `@news/*` package to its `src/index.ts` and
 * teaches webpack that `.js` import specifiers may resolve to `.ts`/`.tsx`.
 * Exported so the production bundle build (`npm run build`) reuses the exact
 * same resolution rules as the renderer instead of duplicating them.
 */
export function makeWorkspaceWebpackOverride(root: string): WebpackOverrideFn {
  const pkg = (name: string) => resolve(root, "packages", name, "src", "index.ts");
  return (config) => ({
    ...config,
    resolve: {
      ...config.resolve,
      extensions: unique([".ts", ".tsx", ".js", ".jsx", ...(config.resolve?.extensions ?? [])]),
      extensionAlias: {
        ...(config.resolve?.extensionAlias ?? {}),
        ".js": [".ts", ".tsx", ".js"],
        ".jsx": [".tsx", ".jsx"],
      },
      alias: {
        ...(config.resolve?.alias ?? {}),
        "@news/schema": pkg("schema"),
        "@news/design": pkg("design"),
        "@news/blocks": pkg("blocks"),
        "@news/compositions": pkg("compositions"),
        "@news/tts": pkg("tts"),
        "@news/pipeline": pkg("pipeline"),
      },
    },
  });
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
