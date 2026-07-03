import { existsSync } from "node:fs";
import { join } from "node:path";
import { projectPaths } from "@motionreal/pipeline";

/**
 * Authored scene file naming + resolution (desktop-author-mode, Req 3.3/3.8).
 * Pure helpers (manifest + exists predicate injected) so they are unit/property
 * testable without a real project on disk.
 */

/** Derive the `.tsx` filename for a component id (never starts with `_`, which is reserved). */
export function sceneFileName(componentId: string): string {
  const safe = componentId.replace(/[^a-zA-Z0-9-]/g, "-").replace(/^[_-]+/, "");
  return `${safe || "scene"}.tsx`;
}

export type ResolvedScene = { componentId: string; path: string };

/** A minimal manifest shape: ordered scenes with id + authored component id. */
export type ResolveManifest = { scenes: { id: string; component: string }[] };

/**
 * Resolve `sceneId` → component id → `authored/<id>.tsx` path. Returns `null`
 * when the scene isn't in the manifest OR its file doesn't exist (so a reauthor
 * never targets the wrong scene). `exists` is injectable for tests.
 */
export async function resolveSceneFile(
  projectId: string,
  sceneId: string,
  loadManifest: (id: string) => Promise<ResolveManifest>,
  exists: (p: string) => boolean = existsSync,
): Promise<ResolvedScene | null> {
  const manifest = await loadManifest(projectId);
  const scene = manifest.scenes.find((s) => s.id === sceneId);
  if (!scene) return null;
  const path = join(projectPaths(projectId).authoredDir, sceneFileName(scene.component));
  return exists(path) ? { componentId: scene.component, path } : null;
}
