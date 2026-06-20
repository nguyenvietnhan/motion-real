import { rm } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { FPS, type VideoSpec } from "@news/schema";
import { appendEvent, projectPaths, ensureProject, writeJson } from "../store/store.js";
import {
  admitProjectScenes,
  loadManifest,
  loadManifestAsSpec,
  manifestSceneFiles,
} from "../authoring/manifest.js";
import { generateAuthoredEntry } from "../authoring/authored-entry.js";
import { lockSpec } from "../audio/lock.js";
import { renderSceneStills, remotionAppRoot, type RenderTiming } from "./renderer.js";
import { PipelineError } from "../errors.js";
import { withProjectRenderLock } from "./project-lock.js";

/**
 * Fast per-scene STILLS render (freeform-engine R4/R5) — the cheap inner loop the
 * silent refine pass iterates on. It is the orchestrator's `renderProject` path
 * with everything expensive STRIPPED: no TTS (so no Vivibe key needed, no audio
 * spend), no MP4 encode, no determinism double-render, no review/contact-sheet,
 * no heavy oracle suite. Just: admit authored scenes → manifest→spec →
 * `lockSpec(spec, null)` (a no-audio hold-timed lock, purely for the frame math)
 * → generate the per-project Remotion entry → render ONE PNG per scene at its
 * midpoint into the project `review/` dir.
 *
 * `renderProject` is off-limits (ADR-002), so this lives in its own module rather
 * than as a branch inside the orchestrator; it reuses the same building blocks
 * (`admitProjectScenes`, `generateAuthoredEntry`, `lockSpec`, `renderSceneStills`)
 * so the stills are byte-faithful to what a real render would produce for those
 * frames.
 *
 * `sceneIds` scopes the render to a subset (the scenes a refine pass just
 * rewrote), so a single-scene fix re-renders one still, not the whole video — the
 * composition still lays out the full timeline (frame math unchanged); only the
 * PNG writes are scoped. Absent/empty ⇒ every scene.
 */

/** Stills lock fps. Stills are single frames; a stable fps just fixes the midpoint frame math. */
const STILLS_FPS = FPS;

export type RenderProjectStillsOptions = {
  /** Render only these scene ids (the scenes a refine pass touched); absent ⇒ all. */
  sceneIds?: string[];
  /** User-cancel signal ("Dừng"): aborts the in-flight still render. */
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  /** Optional sink for stills-pipeline timing instrumentation. */
  onTiming?: (timing: RenderTiming) => void;
};

export type RenderProjectStillsResult = {
  projectId: string;
  /** Absolute paths to the rendered per-scene PNG stills (midpoints only). */
  stills: string[];
};

/**
 * Admit + render per-scene stills for a project WITHOUT TTS or an MP4. Throws a
 * `PipelineError` if admission rejects an authored scene (the caller — the refine
 * loop — surfaces it for a reauthor). The generated entry is cleaned up after.
 */
export async function renderProjectStills(
  projectId: string,
  opts: RenderProjectStillsOptions = {},
): Promise<RenderProjectStillsResult> {
  await ensureProject(projectId);
  return withProjectRenderLock(projectId, "stills", () => renderProjectStillsUnlocked(projectId, opts));
}

export async function renderProjectStillsUnlocked(
  projectId: string,
  opts: RenderProjectStillsOptions = {},
): Promise<RenderProjectStillsResult> {
  const paths = projectPaths(projectId);
  let generatedEntry: string | null = null;
  const renderTimings: RenderTiming[] = [];

  const emitUserTiming = (timing: RenderTiming): void => {
    try {
      opts.onTiming?.(timing);
    } catch {
      /* timing instrumentation must never affect stills rendering */
    }
  };

  const appendTimingEvent = async (timing: RenderTiming): Promise<void> => {
    try {
      const event: { type: string; name: string; ms: number; meta?: Record<string, unknown> } = {
        type: "render.timing",
        name: timing.name,
        ms: timing.ms,
      };
      if (timing.meta && Object.keys(timing.meta).length > 0) event.meta = timing.meta;
      await appendEvent(projectId, event);
    } catch {
      /* timing instrumentation must never affect stills rendering */
    }
  };

  const recordRenderTiming = (timing: RenderTiming): void => {
    renderTimings.push(timing);
    emitUserTiming(timing);
  };

  const flushRenderTimings = async (): Promise<void> => {
    const pending = renderTimings.splice(0);
    for (const timing of pending) {
      await appendTimingEvent(timing);
    }
  };

  const timedStillsStage = async <T>(
    name: string,
    fn: () => T | Promise<T>,
    meta?: Record<string, unknown>,
  ): Promise<T> => {
    const startedAt = performance.now();
    try {
      return await fn();
    } finally {
      await flushRenderTimings();
      const timing: RenderTiming = {
        name: `stills.stage.${name}`,
        ms: roundMs(performance.now() - startedAt),
      };
      if (meta && Object.keys(meta).length > 0) timing.meta = meta;
      emitUserTiming(timing);
      await appendTimingEvent(timing);
    }
  };

  try {
    if (opts.signal?.aborted) throw new PipelineError({ stage: "render", cause: "stills render cancelled before start" });

    // Admit every authored scene (same AST gate as a real render). A rejected
    // scene stops the stills render with the violations summarized.
    const admitted = await timedStillsStage("authoring.admission", () => admitProjectScenes(projectId));
    if (!admitted.ok) {
      throw new PipelineError({
        stage: "build-gate",
        cause: `authored admission rejected ${admitted.violations.length} scene(s): ${admitted.violations
          .map((v) => `${v.check} ${v.path}: ${v.message}`)
          .join("; ")}`,
        remediation: "Fix or re-author the rejected scene(s) before rendering stills.",
      });
    }

    // Scope the bundle to exactly the files the manifest references (same 1:1
    // pairing the orchestrator uses), so a stale orphan .tsx is not bundled.
    const componentToFile = new Map<string, string>();
    admitted.componentIds.forEach((id, i) => {
      const file = admitted.files[i];
      if (file) componentToFile.set(id, file);
    });
    const manifest = await timedStillsStage("authoring.load_manifest", () => loadManifest(projectId));
    const authoredFiles = await timedStillsStage(
      "authoring.resolve_scene_files",
      () => manifestSceneFiles(manifest, componentToFile).map((s) => s.file),
      { files: admitted.files.length, scenes: manifest.scenes.length },
    );

    const spec: VideoSpec = await timedStillsStage("authoring.resolve_spec", () => loadManifestAsSpec(projectId), {
      scenes: manifest.scenes.length,
    });

    // No-TTS lock: lockSpec(spec, null) lays scenes on a hold-timed timeline (each
    // scene gets DEFAULT_HOLD_SECONDS), which is all the frame math a midpoint
    // still needs. No audio, no captions content — purely the visual timeline.
    const locked = await timedStillsStage(
      "lock",
      async () => {
        const lockedSpec = lockSpec(spec, null, { fps: STILLS_FPS });
        await writeJson(paths.lock, lockedSpec);
        return lockedSpec;
      },
      { fps: STILLS_FPS, scenes: spec.scenes.length },
    );

    // Per-project Remotion entry that imports the admitted authored scenes (same
    // generator as the real render path), so the stills bundle THOSE scenes.
    generatedEntry = join(paths.authoredDir, "_entry.stills.tsx");
    await timedStillsStage(
      "authored_entry",
      () => generateAuthoredEntry({ entryPath: generatedEntry!, authoredFiles, lockJsonPath: paths.lock }),
      { files: authoredFiles.length },
    );

    const stills = await timedStillsStage(
      "render_scene_stills",
      () =>
        renderSceneStills(locked, paths.reviewDir, {
          entryPoint: generatedEntry!,
          remotionRoot: remotionAppRoot(),
          projectRoot: paths.root,
          timingScope: "stills",
          onTiming: recordRenderTiming,
          ...(opts.sceneIds ? { sceneIds: opts.sceneIds } : {}),
          ...(opts.signal ? { signal: opts.signal } : {}),
          ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
        }),
      { scenes: locked.scenes.length, requestedSceneIds: opts.sceneIds?.length ?? locked.scenes.length },
    );

    return { projectId, stills };
  } finally {
    if (generatedEntry) {
      try {
        await rm(generatedEntry, { force: true });
      } catch {
        /* best-effort: the entry is regenerated each run */
      }
    }
  }
}

function roundMs(ms: number): number {
  return Math.round(ms * 100) / 100;
}
