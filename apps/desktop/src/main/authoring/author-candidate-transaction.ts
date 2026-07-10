/**
 * Failure-atomic apply of a fresh-author candidate (manifest + TSX + evidence).
 * Stages under project/.authoring-candidate/, admits staged files, then promotes
 * with backup + journal. On failure/abort restores prior canonical bytes.
 */

import { existsSync } from "node:fs";
import {
  cp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  admitAuthoredSceneFiles,
  projectPaths,
  type AdmitProjectResult,
  type Manifest,
  type SafetyIssue,
} from "@motionreal/pipeline";
import type { ProjectEvidenceArtifact } from "@motionreal/pipeline";
import { isAbortError, throwIfAborted } from "../util/abort.js";

export type AuthoringCandidateModule = {
  componentId: string;
  fileName: string;
  source: string;
};

export type AuthoringCandidate = {
  manifest: Manifest;
  modules: AuthoringCandidateModule[];
  evidence: ProjectEvidenceArtifact;
};

export type CandidateApplyResult =
  | { kind: "committed" }
  | { kind: "rejected"; violations: SafetyIssue[] }
  | { kind: "cancelled" };

export type CandidateTransactionDeps = {
  admitFiles?: (files: readonly string[]) => Promise<AdmitProjectResult>;
  /** After successful commit — e.g. unregister old/new component ids. */
  onCommitted?: (info: {
    projectId: string;
    previousComponentIds: string[];
    nextComponentIds: string[];
  }) => void | Promise<void>;
};

type JournalState = "prepared" | "promoting" | "committed";

type Journal = {
  version: 1;
  projectId: string;
  state: JournalState;
};

const TX_DIR_NAME = ".authoring-candidate";

function txRoot(projectId: string): string {
  return join(projectPaths(projectId).root, TX_DIR_NAME);
}

function txPaths(projectId: string) {
  const root = txRoot(projectId);
  return {
    root,
    candidate: join(root, "candidate"),
    candidateAuthored: join(root, "candidate", "authored"),
    candidateManifest: join(root, "candidate", "manifest.json"),
    candidateEvidence: join(root, "candidate", "evidence.json"),
    backup: join(root, "backup"),
    backupAuthored: join(root, "backup", "authored"),
    backupManifest: join(root, "backup", "manifest.json"),
    backupEvidence: join(root, "backup", "evidence.json"),
    journal: join(root, "journal.json"),
  };
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

async function writeJournal(projectId: string, state: JournalState): Promise<void> {
  const paths = txPaths(projectId);
  await writeJsonAtomic(paths.journal, { version: 1, projectId, state } satisfies Journal);
}

async function readJournal(projectId: string): Promise<Journal | null> {
  try {
    const raw = JSON.parse(await readFile(txPaths(projectId).journal, "utf8")) as Journal;
    if (raw?.version !== 1 || raw.projectId !== projectId) return null;
    if (raw.state !== "prepared" && raw.state !== "promoting" && raw.state !== "committed") return null;
    return raw;
  } catch (_error) {
    return null;
  }
}

async function rmRf(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

async function pathExists(path: string): Promise<boolean> {
  return existsSync(path);
}

async function listTsxFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const names = await readdir(dir);
  return names.filter((n) => n.endsWith(".tsx") && !n.startsWith("_")).map((n) => join(dir, n));
}

async function backupCanonical(projectId: string): Promise<void> {
  const p = projectPaths(projectId);
  const tx = txPaths(projectId);
  await rmRf(tx.backup);
  await mkdir(tx.backup, { recursive: true });

  if (existsSync(p.authoredDir)) {
    await cp(p.authoredDir, tx.backupAuthored, { recursive: true });
  }
  if (existsSync(p.manifest)) {
    await cp(p.manifest, tx.backupManifest);
  }
  if (existsSync(p.evidence)) {
    await cp(p.evidence, tx.backupEvidence);
  }
}

/**
 * True when backup has at least one restorable artifact.
 * Without this, restore with empty backup can wipe good canonical state
 * (e.g. crash after journal "promoting" before backup finished — old order).
 */
async function hasUsableBackup(projectId: string): Promise<boolean> {
  const tx = txPaths(projectId);
  if (!existsSync(tx.backup)) return false;
  if (existsSync(tx.backupManifest) || existsSync(tx.backupEvidence)) return true;
  if (!existsSync(tx.backupAuthored)) return false;
  try {
    const names = await readdir(tx.backupAuthored);
    return names.some((n) => n.endsWith(".tsx") && !n.startsWith("_"));
  } catch (_error) {
    return false;
  }
}

async function restoreBackup(projectId: string): Promise<void> {
  if (!(await hasUsableBackup(projectId))) return;

  const p = projectPaths(projectId);
  const tx = txPaths(projectId);

  // Restore authored directory
  if (existsSync(tx.backupAuthored)) {
    await rmRf(p.authoredDir);
    await mkdir(join(p.authoredDir, ".."), { recursive: true });
    await cp(tx.backupAuthored, p.authoredDir, { recursive: true });
  } else {
    // Prior project had no authored dir — clear any partial canonical authored
    if (existsSync(p.authoredDir)) {
      const files = await readdir(p.authoredDir);
      await Promise.all(
        files
          .filter((f) => f.endsWith(".tsx") && !f.startsWith("_"))
          .map((f) => rm(join(p.authoredDir, f), { force: true })),
      );
    }
  }

  if (existsSync(tx.backupManifest)) {
    await cp(tx.backupManifest, p.manifest);
  } else if (existsSync(p.manifest)) {
    await rm(p.manifest, { force: true });
  }

  if (existsSync(tx.backupEvidence)) {
    await cp(tx.backupEvidence, p.evidence);
  } else if (existsSync(p.evidence)) {
    await rm(p.evidence, { force: true });
  }
}

async function promoteCandidate(projectId: string, modules: readonly AuthoringCandidateModule[]): Promise<void> {
  const p = projectPaths(projectId);
  const tx = txPaths(projectId);

  await mkdir(p.authoredDir, { recursive: true });

  // Replace scene modules: remove old non-entry tsx, copy candidate modules
  const existing = await readdir(p.authoredDir).catch((_error) => [] as string[]);
  const nextNames = new Set(modules.map((m) => m.fileName));
  await Promise.all(
    existing
      .filter((f) => f.endsWith(".tsx") && !f.startsWith("_") && !nextNames.has(f))
      .map((f) => rm(join(p.authoredDir, f), { force: true })),
  );

  for (const mod of modules) {
    const src = join(tx.candidateAuthored, mod.fileName);
    const dest = join(p.authoredDir, mod.fileName);
    await cp(src, dest);
  }

  await cp(tx.candidateManifest, p.manifest);
  await cp(tx.candidateEvidence, p.evidence);
}

async function cleanupTx(projectId: string): Promise<void> {
  await rmRf(txRoot(projectId));
}

async function listPreviousComponentIds(projectId: string): Promise<string[]> {
  // Best-effort: ids from prior manifest if present
  try {
    const raw = JSON.parse(await readFile(projectPaths(projectId).manifest, "utf8")) as {
      scenes?: Array<{ component?: string }>;
    };
    return (raw.scenes ?? []).map((s) => s.component).filter((id): id is string => typeof id === "string");
  } catch (_error) {
    return [];
  }
}

/**
 * Apply a fresh-author candidate transactionally.
 */
export async function applyAuthoringCandidate(input: {
  projectId: string;
  candidate: AuthoringCandidate;
  signal?: AbortSignal;
  deps?: CandidateTransactionDeps;
}): Promise<CandidateApplyResult> {
  const { projectId, candidate, signal, deps } = input;
  const admit = deps?.admitFiles ?? ((files) => admitAuthoredSceneFiles(files));
  const tx = txPaths(projectId);
  const previousComponentIds = await listPreviousComponentIds(projectId);

  try {
    throwIfAborted(signal);

    // Clean any leftover tx dir, then stage
    await cleanupTx(projectId);
    await mkdir(tx.candidateAuthored, { recursive: true });

    for (const mod of candidate.modules) {
      throwIfAborted(signal);
      await writeFile(join(tx.candidateAuthored, mod.fileName), mod.source, "utf8");
    }
    await writeJsonAtomic(tx.candidateManifest, candidate.manifest);
    await writeJsonAtomic(tx.candidateEvidence, candidate.evidence);
    await writeJournal(projectId, "prepared");

    throwIfAborted(signal);

    const stagedFiles = candidate.modules.map((m) => join(tx.candidateAuthored, m.fileName));
    const admitted = await admit(stagedFiles);
    if (!admitted.ok) {
      await cleanupTx(projectId);
      return { kind: "rejected", violations: admitted.violations };
    }

    throwIfAborted(signal);
    // Backup first so journal "promoting" never means "backup maybe incomplete".
    await backupCanonical(projectId);
    await writeJournal(projectId, "promoting");
    throwIfAborted(signal);
    await promoteCandidate(projectId, candidate.modules);
    await writeJournal(projectId, "committed");
    await cleanupTx(projectId).catch((_error) => undefined);

    const nextComponentIds = candidate.modules.map((m) => m.componentId);
    await deps?.onCommitted?.({ projectId, previousComponentIds, nextComponentIds });

    return { kind: "committed" };
  } catch (error) {
    // Best-effort restore only when promoting with a usable backup.
    const journal = await readJournal(projectId).catch((_error) => null);
    if (journal?.state === "promoting") {
      await restoreBackup(projectId).catch((_error) => undefined);
    }
    await cleanupTx(projectId).catch((_error) => undefined);
    if (isAbortError(error) || signal?.aborted) return { kind: "cancelled" };
    throw error;
  }
}

/**
 * Reconcile one project's leftover transaction journal (startup / pre-author).
 */
export async function reconcileAuthoringCandidateTransaction(projectId: string): Promise<void> {
  const journal = await readJournal(projectId);
  if (!journal) {
    // Orphan tx dir without journal — remove
    if (await pathExists(txRoot(projectId))) await cleanupTx(projectId);
    return;
  }

  if (journal.state === "prepared" || journal.state === "committed") {
    // prepared: never touched canonical — drop staging
    // committed: promote finished; leftover dir is garbage
    await cleanupTx(projectId);
    return;
  }

  if (journal.state === "promoting") {
    // Prefer known-good backup over half-written candidate. If backup is
    // missing/empty, leave canonical alone (do not wipe with empty restore).
    await restoreBackup(projectId).catch((_error) => undefined);
    await cleanupTx(projectId);
  }
}

/**
 * Scan projects root for any `.authoring-candidate` journals (startup).
 */
export async function reconcileAuthoringCandidateTransactions(projectsRootDir: string): Promise<void> {
  if (!existsSync(projectsRootDir)) return;
  const ids = await readdir(projectsRootDir);
  for (const id of ids) {
    const marker = join(projectsRootDir, id, TX_DIR_NAME);
    if (!existsSync(marker)) continue;
    try {
      await reconcileAuthoringCandidateTransaction(id);
    } catch (_error) {
      // Best-effort: never block startup
    }
  }
}
