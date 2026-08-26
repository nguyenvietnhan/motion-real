import type { CreateController } from "../create/create-controller.js";
import type { ProjectStage } from "../../shared/types.js";
import { isVoiceProviderError } from "@motionreal/pipeline";
import type { QueuePauseState, QueueRunnerStatus, QueueStartResult } from "../../shared/queue-types.js";
import { isEphemeralHomeQueue, shouldAutoDeleteHomeQueue, type QueueStore } from "./queue-store.js";
import { classifyQueueWaitStage } from "./queue-stage.js";

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
  /** Queue is unattended-only; false blocks Start before retrying any job. */
  fullAutoReady?: () => boolean;
  /** Continue a project already linked to a persisted Queue job. */
  resumeProject?: (projectId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  projectExists?: (projectId: string) => boolean;
};

/**
 * Serial queue runner across containers (queue-of-queues).
 * Process concurrency = 1: drain active container jobs, then next pending Start.
 * Add-job never calls this. Start intent is persisted in queues.json for restart recovery.
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
  private pauseRequested = false;

  constructor(private readonly deps: QueueRunnerDeps) {}

  isBusy(): boolean {
    return this.busy;
  }

  activeQueue(): string | null {
    return this.activeQueueId;
  }

  pendingQueues(): string[] {
    if (!this.busy && this.deps.store.pauseState()) return this.deps.store.scheduledQueueIds();
    return [...this.pendingQueueIds];
  }

  status(): QueueRunnerStatus {
    return {
      busy: this.busy,
      activeQueueId: this.activeQueueId,
      pendingQueueIds: this.pendingQueues(),
      ...(this.deps.store.pauseState() ? { paused: this.deps.store.pauseState() } : {}),
    };
  }

  hasScheduledWork(): boolean {
    return this.deps.store.hasScheduledWork();
  }

  /**
   * Remove a container from the pending schedule (not the active run).
   * Returns true if it was pending.
   */
  unschedule(queueId: string): boolean {
    const before = this.pendingQueueIds.length;
    this.pendingQueueIds = this.pendingQueueIds.filter((id) => id !== queueId);
    const removed = this.pendingQueueIds.length < before;
    return this.deps.store.unschedule(queueId) || removed;
  }

  /**
   * Kick off or schedule serial processing. Returns immediately.
   * When another container is already draining, this container is enqueued FIFO.
   */
  start(queueId: string): QueueStartResult {
    const q = this.deps.store.get(queueId);
    if (!q) return { ok: false, error: "Không tìm thấy hàng đợi." };
    const paused = this.deps.store.pauseState();
    if (paused) return { ok: false, code: "QUEUE_PAUSED", error: paused.message };
    if (this.deps.fullAutoReady && !this.deps.fullAutoReady()) {
      return {
        ok: false,
        code: "FULL_AUTO_REQUIRED",
        error: "Hàng đợi cần chế độ Full auto: bỏ duyệt kịch bản, bỏ duyệt ảnh và chọn Bỏ qua chỉnh.",
      };
    }

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
      // Crash window: the last job may already be persisted as done while the
      // container's persisted Start intent has not yet been removed.
      this.deps.store.unschedule(queueId);
      return { ok: false, error: "Chưa có video nào ở trạng thái chờ. Thêm prompt rồi bấm Bắt đầu." };
    }
    this.deps.store.schedule(queueId);

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
    this.pauseRequested = false;
    // Cleanup / re-entry lives in runAll finally — never wipe pending here.
    void this.runAll();
    return { ok: true, mode: "started" };
  }

  /** Restore persisted Start intent after project reconciliation on app startup. */
  restore(): QueueStartResult | null {
    const ids = this.deps.store.scheduledQueueIds();
    if (ids.length === 0) return null;
    const paused = this.deps.store.pauseState();
    if (paused) return { ok: false, code: "QUEUE_PAUSED", error: paused.message };
    if (this.deps.fullAutoReady && !this.deps.fullAutoReady()) {
      const state: QueuePauseState = {
        kind: "full_auto_required",
        message: "Hàng đợi đã được lưu nhưng Full auto không còn hợp lệ. Bật Full auto rồi tiếp tục.",
      };
      this.deps.store.pause(state);
      return { ok: false, code: "FULL_AUTO_REQUIRED", error: state.message };
    }
    let result: QueueStartResult | null = null;
    for (const id of ids) result = this.start(id);
    return result;
  }

  pause(): { ok: true } | { ok: false; error: string } {
    if (!this.deps.store.hasScheduledWork()) return { ok: false, error: "Không có hàng đợi nào đang chạy hoặc chờ." };
    this.deps.store.pause({ kind: "manual", message: "Hàng đợi đã được tạm dừng theo yêu cầu." });
    this.pauseRequested = true;
    this.cancelRequested = true;
    if (this.currentProjectId) {
      try {
        this.deps.cancelProject(this.currentProjectId);
      } catch (error) {
        this.deps.log?.("queue project pause cancel failed", {
          error: String(error),
          projectId: this.currentProjectId,
        });
      }
    }
    return { ok: true };
  }

  resume(): QueueStartResult {
    if (!this.deps.store.pauseState()) return { ok: false, error: "Hàng đợi không ở trạng thái tạm dừng." };
    this.deps.store.clearPause();
    this.pauseRequested = false;
    this.cancelRequested = false;
    return this.restore() ?? { ok: false, error: "Không còn hàng đợi nào cần tiếp tục." };
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
      } catch (error) {
        this.deps.log?.("queue project cancel failed", { error: String(error), projectId: this.currentProjectId });
      }
    }
    return { ok: true };
  }

  /**
   * Drain active container, then each pending Start in order.
   * After each await, re-pick pending so concurrent start() (e.g. Home spill) is not lost.
   * finally: if start() pushed pending in the race after last empty pick, re-enter — never wipe.
   */
  private async runAll(): Promise<void> {
    const log = this.deps.log ?? (() => {});

    try {
      for (;;) {
        if (this.deps.store.pauseState()) break;
        if (!this.activeQueueId) {
          const next = this.pickNextPending();
          if (!next) break;
          this.activeQueueId = next;
          this.currentJobId = null;
          this.currentProjectId = null;
          this.cancelRequested = false;
        }

        const queueId = this.activeQueueId;
        // Container may have been deleted mid-schedule.
        if (!this.deps.store.get(queueId)) {
          log("queue container missing, skip", { queueId });
        } else {
          log("queue container start", { queueId });
          const paused = await this.drainJobs(queueId);
          if (paused) break;
          log("queue container done", { queueId });
          this.deps.store.unschedule(queueId);
          this.maybeAutoDeleteHome(queueId, log);
        }

        // Clear active so the next loop iteration picks concurrent schedules
        // that arrived during drainJobs (Home spill, second Start, etc.).
        this.activeQueueId = null;
        this.currentJobId = null;
        this.currentProjectId = null;
      }
    } finally {
      if (this.deps.store.pauseState()) {
        this.busy = false;
        this.activeQueueId = null;
        this.pendingQueueIds = [];
        this.currentJobId = null;
        this.currentProjectId = null;
        this.cancelRequested = false;
        this.pauseRequested = false;
        return;
      }
      // Microtask / IPC race: start() may push pending after our last empty pick
      // and before busy is cleared. Re-enter instead of wiping the schedule.
      if (this.pendingQueueIds.length > 0) {
        const next = this.pickNextPending();
        if (next) {
          this.activeQueueId = next;
          this.currentJobId = null;
          this.currentProjectId = null;
          this.cancelRequested = false;
          log("queue chain re-enter after concurrent schedule", { queueId: next });
          await this.runAll();
          return;
        }
      }
      this.busy = false;
      this.activeQueueId = null;
      this.pendingQueueIds = [];
      this.currentJobId = null;
      this.currentProjectId = null;
      this.cancelRequested = false;
      this.pauseRequested = false;
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

  private async drainJobs(queueId: string): Promise<boolean> {
    const sleep = this.deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    const log = this.deps.log ?? (() => {});

    for (;;) {
      if (this.deps.store.pauseState()) return true;
      const job = this.deps.store.nextQueuedJob(queueId);
      if (!job) return false;

      this.cancelRequested = false;
      this.currentJobId = job.id;
      this.currentProjectId = null;
      this.deps.store.updateJob(queueId, job.id, { status: "running", error: "" });
      log("queue job start", { queueId, jobId: job.id });

      try {
        let projectId = job.projectId;
        if (projectId && this.deps.projectExists && !this.deps.projectExists(projectId)) {
          this.deps.store.clearJobProjectId(queueId, job.id);
          projectId = undefined;
        }
        if (projectId) {
          this.currentProjectId = projectId;
          const resumed = this.deps.resumeProject
            ? await this.deps.resumeProject(projectId)
            : { ok: false as const, error: "Không có cơ chế tiếp tục project cũ." };
          if (!resumed.ok) {
            this.deps.store.updateJob(queueId, job.id, { status: "failed", error: resumed.error });
            log("queue existing project cannot resume", { queueId, jobId: job.id, projectId, error: resumed.error });
            continue;
          }
        } else if (job.smoke) {
          const smoke = await this.deps.createSmoke({
            raw: job.raw,
            videoLanguage: job.videoLanguage,
          });
          if (!smoke.ok) throw new Error(smoke.error);
          projectId = smoke.projectId;
        } else {
          const created = await this.deps.create.create(job.raw, job.images ?? [], {
            durationTier: job.durationTier,
            videoLanguage: job.videoLanguage,
            voiceProvider: job.voiceProvider,
            bgm: job.bgm,
          });
          projectId = created.projectId;
        }
        if (!projectId) throw new Error("Không tạo được project cho Queue job.");
        this.currentProjectId = projectId;
        // Until AI returns a clip title: show the user prompt (or "Smoke test").
        const label =
          job.displayTitle?.trim() ||
          (job.smoke ? "Smoke test" : job.raw.trim().replace(/\s+/g, " ").slice(0, 140) || "Untitled");
        if (this.deps.renameProject) {
          await this.deps.renameProject(projectId, label).catch((error) => {
            log("queue project rename failed", { queueId, jobId: job.id, projectId, error: String(error) });
          });
        }
        this.deps.store.updateJob(queueId, job.id, { projectId, displayTitle: label });

        if (this.cancelRequested) {
          this.deps.store.updateJob(queueId, job.id, { status: "cancelled", error: "" });
          log("queue job cancelled early", { queueId, jobId: job.id, projectId });
          if (this.pauseRequested) return true;
          continue;
        }

        const terminal = await this.waitTerminal(projectId, sleep);
        if (terminal.kind === "cancelled") {
          this.deps.store.updateJob(queueId, job.id, { status: "cancelled", error: "" });
          log("queue job cancelled", { queueId, jobId: job.id, projectId });
          if (this.pauseRequested) return true;
        } else if (terminal.kind === "published") {
          let displayTitle: string | undefined;
          try {
            displayTitle = await this.deps.projectTitle?.(projectId);
          } catch (error) {
            log("queue project title unavailable", { queueId, jobId: job.id, projectId, error: String(error) });
          }
          if (displayTitle && this.deps.renameProject) {
            await this.deps.renameProject(projectId, displayTitle).catch((error) => {
              log("queue final title rename failed", { queueId, jobId: job.id, projectId, error: String(error) });
            });
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
          if (terminal.voiceFailure) {
            this.pauseForVoiceFailure(terminal.message ?? "Nhà cung cấp giọng đọc gặp sự cố.", terminal.voiceFailure);
            return true;
          }
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
          if (isVoiceProviderError(error)) {
            this.pauseForVoiceFailure(message, error.failure);
            return true;
          }
        }
      }
    }
  }

  private pauseForVoiceFailure(message: string, voiceFailure: NonNullable<QueuePauseState["voiceFailure"]>): void {
    this.deps.store.pause({
      kind: "voice_provider",
      message,
      voiceFailure,
    });
    this.pauseRequested = true;
  }

  private async waitTerminal(
    projectId: string,
    sleep: (ms: number) => Promise<void>,
  ): Promise<
    | { kind: "published" }
    | { kind: "failed"; message?: string; voiceFailure?: NonNullable<QueuePauseState["voiceFailure"]> }
    | { kind: "cancelled" }
  > {
    for (;;) {
      if (this.cancelRequested) return { kind: "cancelled" };
      const stage = await this.deps.stageOf(projectId);
      const classified = classifyQueueWaitStage(stage);
      if (classified.action === "published") return { kind: "published" };
      if (classified.action === "failed") {
        return { kind: "failed", message: classified.message, ...(classified.voiceFailure ? { voiceFailure: classified.voiceFailure } : {}) };
      }
      await sleep(2000);
    }
  }
}
