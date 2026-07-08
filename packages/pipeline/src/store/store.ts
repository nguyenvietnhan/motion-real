import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { ProjectBrief, ProjectEvent, ProjectState } from "../types.js";
import { createLogger } from "../log/logger.js";

const log = createLogger("store");

/**
 * Project store + workspace hygiene. All generated artifacts live under
 * VIDEO_TOOL_HOME/.video-tool/ (default: repo root). Each video is a
 * self-contained project folder, mirroring news_video_tool's hygiene rules and
 * math_video_tool's projects/<slug>/ convention (delete the folder → delete the
 * whole video). Nothing is ever written to the repository root.
 */

/** Resolve the .video-tool home. VIDEO_TOOL_HOME may be relative or absolute. */
export function videoToolHome(): string {
  const configured = process.env.VIDEO_TOOL_HOME?.trim();
  const base = configured && configured.length > 0 ? configured : ".video-tool";
  const abs = isAbsolute(base) ? base : resolve(process.cwd(), base);
  // If the configured path does not already end in .video-tool, nest it so we
  // never scatter artifacts directly in an arbitrary cwd.
  return abs.endsWith(".video-tool") ? abs : join(abs, ".video-tool");
}

export function projectsRoot(): string {
  return join(videoToolHome(), "projects");
}

/**
 * A project id is ALWAYS a `createProjectId` output: a slug of `[a-z0-9-]` plus a
 * hex uuid8 suffix. Validate against that shape before it is ever joined into a
 * path. Without this, an id like `..\..\Users\me\Documents` survives the bare
 * `String(projectId)` at the IPC boundary, `join` resolves the `..`, and the
 * traversed path flows into `rm(recursive,force)` (delete), `shell.openPath`
 * (reveal), and artifact reads (save) — i.e. arbitrary recursive delete / read
 * outside the sandbox. Reject anything that isn't the known-safe shape: no path
 * separators, no `..`, no drive letters, no NUL.
 */
const PROJECT_ID_RE = /^[A-Za-z0-9_-]+$/;
const WINDOWS_RESERVED_PROJECT_ID_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function isSafeProjectId(projectId: string): boolean {
  return PROJECT_ID_RE.test(projectId) && !WINDOWS_RESERVED_PROJECT_ID_RE.test(projectId);
}

export function assertSafeProjectId(projectId: string): string {
  if (typeof projectId !== "string" || !isSafeProjectId(projectId)) {
    throw new Error(`Invalid project id: ${JSON.stringify(projectId)}`);
  }
  return projectId;
}

export function projectPath(projectId: string): string {
  return join(projectsRoot(), assertSafeProjectId(projectId));
}

export function ttsCacheDir(): string {
  return join(videoToolHome(), "cache", "tts");
}

export function renderCacheDir(): string {
  return join(videoToolHome(), "cache", "renders");
}

/** Research files from URL ingest live here (under VIDEO_TOOL_HOME, never repo root). */
export function planningDir(): string {
  return join(videoToolHome(), "planning");
}

/** Default tracker work-queue location (under VIDEO_TOOL_HOME, never repo root). */
export function trackerPath(): string {
  return join(videoToolHome(), "tracker.json");
}

/**
 * Staging dir for images the user picks at the CREATE screen, BEFORE a project
 * exists (Phase 2 Block A). Lives under VIDEO_TOOL_HOME so the `media://`
 * protocol can preview the picks within its containment check, then the bytes
 * are moved into the new project's `assetsDir` on create. Swept of stale entries
 * on startup so picked-but-never-created images don't accumulate.
 */
export function stagingDir(): string {
  return join(videoToolHome(), "staging");
}

/** Standard sub-paths inside a project folder. */
export function projectPaths(projectId: string) {
  const root = projectPath(projectId);
  return {
    root,
    brief: join(root, "brief.json"),
    spec: join(root, "video-spec.json"),
    manifest: join(root, "manifest.json"),
    lock: join(root, "video-spec.lock.json"),
    safetyReport: join(root, "safety-report.json"),
    ttsManifest: join(root, "tts-manifest.json"),
    events: join(root, "events.ndjson"),
    audioDir: join(root, "audio"),
    rendersDir: join(root, "renders"),
    reviewDir: join(root, "review"),
    logsDir: join(root, "logs"),
    authoredDir: join(root, "authored"),
    /** Local image assets the AI may place in scenes; content-addressed `<sha>.<ext>`. */
    assetsDir: join(root, "assets"),
  };
}

/** Deterministic, filesystem-safe project id derived from the prompt. */
export function createProjectId(prompt: string): string {
  const slug = prompt
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 34);
  return `${slug || "video"}-${randomUUID().slice(0, 8)}`;
}

/** Create the project folder tree and shared caches. Idempotent. */
export async function ensureProject(projectId: string): Promise<string> {
  const p = projectPaths(projectId);
  for (const dir of [p.root, p.audioDir, p.rendersDir, p.reviewDir, p.logsDir, p.assetsDir]) {
    await mkdir(dir, { recursive: true });
  }
  await mkdir(ttsCacheDir(), { recursive: true });
  await mkdir(renderCacheDir(), { recursive: true });
  return p.root;
}

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

/**
 * Write JSON ATOMICALLY: serialize to a sibling temp file, then rename over the
 * target. `rename` is atomic on the same filesystem (Win32 + POSIX), so a crash,
 * power loss, or ENOSPC mid-write leaves the ORIGINAL file intact rather than a
 * truncated half-written one. This matters most for `brief.json` (the project's
 * identity record) and the manifest/lock specs — a torn write there could make a
 * finished video unrecoverable. The temp lives in the same dir as the target so
 * the rename never crosses a filesystem boundary (which would fall back to a
 * non-atomic copy). On any failure the temp is best-effort removed.
 */
export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${randomUUID()}`;
  try {
    await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

export async function readBrief(projectId: string): Promise<ProjectBrief> {
  return readJson<ProjectBrief>(projectPaths(projectId).brief);
}

export async function writeBrief(brief: ProjectBrief): Promise<void> {
  await writeJson(projectPaths(brief.projectId).brief, brief);
}

/** Update brief state/step/error and bump updatedAt. */
export async function setState(
  projectId: string,
  patch: Partial<Pick<ProjectBrief, "state" | "currentStep" | "error">> & { state?: ProjectState },
): Promise<ProjectBrief> {
  const brief = await readBrief(projectId);
  const next: ProjectBrief = {
    ...brief,
    ...patch,
    error: patch.error === undefined ? brief.error : patch.error,
    updatedAt: new Date().toISOString(),
  };
  await writeBrief(next);
  return next;
}

export const DEFAULT_EVENT_LOG_MAX_BYTES = 5 * 1024 * 1024;
export const EVENT_APPEND_LOCK_STALE_MS = 30_000;
const EVENT_APPEND_LOCK_WAIT_MS = 5_000;
const eventAppendQueues = new Map<string, Promise<void>>();

export type AppendEventOptions = { maxBytes?: number };
type EventLockMetadata = { pid: number; startedAt: string; nonce: string };

/** Append one complete NDJSON event under in-process and cross-process locks. */
export async function appendEvent(
  projectId: string,
  event: Omit<ProjectEvent, "at">,
  options: AppendEventOptions = {},
): Promise<void> {
  assertSafeProjectId(projectId);
  const previous = eventAppendQueues.get(projectId) ?? Promise.resolve();
  const task = previous
    .catch(() => undefined)
    .then(() => appendEventWithFileLock(projectId, event, options.maxBytes ?? DEFAULT_EVENT_LOG_MAX_BYTES));
  eventAppendQueues.set(projectId, task);
  try {
    await task;
  } finally {
    if (eventAppendQueues.get(projectId) === task) eventAppendQueues.delete(projectId);
  }
}

async function appendEventWithFileLock(
  projectId: string,
  event: Omit<ProjectEvent, "at">,
  maxBytes: number,
): Promise<void> {
  const path = projectPaths(projectId).events;
  await mkdir(dirname(path), { recursive: true });
  const release = await acquireEventAppendLock(projectId);
  try {
    const encoded = `${JSON.stringify({ ...event, at: new Date().toISOString() })}\n`;
    const byteLength = Buffer.byteLength(encoded);
    let currentSize = 0;
    try {
      currentSize = (await stat(path)).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (currentSize > 0 && currentSize + byteLength > maxBytes) {
      const archive = `${path}.1`;
      await rm(archive, { force: true });
      await rename(path, archive);
    }
    const handle = await open(path, "a");
    try {
      await handle.writeFile(encoded, "utf8");
    } finally {
      await handle.close();
    }
  } finally {
    await release();
  }
}

async function acquireEventAppendLock(projectId: string): Promise<() => Promise<void>> {
  const path = join(projectPaths(projectId).root, ".events.lock");
  const metadata: EventLockMetadata = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    nonce: randomUUID(),
  };
  const deadline = Date.now() + EVENT_APPEND_LOCK_WAIT_MS;

  while (true) {
    try {
      const handle = await open(path, "wx");
      try {
        await handle.writeFile(`${JSON.stringify(metadata)}\n`, "utf8");
      } catch (error) {
        await handle.close().catch(() => undefined);
        await rm(path, { force: true }).catch(() => undefined);
        throw error;
      }
      return async () => {
        await handle.close().catch(() => undefined);
        const current = await readEventLock(path);
        if (current?.nonce === metadata.nonce) await rm(path, { force: true });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }

    if (await isEventLockBreakable(path)) {
      await rm(path, { force: true });
      continue;
    }
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for event append lock: ${projectId}`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
  }
}

async function readEventLock(path: string): Promise<EventLockMetadata | null> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<EventLockMetadata>;
    return typeof parsed.pid === "number" && typeof parsed.startedAt === "string" && typeof parsed.nonce === "string"
      ? { pid: parsed.pid, startedAt: parsed.startedAt, nonce: parsed.nonce }
      : null;
  } catch (error) {
    return null;
  }
}

async function isEventLockBreakable(path: string): Promise<boolean> {
  const lock = await readEventLock(path);
  if (lock) {
    const started = Date.parse(lock.startedAt);
    return (Number.isFinite(started) && Date.now() - started > EVENT_APPEND_LOCK_STALE_MS) || !isProcessAlive(lock.pid);
  }
  try {
    return Date.now() - (await stat(path)).mtimeMs > EVENT_APPEND_LOCK_STALE_MS;
  } catch (error) {
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
    return code !== "ESRCH";
  }
}

export type ProjectSummary = {
  projectId: string;
  root: string;
  brief?: ProjectBrief;
  /**
   * The AI-authored display title (from `manifest.json`), when the project has
   * been authored. The gallery prefers this over the raw prompt so a card shows
   * "Gemma 3 chạy trên máy nhà" instead of the long link/prompt the user typed.
   * Absent for a scaffolded-but-unauthored project (no manifest title yet).
   */
  title?: string;
  hasRender: boolean;
};

/**
 * Read just the `title` out of a project's manifest.json, without parsing the
 * whole manifest or failing the listing if it's absent/torn. A scaffolded
 * project has no manifest yet (returns undefined); a half-written one degrades
 * to undefined rather than aborting the gallery scan.
 */
async function readManifestTitle(projectId: string): Promise<string | undefined> {
  try {
    const { title } = await readJson<{ title?: unknown }>(projectPaths(projectId).manifest);
    return typeof title === "string" && title.trim().length > 0 ? title.trim() : undefined;
  } catch {
    return undefined; // no manifest yet, or unreadable — fall back to the prompt
  }
}

/** List all known projects (newest first by updatedAt when available). */
export async function listProjects(): Promise<ProjectSummary[]> {
  const root = projectsRoot();
  if (!existsSync(root)) return [];
  const out: ProjectSummary[] = [];
  for (const id of await readdir(root)) {
    // A real project dir is always a `createProjectId` slug; skip anything else
    // (dotfiles like `.DS_Store`/`Thumbs.db`, stray folders) rather than letting
    // `projectPaths` → `assertSafeProjectId` throw and abort the whole listing.
    if (!isSafeProjectId(id)) continue;
    const p = projectPaths(id);
    if (!existsSync(p.brief)) continue;
    let brief: ProjectBrief | undefined;
    try {
      brief = await readJson<ProjectBrief>(p.brief);
    } catch {
      brief = undefined;
    }
    const title = await readManifestTitle(id);
    out.push({
      projectId: id,
      root: p.root,
      brief,
      ...(title ? { title } : {}),
      hasRender: existsSync(join(p.rendersDir, `${id}.mp4`)),
    });
  }
  return out.sort((a, b) => (b.brief?.updatedAt ?? "").localeCompare(a.brief?.updatedAt ?? ""));
}

/**
 * States that are only valid WHILE a render/author job is actively running in
 * the process that set them. If a brief is found in one of these at startup, the
 * job that owned it died (crash, OOM, power loss, Chromium taking down the
 * process) — no render can be in flight immediately after launch. Left as-is,
 * the gallery shows a "building/rendering" badge forever (recoverStage infers
 * the UI stage from artifacts and never reads brief.state). See audit P1-5.
 */
const NON_TERMINAL_STATES: ReadonlySet<ProjectState> = new Set<ProjectState>([
  "tts",
  "locking",
  "rendering",
  "reviewing",
]);

/**
 * Reset one stale brief only if it has not changed since the caller observed it.
 * Desktop startup waits for reconciliation before accepting work, while this
 * comparison also prevents an independently updated brief from being overwritten
 * by the sweep's older listProjects snapshot.
 */
export async function resetStaleStateIfUnchanged(observed: ProjectBrief): Promise<boolean> {
  const current = await readBrief(observed.projectId);
  if (
    current.state !== observed.state ||
    current.updatedAt !== observed.updatedAt ||
    !NON_TERMINAL_STATES.has(current.state)
  ) {
    return false;
  }

  await writeBrief({
    ...current,
    state: "failed",
    currentStep: "Phiên trước bị gián đoạn khi đang xử lý. Hãy thử lại.",
    updatedAt: new Date().toISOString(),
  });
  return true;
}

/**
 * Reconcile stale non-terminal project states left by a crashed prior session.
 * Rewrites any brief stuck mid-job to `failed` (with a friendly step) so the UI
 * never shows a permanently-stuck "rendering" badge. Best-effort and total: a
 * single unreadable/unwritable brief never aborts the sweep. Call once at main
 * startup, before the window polls. Returns the ids it reset.
 */
export async function reconcileStaleStates(): Promise<string[]> {
  const reset: string[] = [];
  for (const summary of await listProjects()) {
    const brief = summary.brief;
    if (!brief || !NON_TERMINAL_STATES.has(brief.state)) continue;
    try {
      if (await resetStaleStateIfUnchanged(brief)) reset.push(brief.projectId);
    } catch (error) {
      log.warn(
        { err: error, projectId: brief.projectId },
        "stale-state reconcile failed for project; continuing sweep",
      );
    }
  }
  return reset;
}

// --- cache pruning (bounded size, oldest mtime first) ----------------------

/**
 * Default size caps for the shared caches. Both caches live OUTSIDE any project
 * folder (so deleting a project never evicts them — a different project may reuse
 * the same hash), which means nothing else ever reclaims them. Without a cap they
 * grow forever: every full render copies its MP4 into `cache/renders`, every
 * synthesized clip lands in `cache/tts`. These ceilings bound that growth.
 *
 * Renders are large (tens of MB each) so the cap is generous; TTS clips are small
 * but many. Tune via the `maxBytes` arg if needed.
 */
export const DEFAULT_RENDER_CACHE_MAX_BYTES = 3 * 1024 * 1024 * 1024; // 3 GB
export const DEFAULT_TTS_CACHE_MAX_BYTES = 512 * 1024 * 1024; // 512 MB

type CacheEntry = { name: string; abs: string; size: number; mtimeMs: number };

/**
 * Prune a flat cache directory down to `maxBytes`, evicting the oldest cached
 * files by mtime first. This is age-based pruning, not true LRU: a cache hit
 * copies the file out but intentionally does not touch the cached file's mtime.
 * When a file is evicted, an adjacent sidecar (`<file>.srt` for TTS) is removed
 * with it so no orphan is left behind.
 *
 * Best-effort + total: a missing dir is a no-op; a single unstattable/locked file
 * is skipped, never aborting the sweep. Returns the bytes reclaimed (0 if under
 * cap or the dir is absent).
 */
export async function pruneCacheDir(dir: string, maxBytes: number): Promise<number> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return 0; // no cache dir yet → nothing to prune
  }

  // Sidecars (.srt) are evicted WITH their parent, never counted/ranked on their
  // own, so a kept audio clip never loses its captions and an evicted one never
  // strands them.
  const entries: CacheEntry[] = [];
  let total = 0;
  for (const name of names) {
    if (name.endsWith(".srt")) continue;
    const abs = join(dir, name);
    try {
      const st = await stat(abs);
      if (!st.isFile()) continue;
      entries.push({ name, abs, size: st.size, mtimeMs: st.mtimeMs });
      total += st.size;
    } catch {
      /* a single unstattable/locked entry must not abort the prune */
    }
  }
  if (total <= maxBytes) return 0;

  // Oldest first; evict until back under the cap.
  entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
  let reclaimed = 0;
  for (const entry of entries) {
    if (total - reclaimed <= maxBytes) break;
    try {
      await rm(entry.abs, { force: true });
      await rm(`${entry.abs}.srt`, { force: true }).catch(() => {}); // sidecar, if any
      reclaimed += entry.size;
    } catch {
      /* skip a file we can't remove; keep pruning the rest */
    }
  }
  return reclaimed;
}

/** Prune the shared render cache (MP4s) to its size cap. Best-effort. */
export async function pruneRenderCache(maxBytes = DEFAULT_RENDER_CACHE_MAX_BYTES): Promise<number> {
  return pruneCacheDir(renderCacheDir(), maxBytes);
}

/** Prune the shared TTS cache (audio + .srt sidecars) to its size cap. Best-effort. */
export async function pruneTtsCache(maxBytes = DEFAULT_TTS_CACHE_MAX_BYTES): Promise<number> {
  return pruneCacheDir(ttsCacheDir(), maxBytes);
}
