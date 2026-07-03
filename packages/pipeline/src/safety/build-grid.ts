import { existsSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { validateLockedTimings, type LockedVideoSpec } from "@motionreal/schema";
import { makeReport, type SafetyIssue, type SafetyReport } from "../types.js";
import { projectPaths } from "../store/store.js";

/**
 * Tier-2 build / type checks (N10–N13), run after lock and before render.
 *
 *  - N10: TypeScript typecheck (tsc --noEmit) — provided by the caller as a
 *    boolean+message, since spawning tsc belongs to the orchestrator/CLI, not a
 *    pure check. `checkTypecheck` is the helper that runs it.
 *  - N11: Remotion bundle succeeds — likewise wrapped by `checkBundle`.
 *  - N12: locked timeline is contiguous and ends exactly at the total.
 *  - N13: every scene that declares narration has a present, non-empty audio
 *    file, and the mixed narration track exists.
 *
 * The pure pieces (N12, N13) are unit-testable without a render; N10/N11 are
 * thin async wrappers the orchestrator composes in.
 */

/** N12 + N13: pure checks over a locked spec + the project's audio on disk. */
export function runBuildGridStatic(locked: LockedVideoSpec, projectId: string): SafetyReport {
  const issues: SafetyIssue[] = [];
  const p = projectPaths(projectId);

  // N12: locked timing integrity
  const timing = validateLockedTimings(locked);
  for (const message of timing.errors) {
    issues.push({ check: "N12", severity: "error", message });
  }

  // N13: missing/empty scene audio (only when the project uses narration)
  const usesNarration = Boolean(locked.audio?.narrationSrc) || locked.scenes.some((s) => s.audio?.src);
  if (usesNarration) {
    for (const scene of locked.scenes) {
      const src = scene.audio?.src;
      if (!src) {
        issues.push({
          check: "N13",
          severity: "error",
          sceneId: scene.id,
          message: `${scene.id} declares narration but has no audio entry.`,
        });
        continue;
      }
      const abs = resolveProjectFile(p.root, src);
      if (!existsSync(abs) || safeSize(abs) === 0) {
        issues.push({
          check: "N13",
          severity: "error",
          sceneId: scene.id,
          path: src,
          message: `${scene.id} audio missing or empty at "${src}". Run TTS again before render.`,
        });
      }
    }
    const mixed = locked.audio?.narrationSrc;
    if (mixed) {
      const abs = resolveProjectFile(p.root, mixed);
      if (!existsSync(abs) || safeSize(abs) === 0) {
        issues.push({
          check: "N13",
          severity: "error",
          path: mixed,
          message: `Mixed narration track missing or empty at "${mixed}".`,
        });
      }
    }
  }

  // N9 (presence): a scene that declares a local `image.ref` must have a real,
  // non-empty file on disk under the project root — exactly like the N13 audio
  // check. The schema/static-grid N9 already guarantees the ref is local & not a
  // URL; here we confirm the bytes actually exist before render, so a manifest
  // that names a missing/empty asset fails fast with a clear, user-fixable error
  // (provide/upload the asset) instead of a cryptic Remotion staticFile 404.
  for (const scene of locked.scenes) {
    const ref = scene.image?.ref;
    if (!ref) continue;
    const abs = resolveProjectFile(p.root, ref);
    if (!existsSync(abs) || safeSize(abs) === 0) {
      issues.push({
        check: "N9",
        severity: "error",
        sceneId: scene.id,
        path: ref,
        message: `${scene.id} image missing or empty at "${ref}". Add the local asset under the project before render.`,
      });
    }
  }

  return makeReport(issues, ["build"]);
}

function resolveProjectFile(root: string, src: string): string {
  return isAbsolute(src) ? src : join(root, src);
}

function safeSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

/** N10 wrapper: turn a typecheck outcome into a SafetyIssue list. */
export function typecheckIssues(ok: boolean, detail: string): SafetyIssue[] {
  return ok ? [] : [{ check: "N10", severity: "error", message: `TypeScript typecheck failed: ${detail}` }];
}

/** N11 wrapper: turn a bundle outcome into a SafetyIssue list. */
export function bundleIssues(ok: boolean, detail: string): SafetyIssue[] {
  return ok ? [] : [{ check: "N11", severity: "error", message: `Remotion bundle failed: ${detail}` }];
}
