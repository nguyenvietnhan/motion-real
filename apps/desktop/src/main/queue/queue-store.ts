import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  QueueJobInput,
  QueueJobUpdateInput,
  QueueJobVM,
  QueueProjectVM,
  QueuePauseState,
} from "../../shared/queue-types.js";
import { normalizeStagedImages } from "../create/create-ipc.js";

/** Fixed id for the Home-create spillover container (not title-matched). */
export const HOME_QUEUE_ID = "queue-home";

/** Card title while waiting: the user prompt; replaced by AI clip title when done. */
export function defaultJobDisplayTitle(raw: string, smoke?: boolean): string {
  if (smoke) return "Smoke test";
  const t = raw.trim().replace(/\s+/g, " ");
  return (t || "Untitled").slice(0, 140);
}

export function isEphemeralHomeQueue(q: Pick<QueueProjectVM, "id" | "ephemeralKind"> | null | undefined): boolean {
  if (!q) return false;
  return q.id === HOME_QUEUE_ID || q.ephemeralKind === "home";
}

/**
 * After drain: drop ephemeral home when nothing left to run or retry.
 * Keeps the container if any job is queued/running/failed.
 */
export function shouldAutoDeleteHomeQueue(q: QueueProjectVM): boolean {
  if (!isEphemeralHomeQueue(q)) return false;
  return !q.jobs.some((j) => j.status === "queued" || j.status === "running" || j.status === "failed");
}

type StoreFile = {
  version: 1;
  queues: QueueProjectVM[];
  runner?: {
    requestedQueueIds: string[];
    paused?: QueuePauseState;
  };
};

export type QueueStoreDeps = {
  /** Absolute path to queues.json under VIDEO_TOOL_HOME. */
  filePath: string;
  now?: () => string;
  id?: () => string;
};

/**
 * Persist queue containers + jobs as one JSON file.
 * // ponytail: single file; split per-queue files if list grows huge
 */
export class QueueStore {
  private data: StoreFile;

  constructor(private readonly deps: QueueStoreDeps) {
    this.data = this.load();
  }

  list(): QueueProjectVM[] {
    return this.data.queues.map(cloneQueue);
  }

  get(queueId: string): QueueProjectVM | null {
    const q = this.data.queues.find((x) => x.id === queueId);
    return q ? cloneQueue(q) : null;
  }

  create(title?: string): QueueProjectVM {
    const now = (this.deps.now ?? (() => new Date().toISOString()))();
    let suffix = (this.deps.id ?? (() => randomUUID().slice(0, 8)))();
    // Never collide with the fixed Home spillover id.
    let id = `queue-${suffix}`;
    if (id === HOME_QUEUE_ID) {
      suffix = `${suffix}x`;
      id = `queue-${suffix}`;
    }
    const resolved = (title?.trim() || this.nextProjectTitle()).slice(0, 80);
    const queue: QueueProjectVM = {
      id,
      title: resolved,
      createdAt: now,
      jobs: [],
    };
    this.data.queues.unshift(queue);
    this.save();
    return cloneQueue(queue);
  }

  /**
   * Get-or-create the single ephemeral Home spillover container.
   * Title is always `home`; id is always `queue-home`.
   */
  ensureHomeQueue(): QueueProjectVM {
    const existing = this.data.queues.find((x) => x.id === HOME_QUEUE_ID);
    if (existing) {
      existing.ephemeralKind = "home";
      existing.title = "home";
      this.save();
      return cloneQueue(existing);
    }
    const now = (this.deps.now ?? (() => new Date().toISOString()))();
    const queue: QueueProjectVM = {
      id: HOME_QUEUE_ID,
      title: "home",
      createdAt: now,
      jobs: [],
      ephemeralKind: "home",
    };
    this.data.queues.unshift(queue);
    this.save();
    return cloneQueue(queue);
  }

  /** Block renaming the ephemeral home container (title stays `home`). */
  rename(queueId: string, title: string): QueueProjectVM | null {
    const q = this.data.queues.find((x) => x.id === queueId);
    if (!q) return null;
    if (isEphemeralHomeQueue(q)) return null;
    const next = title.trim().slice(0, 80);
    if (!next) return null;
    q.title = next;
    this.save();
    return cloneQueue(q);
  }

  /** Next free `project-N` title across existing queue containers. */
  nextProjectTitle(): string {
    let max = 0;
    for (const q of this.data.queues) {
      const m = /^project-(\d+)$/i.exec(q.title.trim());
      if (m) max = Math.max(max, Number.parseInt(m[1]!, 10) || 0);
    }
    return `project-${max + 1}`;
  }

  /** Remove a queue container. Returns false if missing. */
  delete(queueId: string): boolean {
    const before = this.data.queues.length;
    this.data.queues = this.data.queues.filter((q) => q.id !== queueId);
    if (this.data.queues.length === before) return false;
    this.unschedule(queueId, false);
    this.save();
    return true;
  }

  addJob(queueId: string, input: QueueJobInput): QueueProjectVM | null {
    const q = this.data.queues.find((x) => x.id === queueId);
    if (!q) return null;
    const raw = input.raw.trim();
    if (!raw) return null;
    const now = (this.deps.now ?? (() => new Date().toISOString()))();
    const smoke = Boolean(input.smoke);
    const images = normalizeStagedImages(input.images);
    const job: QueueJobVM = {
      id: `job-${(this.deps.id ?? (() => randomUUID().slice(0, 8)))()}`,
      raw,
      durationTier: smoke ? 1 : input.durationTier,
      videoLanguage: input.videoLanguage,
      voiceProvider: input.voiceProvider,
      bgm: smoke ? null : input.bgm,
      status: "queued",
      createdAt: now,
      displayTitle: defaultJobDisplayTitle(raw, smoke),
      images,
      ...(smoke ? { smoke: true as const } : {}),
    };
    q.jobs.push(job);
    this.save();
    return cloneQueue(q);
  }

  /**
   * Delete a job. Running jobs must be cancelled first.
   * Returns null if missing or still running.
   */
  deleteJob(queueId: string, jobId: string): QueueProjectVM | null {
    const q = this.data.queues.find((x) => x.id === queueId);
    if (!q) return null;
    const job = q.jobs.find((j) => j.id === jobId);
    if (!job || job.status === "running") return null;
    q.jobs = q.jobs.filter((j) => j.id !== jobId);
    this.save();
    return cloneQueue(q);
  }

  /** Update knobs/prompt only while still queued. */
  updateJobInput(queueId: string, jobId: string, patch: QueueJobUpdateInput): QueueProjectVM | null {
    const q = this.data.queues.find((x) => x.id === queueId);
    if (!q) return null;
    const job = q.jobs.find((j) => j.id === jobId);
    if (!job || job.status !== "queued") return null;

    if (typeof patch.raw === "string") {
      const raw = patch.raw.trim();
      if (!raw) return null;
      job.raw = raw;
    }
    if (patch.smoke === true) {
      job.smoke = true;
      job.durationTier = 1;
      job.bgm = null;
    } else if (patch.smoke === false) {
      delete job.smoke;
    }
    if (!job.smoke) {
      if (patch.durationTier === 1 || patch.durationTier === 2 || patch.durationTier === 3 || patch.durationTier === 4) {
        job.durationTier = patch.durationTier;
      }
      if (patch.bgm !== undefined) job.bgm = typeof patch.bgm === "string" ? patch.bgm : null;
    }
    if (patch.videoLanguage === "en" || patch.videoLanguage === "vi") job.videoLanguage = patch.videoLanguage;
    if (patch.voiceProvider === "vivibe" || patch.voiceProvider === "elevenlabs" || patch.voiceProvider === "vieneu") {
      job.voiceProvider = patch.voiceProvider;
    }
    if (patch.images !== undefined) {
      const images = normalizeStagedImages(patch.images);
      if (images.length > 0) job.images = images;
      else delete job.images;
    }
    // Queued cards track the prompt; smoke keeps a fixed label.
    if (patch.smoke === true) job.displayTitle = defaultJobDisplayTitle(job.raw, true);
    else if (!job.smoke && (typeof patch.raw === "string" || patch.smoke === false)) {
      job.displayTitle = defaultJobDisplayTitle(job.raw, false);
    }
    this.save();
    return cloneQueue(q);
  }

  /** Next job still waiting (serial order = array order). */
  nextQueuedJob(queueId: string): QueueJobVM | null {
    const q = this.data.queues.find((x) => x.id === queueId);
    if (!q) return null;
    const job = q.jobs.find((j) => j.status === "queued");
    return job ? { ...job } : null;
  }

  findJob(queueId: string, jobId: string): QueueJobVM | null {
    const q = this.data.queues.find((x) => x.id === queueId);
    const job = q?.jobs.find((j) => j.id === jobId);
    return job ? { ...job } : null;
  }

  /**
   * Put failed/cancelled jobs back to `queued` so Start can retry after a fix
   * (e.g. API key). Done jobs stay done. Returns how many were requeued.
   */
  requeueRetryable(queueId: string): number {
    const q = this.data.queues.find((x) => x.id === queueId);
    if (!q) return 0;
    let n = 0;
    for (const job of q.jobs) {
      if (job.status !== "failed" && job.status !== "cancelled") continue;
      job.status = "queued";
      delete job.error;
      n += 1;
    }
    if (n > 0) this.save();
    return n;
  }

  /**
   * Process start only: jobs left `running` cannot still be in-flight after a crash/restart.
   * Mark failed so Start can requeueRetryable. Keeps projectId for gallery. Returns count.
   */
  reconcileStaleRunningJobs(): number {
    let n = 0;
    for (const q of this.data.queues) {
      for (const job of q.jobs) {
        if (job.status !== "running") continue;
        job.status = "failed";
        job.error = "App đã đóng giữa chừng; sẽ tiếp tục project hiện có.";
        n += 1;
      }
    }
    if (n > 0) this.save();
    return n;
  }

  updateJob(
    queueId: string,
    jobId: string,
    patch: Partial<Pick<QueueJobVM, "status" | "projectId" | "error" | "displayTitle">>,
  ): QueueProjectVM | null {
    const q = this.data.queues.find((x) => x.id === queueId);
    if (!q) return null;
    const job = q.jobs.find((j) => j.id === jobId);
    if (!job) return null;
    if (patch.status !== undefined) job.status = patch.status;
    if (patch.projectId !== undefined) job.projectId = patch.projectId;
    if (patch.displayTitle !== undefined) {
      const t = patch.displayTitle.trim().slice(0, 140);
      if (t) job.displayTitle = t;
    }
    if (patch.error !== undefined) {
      if (patch.error) job.error = patch.error;
      else delete job.error;
    }
    this.save();
    return cloneQueue(q);
  }

  clearJobProjectId(queueId: string, jobId: string): boolean {
    const job = this.data.queues.find((q) => q.id === queueId)?.jobs.find((item) => item.id === jobId);
    if (!job?.projectId) return false;
    delete job.projectId;
    this.save();
    return true;
  }

  schedule(queueId: string): boolean {
    if (!this.data.queues.some((q) => q.id === queueId)) return false;
    const runner = this.runner();
    if (runner.requestedQueueIds.includes(queueId)) return false;
    runner.requestedQueueIds.push(queueId);
    this.save();
    return true;
  }

  unschedule(queueId: string, persist = true): boolean {
    const runner = this.runner();
    const before = runner.requestedQueueIds.length;
    runner.requestedQueueIds = runner.requestedQueueIds.filter((id) => id !== queueId);
    if (runner.requestedQueueIds.length === 0) delete runner.paused;
    const changed = runner.requestedQueueIds.length !== before;
    if (changed && persist) this.save();
    return changed;
  }

  scheduledQueueIds(): string[] {
    return [...this.runner().requestedQueueIds];
  }

  pause(state: QueuePauseState): void {
    this.runner().paused = { ...state };
    this.save();
  }

  clearPause(): void {
    const runner = this.runner();
    if (!runner.paused) return;
    delete runner.paused;
    this.save();
  }

  pauseState(): QueuePauseState | undefined {
    const paused = this.runner().paused;
    return paused ? { ...paused } : undefined;
  }

  hasScheduledWork(): boolean {
    return this.runner().requestedQueueIds.length > 0;
  }

  hasRunningJob(queueId?: string): boolean {
    const queues = queueId
      ? this.data.queues.filter((q) => q.id === queueId)
      : this.data.queues;
    return queues.some((q) => q.jobs.some((j) => j.status === "running"));
  }

  /** Staging refs that must survive cleanup because the job can still run/retry. */
  stagedImageRefs(): Set<string> {
    const refs = new Set<string>();
    for (const queue of this.data.queues) {
      for (const job of queue.jobs) {
        if (job.status === "done") continue;
        for (const image of job.images ?? []) refs.add(image.ref);
      }
    }
    return refs;
  }

  usesStagedRef(ref: string): boolean {
    return this.stagedImageRefs().has(ref);
  }

  private load(): StoreFile {
    try {
      if (!existsSync(this.deps.filePath)) return { version: 1, queues: [], runner: { requestedQueueIds: [] } };
      const parsed = JSON.parse(readFileSync(this.deps.filePath, "utf8")) as StoreFile;
      if (parsed?.version !== 1 || !Array.isArray(parsed.queues)) return { version: 1, queues: [], runner: { requestedQueueIds: [] } };
      const queues = parsed.queues.map(normalizeQueue);
      const known = new Set(queues.map((q) => q.id));
      const requestedQueueIds = Array.isArray(parsed.runner?.requestedQueueIds)
        ? [...new Set(parsed.runner.requestedQueueIds.filter((id): id is string => typeof id === "string" && known.has(id)))]
        : [];
      return {
        version: 1,
        queues,
        runner: {
          requestedQueueIds,
          ...(parsed.runner?.paused && requestedQueueIds.length > 0 ? { paused: normalizePause(parsed.runner.paused) } : {}),
        },
      };
    } catch (error) {
      console.warn("[queue] failed to read queues file; starting with an empty queue:", error);
      return { version: 1, queues: [], runner: { requestedQueueIds: [] } };
    }
  }

  private save(): void {
    const dir = dirname(this.deps.filePath);
    mkdirSync(dir, { recursive: true });
    const tmp = `${this.deps.filePath}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(this.data, null, 2)}\n`, "utf8");
    renameSync(tmp, this.deps.filePath);
  }

  private runner(): NonNullable<StoreFile["runner"]> {
    return (this.data.runner ??= { requestedQueueIds: [] });
  }
}

function normalizeQueue(raw: QueueProjectVM): QueueProjectVM {
  const id = String(raw.id ?? "");
  const title = String(raw.title ?? "").trim();
  const ephemeralKind = raw.ephemeralKind === "home" || id === HOME_QUEUE_ID ? ("home" as const) : undefined;
  return {
    id,
    title: (ephemeralKind === "home" ? "home" : title || "project-1").slice(0, 80),
    createdAt: String(raw.createdAt ?? ""),
    jobs: Array.isArray(raw.jobs) ? raw.jobs.map(normalizeJob) : [],
    ...(ephemeralKind ? { ephemeralKind } : {}),
  };
}

function normalizeJob(raw: QueueJobVM): QueueJobVM {
  const status = raw.status;
  const images = normalizeStagedImages(raw.images);
  return {
    id: String(raw.id ?? ""),
    raw: String(raw.raw ?? ""),
    durationTier: ([1, 2, 3, 4] as const).includes(raw.durationTier as 1) ? (raw.durationTier as 1 | 2 | 3 | 4) : 1,
    videoLanguage: raw.videoLanguage === "en" ? "en" : "vi",
    voiceProvider: raw.voiceProvider === "elevenlabs" || raw.voiceProvider === "vieneu" ? raw.voiceProvider : "vivibe",
    bgm: typeof raw.bgm === "string" ? raw.bgm : null,
    status:
      status === "running" || status === "done" || status === "failed" || status === "cancelled"
        ? status
        : "queued",
    createdAt: String(raw.createdAt ?? ""),
    displayTitle:
      typeof raw.displayTitle === "string" && raw.displayTitle.trim()
        ? raw.displayTitle.trim().slice(0, 140)
        : defaultJobDisplayTitle(String(raw.raw ?? ""), Boolean(raw.smoke)),
    ...(raw.projectId ? { projectId: String(raw.projectId) } : {}),
    ...(raw.error ? { error: String(raw.error) } : {}),
    ...(raw.smoke ? { smoke: true as const } : {}),
    images,
  };
}

function normalizePause(raw: QueuePauseState): QueuePauseState {
  const kind = raw.kind === "voice_provider" || raw.kind === "full_auto_required" ? raw.kind : "manual";
  const voiceFailure = normalizeVoiceFailure(raw.voiceFailure);
  return {
    kind,
    message: typeof raw.message === "string" && raw.message.trim() ? raw.message.slice(0, 240) : "Hàng đợi đang tạm dừng.",
    ...(voiceFailure ? { voiceFailure } : {}),
  };
}

const VOICE_FAILURE_CODES = new Set([
  "not_configured",
  "invalid_api_key",
  "insufficient_credits",
  "plan_required",
  "rate_limited",
  "voice_not_found",
  "invalid_request",
  "provider_unavailable",
  "unknown",
]);

function normalizeVoiceFailure(raw: QueuePauseState["voiceFailure"]): QueuePauseState["voiceFailure"] {
  if (!raw || (raw.provider !== "vivibe" && raw.provider !== "elevenlabs" && raw.provider !== "vieneu") || !VOICE_FAILURE_CODES.has(raw.code)) {
    return undefined;
  }
  return {
    provider: raw.provider,
    code: raw.code,
    retryable: raw.retryable === true,
    ...(typeof raw.retryAfterMs === "number" && Number.isFinite(raw.retryAfterMs) && raw.retryAfterMs >= 0
      ? { retryAfterMs: raw.retryAfterMs }
      : {}),
  };
}

function cloneQueue(q: QueueProjectVM): QueueProjectVM {
  return {
    ...q,
    jobs: q.jobs.map((j) => ({ ...j, ...(j.images ? { images: j.images.map((image) => ({ ...image })) } : {}) })),
    ...(q.ephemeralKind ? { ephemeralKind: q.ephemeralKind } : {}),
  };
}

export function queueStorePath(videoToolHome: string): string {
  return join(videoToolHome, "queues.json");
}
