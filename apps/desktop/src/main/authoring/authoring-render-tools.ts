import type { createTools, SerializedPipelineError } from "@motionreal/pipeline";
import type { SafetyReportView } from "../agent/repair-loop.js";

type Tools = ReturnType<typeof createTools>;

type RenderToolsLogger = {
  debug: (meta: unknown, message: string) => void;
  info: (meta: unknown, message: string) => void;
  error: (meta: unknown, message: string) => void;
};

export type AuthoringRenderToolsDeps = {
  tools: Tools;
  onRenderProgress?: (ratio: number, projectId: string) => void;
  loadManifest: (projectId: string) => Promise<{ scenes: { component: string }[] }>;
  unregisterComponent: (componentId: string) => void;
  logger: RenderToolsLogger;
};

/**
 * Clear any stale host-registry entries left by older sessions/tests. Current
 * admission no longer imports authored code into the host; render-time
 * registration happens inside the generated Remotion entry.
 */
export async function refreshAuthoredRegistry(
  deps: Pick<AuthoringRenderToolsDeps, "loadManifest" | "unregisterComponent" | "logger">,
  projectId: string,
): Promise<void> {
  try {
    const m = await deps.loadManifest(projectId);
    for (const s of m.scenes) deps.unregisterComponent(s.component);
  } catch (e) {
    // best-effort: a missing/unreadable manifest just means nothing to clear
    deps.logger.debug({ err: e, projectId }, "refreshRegistry: no manifest to clear");
  }
}

export async function renderDraftWithTools(
  deps: AuthoringRenderToolsDeps,
  projectId: string,
  signal?: AbortSignal,
): Promise<{ ok: true } | { ok: false; error?: SerializedPipelineError }> {
  await refreshAuthoredRegistry(deps, projectId);
  const res = await deps.tools.render_draft(
    { projectId },
    deps.onRenderProgress ? (r) => deps.onRenderProgress!(r, projectId) : undefined,
    signal,
  );
  if (!res.ok) {
    deps.logger.error({ projectId, stage: res.error.stage, cause: res.error.cause }, "render_draft failed");
    // Carry the engine error so the repair loop can route infra vs content.
    return { ok: false, error: res.error };
  }
  deps.logger.info({ projectId, mp4Path: (res.data as { mp4Path?: string }).mp4Path ?? "(draft)" }, "render_draft OK");
  return { ok: true };
}

/**
 * Fast per-scene stills (no TTS/MP4). Refreshes the registry first so the stills
 * bundle THIS project's freshly-authored scenes. `sceneIds` scopes the render.
 */
export async function renderStillsWithTools(
  deps: AuthoringRenderToolsDeps,
  projectId: string,
  sceneIds?: string[],
  signal?: AbortSignal,
  multiFrameSceneIds?: string[],
): Promise<{ stills: string[]; error?: SerializedPipelineError }> {
  await refreshAuthoredRegistry(deps, projectId);
  const res = await deps.tools.render_stills(
    {
      projectId,
      ...(sceneIds && sceneIds.length > 0 ? { sceneIds } : {}),
      ...(multiFrameSceneIds && multiFrameSceneIds.length > 0 ? { multiFrameSceneIds } : {}),
    },
    undefined,
    signal,
  );
  if (!res.ok) {
    deps.logger.error({ projectId, stage: res.error.stage, cause: res.error.cause }, "render_stills failed");
    return { stills: [], error: res.error };
  }
  return { stills: res.data.stills };
}

export async function renderFullWithTools(
  deps: AuthoringRenderToolsDeps,
  projectId: string,
  signal?: AbortSignal,
  opts?: { forceFull?: boolean },
): Promise<{ ok: true; outputPath: string } | { ok: false; error?: SerializedPipelineError }> {
  await refreshAuthoredRegistry(deps, projectId);
  const res = await deps.tools.render_full(
    { projectId, ...(opts?.forceFull ? { forceFull: true } : {}) },
    deps.onRenderProgress ? (r) => deps.onRenderProgress!(r, projectId) : undefined,
    signal,
  );
  if (!res.ok) {
    deps.logger.error({ projectId, stage: res.error.stage, cause: res.error.cause }, "render_full failed");
    return { ok: false, error: res.error };
  }
  const outputPath = (res.data as { mp4Path?: string }).mp4Path ?? "";
  deps.logger.info({ projectId, outputPath }, "render_full OK");
  return { ok: true, outputPath };
}

/** Safety report for the draft repair loop. */
export async function getSafetyReportWithTools(
  deps: Pick<AuthoringRenderToolsDeps, "tools" | "logger">,
  projectId: string,
): Promise<SafetyReportView> {
  const res = await deps.tools.get_safety_report({ projectId });
  if (!res.ok) {
    deps.logger.error({ projectId, cause: res.error.cause }, "get_safety_report failed");
    return { ok: false, hardErrors: [], warnings: [] };
  }
  const hardErrors = res.data.hardErrors;
  if (hardErrors.length > 0) {
    deps.logger.error(
      { projectId, hardErrors: hardErrors.map((e) => `${e.check}${e.sceneId ? ` @${e.sceneId}` : ""}: ${e.message}`) },
      "safety grid HARD errors",
    );
  }
  return { ok: hardErrors.length === 0, hardErrors, warnings: res.data.warnings };
}
