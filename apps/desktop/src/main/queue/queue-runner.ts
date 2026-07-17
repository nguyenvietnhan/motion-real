import type { CreateController } from "../create/create-controller.js";
import type { ProjectStage } from "../../shared/types.js";
import type { QueueRunnerStatus, QueueStartResult } from "../../shared/queue-types.js";
import { isEphemeralHomeQueue, shouldAutoDeleteHomeQueue, type QueueStore } from "./queue-store.js";

export type QueueRunnerDeps = {
  store: QueueStore;
  create: CreateController;
  /** Smoke job: silent ~10s project; same path as Settings smoke, after Start only. */
  createSmoke: (input: {
    raw: string;
    videoLanguage: "vi" | "en";
  }) => Promise<{ ok: true; projectId: string } | { ok: false; error: string }>;
  /** Live workspace stage for a video project. */
  stageOf: (projectId: string) => Promise<ProjectStage>;
  /** Cancel in-flight workspace job (Dừng). */
  cancelProject: (projectId: string) => void;
  /** Apply default project-N name on the real video project. */
  renameProject?: (projectId: string, title: string) => Promise<void>;
  /** Best-effort title after full render (manifest). */
  projectTitle?: (projectId: string) => Promise<string | undefined>;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
};

/**
 * Serial queue runner across containers (queue-of-queues).
 * Process concurrency = 1: drain active container jobs, then next pending Start.
 * Add-job never calls this. Pending schedule is RAM-only (not in queues.json).
 */
export class QueueRunner {
  private busy = false;
  private activeQueueId: string | null = null;
  /** FIFO of containers waiting after the active one. */
  private pendingQueueIds: string[] = [];
  private currentJobId: string | null = null;
  private currentProjectId: string | null = null;
  /** Set when user hits Dừng on the running job — waitTerminal exits as cancelled. */
  private cancelRequested = false;

  constructor(private readonly deps: QueueRunnerDeps) {}

  isBusy(): boolean {
    return this.busy;
  }

  activeQueue(): string | null {
    return this.activeQueueId;
  }

  pendingQueues(): string[] {
    return [...this.pendingQueueIds];
  }

  status(): QueueRunnerStatus {
    return {
      busy: this.busy,
      activeQueueId: this.activeQueueId,
      pendingQueueIds: this.pendingQueues(),
    };
  }

  /**
   * Remove a container from the pending schedule (not the active run).
   * Returns true if it was pending.
   */
  unschedule(queueId: string): boolean {
    const before = this.pendingQueueIds.length;
    this.pendingQueueIds = this.pendingQueueIds.filter((id) => id !== queueId);
    return this.pendingQueueIds.length < before;
  }

  /**
   * Kick off or schedule serial processing. Returns immediately.
   * When another container is already draining, this container is enqueued FIFO.
   */
  start(queueId: string): QueueStartResult {
    const q = this.deps.store.get(queueId);
    if (!q) return { ok: false, error: "Không tìm thấy hàng đợi." };

    // Idempotent while already active/pending (running job is not status `queued`).
    if (this.busy && this.activeQueueId === queueId) {
      return { ok: true, mode: "already_running" };
    }
    if (this.pendingQueueIds.includes(queueId)) {
      return { ok: true, mode: "already_scheduled" };
    }

    // Retry path: failed/cancelled (e.g. missing API key) become queued again.
    this.deps.store.requeueRetryable(queueId);
    const ready = this.deps.store.get(queueId);
    if (!ready?.jobs.some((j) => j.status === "queued")) {
      return { ok: false, error: "Chưa có video nào ở trạng thái chờ. Thêm prompt rồi bấm Bắt đầu." };
    }

    if (this.busy) {
      this.pendingQueueIds.push(queueId);
      this.deps.log?.("queue container scheduled", {
        queueId,
        after: this.activeQueueId,
        pending: this.pendingQueueIds.length,
      });
      return { ok: true, mode: "scheduled" };
    }

    this.busy = true;
    this.activeQueueId = queueId;
    this.cancelRequested = false;
    void this.runAll().finally(() => {
      this.busy = false;
      this.activeQueueId = null;
      this.pendingQueueIds = [];
      this.currentJobId = null;
      this.currentProjectId = null;
      this.cancelRequested = false;
    });
    return { ok: true, mode: "started" };
  }

  /**
   * Stop the currently running job only; mark cancelled and continue with next queued.
   */
  cancelJob(queueId: string, jobId: string): { ok: true } | { ok: false; error: string } {
    if (!this.busy || this.activeQueueId !== queueId || this.currentJobId !== jobId) {
      return { ok: false, error: "Video này không đang chạy." };
    }
    this.cancelRequested = true;
    if (this.currentProjectId) {
      try {
        this.deps.cancelProject(this.currentProjectId);
      } catch {
        /* cancel is best-effort */
      }
    }
    return { ok: true };
  }

  /** Drain active container, then each pending Start in order. */
  private async runAll(): Promise<void> {
    const log = this.deps.log ?? (() => {});

    for (;;) {
      const queueId = this.activeQueueId;
      if (!queueId) break;

      // Container may have been deleted mid-schedule.
      if (!this.deps.store.get(queueId)) {
        log("queue container missing, skip", { queueId });
      } else {
        log("queue container start", { queueId });
        await this.drainJobs(queueId);
        log("queue container done", { queueId });
        this.maybeAutoDeleteHome(queueId, log);
      }

      const next = this.pickNextPending();
      if (!next) break;
      this.activeQueueId = next;
      this.currentJobId = null;
      this.currentProjectId = null;
      this.cancelRequested = false;
    }
  }

  /** Drop ephemeral home after drain when no work/fail left (videos stay in gallery). */
  private maybeAutoDeleteHome(
    queueId: string,
    log: (msg: string, extra?: Record<string, unknown>) => void,
  ): void {
    const q = this.deps.store.get(queueId);
    if (!q || !isEphemeralHomeQueue(q) || !shouldAutoDeleteHomeQueue(q)) return;
    this.unschedule(queueId);
    this.deps.store.delete(queueId);
    log("queue home ephemeral deleted", { queueId });
  }

  /**
   * Next pending id that still exists and has work (requeue failed first).
   * Drops missing/empty entries from the front until one is ready or list ends.
   */
  private pickNextPending(): string | null {
    while (this.pendingQueueIds.length > 0) {
      const next = this.pendingQueueIds.shift()!;
      const q = this.deps.store.get(next);
      if (!q) continue;
      this.deps.store.requeueRetryable(next);
      const ready = this.deps.store.get(next);
      if (ready?.jobs.some((j) => j.status === "queued")) return next;
    }
    return null;
  }

  private async drainJobs(queueId: string): Promise<void> {
    const sleep = this.deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    const log = this.deps.log ?? (() => {});

    for (;;) {
      const job = this.deps.store.nextQueuedJob(queueId);
      if (!job) break;

      this.cancelRequested = false;
      this.currentJobId = job.id;
      this.currentProjectId = null;
      this.deps.store.updateJob(queueId, job.id, { status: "running", error: "" });
      log("queue job start", { queueId, jobId: job.id });

      try {
        let projectId: string;
        if (job.smoke) {
          const smoke = await this.deps.createSmoke({
            raw: job.raw,
            videoLanguage: job.videoLanguage,
          });
          if (!smoke.ok) throw new Error(smoke.error);
          projectId = smoke.projectId;
        } else {
          const created = await this.deps.create.create(job.raw, [], {
            durationTier: job.durationTier,
            videoLanguage: job.videoLanguage,
            voiceProvider: job.voiceProvider,
            bgm: job.bgm,
          });
          projectId = created.projectId;
        }
        this.currentProjectId = projectId;
        // Until AI returns a clip title: show the user prompt (or "Smoke test").
        const label =
          job.displayTitle?.trim() ||
          (job.smoke ? "Smoke test" : job.raw.trim().replace(/\s+/g, " ").slice(0, 140) || "Untitled");
        if (this.deps.renameProject) {
          await this.deps.renameProject(projectId, label).catch(() => undefined);
        }
        this.deps.store.updateJob(queueId, job.id, { projectId, displayTitle: label });

        if (this.cancelRequested) {
          this.deps.store.updateJob(queueId, job.id, { status: "cancelled", error: "" });
          log("queue job cancelled early", { queueId, jobId: job.id, projectId });
          continue;
        }

        const terminal = await this.waitTerminal(projectId, sleep);
        if (terminal.kind === "cancelled") {
          this.deps.store.updateJob(queueId, job.id, { status: "cancelled", error: "" });
          log("queue job cancelled", { queueId, jobId: job.id, projectId });
        } else if (terminal.kind === "published") {
          let displayTitle: string | undefined;
          try {
            displayTitle = await this.deps.projectTitle?.(projectId);
          } catch {
            /* title is best-effort */
          }
          if (displayTitle && this.deps.renameProject) {
            await this.deps.renameProject(projectId, displayTitle).catch(() => undefined);
          }
          this.deps.store.updateJob(queueId, job.id, {
            status: "done",
            ...(displayTitle ? { displayTitle } : {}),
          });
          log("queue job done", { queueId, jobId: job.id, projectId });
        } else {
          this.deps.store.updateJob(queueId, job.id, {
            status: "failed",
            error: terminal.message ?? "Video lỗi hoặc dừng giữa chừng.",
          });
          log("queue job failed", { queueId, jobId: job.id, projectId, message: terminal.message });
        }
      } catch (error) {
        if (this.cancelRequested) {
          this.deps.store.updateJob(queueId, job.id, { status: "cancelled", error: "" });
        } else {
          const message = error instanceof Error ? error.message : String(error);
          this.deps.store.updateJob(queueId, job.id, {
            status: "failed",
            error: message.slice(0, 240),
          });
          log("queue job create failed", { queueId, jobId: job.id, message });
        }
      }
    }
  }

  private async waitTerminal(
    projectId: string,
    sleep: (ms: number) => Promise<void>,
  ): Promise<
    | { kind: "published" }
    | { kind: "failed"; message?: string }
    | { kind: "cancelled" }
  > {
    for (;;) {
      if (this.cancelRequested) return { kind: "cancelled" };
      const stage = await this.deps.stageOf(projectId);
      if (stage.kind === "published") return { kind: "published" };
      if (stage.kind === "error") {
        return { kind: "failed", message: stage.message || "Lỗi sản xuất." };
      }
      await sleep(2000);
    }
  }
}
