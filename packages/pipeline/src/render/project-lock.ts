import { randomUUID } from "node:crypto";
import { open, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { PipelineError } from "../errors.js";
import { projectPaths } from "../store/store.js";

export const PROJECT_RENDER_LOCK_STALE_MS = 6 * 60 * 60 * 1000;

type LockPurpose = "draft" | "full" | "stills" | "thumbnail";

type LockFile = {
  pid: number;
  startedAt: string;
  purpose: LockPurpose;
  nonce?: string;
};

const inProcessLocks = new Map<string, symbol>();

export async function withProjectRenderLock<T>(
  projectId: string,
  purpose: LockPurpose,
  fn: () => Promise<T>,
): Promise<T> {
  const token = Symbol(projectId);
  if (inProcessLocks.has(projectId)) throw lockError(projectId, purpose, "another render is already running in this process");
  inProcessLocks.set(projectId, token);

  let releaseFileLock: (() => Promise<void>) | undefined;
  try {
    releaseFileLock = await acquireFileLock(projectId, purpose);
    return await fn();
  } finally {
    try {
      await releaseFileLock?.();
    } finally {
      if (inProcessLocks.get(projectId) === token) inProcessLocks.delete(projectId);
    }
  }
}

function lockPath(projectId: string): string {
  return join(projectPaths(projectId).root, ".render.lock");
}

async function acquireFileLock(projectId: string, purpose: LockPurpose): Promise<() => Promise<void>> {
  const path = lockPath(projectId);
  const payload: LockFile = { pid: process.pid, startedAt: new Date().toISOString(), purpose, nonce: randomUUID() };

  try {
    const handle = await open(path, "wx");
    try {
      await handle.writeFile(`${JSON.stringify(payload)}\n`, "utf8");
    } catch (error) {
      await handle.close().catch(() => undefined);
      await rm(path, { force: true }).catch(() => undefined);
      throw error;
    }
    return async () => {
      await handle.close().catch(() => undefined);
      const current = await readExistingLock(path);
      if (current?.nonce === payload.nonce) await rm(path, { force: true });
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }

  const existing = await readExistingLock(path);
  if ((existing && isBreakable(existing)) || (!existing && await isUnreadableLockStale(path))) {
    await rm(path, { force: true });
    return acquireFileLock(projectId, purpose);
  }

  const detail = existing
    ? `locked by pid ${existing.pid} (${existing.purpose}) since ${existing.startedAt}`
    : "existing lock could not be read";
  throw lockError(projectId, purpose, detail);
}

async function readExistingLock(path: string): Promise<LockFile | null> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<LockFile>;
    if (typeof parsed.pid !== "number" || typeof parsed.startedAt !== "string") return null;
    const purpose = parsed.purpose === "draft" || parsed.purpose === "full" || parsed.purpose === "stills" || parsed.purpose === "thumbnail"
      ? parsed.purpose
      : "full";
    return {
      pid: parsed.pid,
      startedAt: parsed.startedAt,
      purpose,
      ...(typeof parsed.nonce === "string" ? { nonce: parsed.nonce } : {}),
    };
  } catch {
    return null;
  }
}

function isBreakable(lock: LockFile): boolean {
  const started = Date.parse(lock.startedAt);
  const stale = Number.isFinite(started) && Date.now() - started > PROJECT_RENDER_LOCK_STALE_MS;
  return stale || !isProcessAlive(lock.pid);
}

async function isUnreadableLockStale(path: string): Promise<boolean> {
  try {
    return Date.now() - (await stat(path)).mtimeMs > PROJECT_RENDER_LOCK_STALE_MS;
  } catch {
    return false;
  }
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    return true;
  }
}

function lockError(projectId: string, purpose: LockPurpose, detail: string): PipelineError {
  return new PipelineError({
    stage: "render-lock",
    cause: `project "${projectId}" is already rendering (${purpose} requested): ${detail}`,
    remediation: "Wait for the current render/stills/thumbnail job to finish, then retry.",
  });
}
