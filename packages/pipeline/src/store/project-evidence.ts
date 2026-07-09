/**
 * Atomic write + tolerant read for project evidence.json (script-review provenance).
 */

import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { assertSafeProjectId, projectPaths } from "./store.js";

export type ProjectEvidenceSource = {
  id: string;
  sourceUrl: string;
  title: string;
  site?: string;
  author?: string;
  publishedDate?: string;
  fetchedAt: string;
};

export type ProjectEvidenceClaim = {
  id: string;
  text: string;
  support: "user_brief" | "source_material" | "common_knowledge";
  sourceRef?: { sourceId: string; excerpt: string };
};

export type ProjectEvidenceArtifact = {
  version: 1;
  sources: ProjectEvidenceSource[];
  claims: ProjectEvidenceClaim[];
  scenes: Array<{ sceneId: string; evidenceClaimIds: string[] }>;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseEvidence(raw: unknown): ProjectEvidenceArtifact | null {
  if (!isObject(raw) || raw.version !== 1) return null;
  if (!Array.isArray(raw.sources) || !Array.isArray(raw.claims) || !Array.isArray(raw.scenes)) return null;
  return raw as unknown as ProjectEvidenceArtifact;
}

export async function writeProjectEvidence(projectId: string, evidence: ProjectEvidenceArtifact): Promise<void> {
  assertSafeProjectId(projectId);
  const path = projectPaths(projectId).evidence;
  await mkdir(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.evidence.${process.pid}.tmp`);
  const handle = await open(tmp, "w");
  try {
    await handle.writeFile(`${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  } finally {
    await handle.close();
  }
  await rename(tmp, path).catch(async (error) => {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  });
}

export async function readProjectEvidence(projectId: string): Promise<ProjectEvidenceArtifact | null> {
  assertSafeProjectId(projectId);
  try {
    const text = await readFile(projectPaths(projectId).evidence, "utf8");
    return parseEvidence(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}
