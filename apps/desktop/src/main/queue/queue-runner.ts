import type { CreateController } from "../create/create-controller.js";
import type { ProjectStage } from "../../shared/types.js";
import type { QueueStore } from "./queue-store.js";

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
 * Serial queue runner: only processes jobs after explicit start.
 * Add-job never calls this. // ponytail: one queue run at a time process-wide
 */
export class QueueRunner {
  private busy = false;
  private activeQueueId: string | null = null;
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

  /**
   * Kick off background serial processing. Returns immediately.
   * Only jobs already `queued` are run; jobs added mid-run stay queued until next start.
   */
  start(queueId: string): { ok: true } | { ok: false; error: string } {
    if (this.busy) {
      return { ok: false, error: "Hàng đợi đang chạy — chờ xong hoặc đợi hết list hiện tại." };
    }
    const q = this.deps.store.get(queueId);
    if (!q) return { ok: false, error: "Không tìm thấy hàng đợi." };
    if (!q.jobs.some((j) => j.status === "queued")) {
      return { ok: false, error: "Chưa có video nào ở trạng thái chờ. Thêm prompt rồi bấm Bắt đầu." };
    }
    this.busy = true;
    this.activeQueueId = queueId;
    this.cancelRequested = false;
    void this.runLoop(queueId).finally(() => {
      this.busy = false;
      this.activeQueueId = null;
      this.currentJobId = null;
      this.currentProjectId = null;
      this.cancelRequested = false;
    });
    return { ok: true };
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

  private async runLoop(queueId: string): Promise<void> {
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
        // Default name like gallery: project-1, project-2… until AI sets full title.
        const label = job.displayTitle?.trim() || (job.smoke ? "Smoke test" : "project-1");
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
