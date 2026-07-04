import type { LockedVideoSpec } from "@motionreal/schema";
import { makeReport, type SafetyIssue, type SafetyReport } from "../types.js";
import {
  renderSceneRuntimeProbe,
  type RenderSceneRuntimeProbeOptions,
} from "./renderer.js";

export type SceneRuntimeProbeOptions = RenderSceneRuntimeProbeOptions;

/**
 * N31: authored scene runtime probe.
 *
 * Production renders keep the graceful SceneErrorBoundary fallback. This probe
 * renders sampled frames with that boundary disabled so a scene crash cannot be
 * mistaken for a clean video just because the fallback pixels are deterministic.
 */
export async function checkSceneRuntimeErrors(
  spec: LockedVideoSpec,
  opts: SceneRuntimeProbeOptions = {},
): Promise<SafetyReport> {
  const failures = await renderSceneRuntimeProbe(spec, opts);
  const issues: SafetyIssue[] = failures.map((failure) => ({
    check: "N31",
    severity: "error",
    sceneId: failure.sceneId,
    path: `frame:${failure.frame}`,
    message:
      `Authored scene crashed during strict runtime probe at frame ${failure.frame}: ${failure.message}. ` +
      "Fix the scene code instead of relying on the fallback frame.",
  }));
  return makeReport(issues, ["render"]);
}
