import { readFile, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { AuthoringReviewRequest } from "@motionreal/pipeline";

type PlannedReviewScene = {
  sceneId: string;
  temporalMode?: "static" | "stepped" | "continuous";
  detailMode?: "normal" | "fine";
  motionBeats?: readonly { id: string; anchor?: string; action?: string }[];
};

type ManifestReviewScene = {
  id: string;
  motionBeats?: readonly unknown[];
  motionProgression?: string;
};

export function buildEvalReviewRequest(
  plannedScenes: readonly PlannedReviewScene[] | undefined,
  manifestScenes: readonly ManifestReviewScene[],
): AuthoringReviewRequest {
  const plannedById = new Map(plannedScenes?.map((scene) => [scene.sceneId, scene] as const));
  return {
    reviewSceneIds: manifestScenes.map((scene) => scene.id),
    contextSceneIds: [],
    scenes: manifestScenes.map((scene) => {
      const planned = plannedById.get(scene.id);
      const legacySemantic = (scene.motionBeats?.length ?? 0) >= 2
        || /\bsemantic\s*:/iu.test(scene.motionProgression ?? "");
      const temporalMode = planned?.temporalMode ?? (legacySemantic ? "stepped" : "static");
      return {
        sceneId: scene.id,
        temporalMode,
        detailMode: planned?.detailMode ?? "normal",
        ...(planned?.motionBeats && temporalMode !== "static"
          ? { motionBeatIds: planned.motionBeats.map((beat) => beat.id) }
          : {}),
      };
    }),
  };
}

/** Remove only recognized MotionReal eval reports and their same-label artifacts. */
export async function prunePromptEvalRuns(root: string, retain: number): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });
  const reports: Array<{ label: string; path: string; modifiedAt: number }> = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const path = join(root, entry.name);
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")) as { version?: unknown; label?: unknown };
      const label = entry.name.slice(0, -5);
      if (parsed.version !== 1 || parsed.label !== label) continue;
      reports.push({ label, path, modifiedAt: (await stat(path)).mtimeMs });
    } catch {
      // Foreign or partially-written JSON is not ours to delete.
    }
  }
  reports.sort((a, b) => b.modifiedAt - a.modifiedAt);
  for (const report of reports.slice(Math.max(1, retain))) {
    await Promise.all([
      rm(report.path, { force: true }),
      rm(join(root, `${report.label}-stills`), { recursive: true, force: true }),
      rm(join(root, `${report.label}-contact-sheet.html`), { force: true }),
    ]);
  }
}
