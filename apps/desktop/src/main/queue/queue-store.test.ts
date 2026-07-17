import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultJobDisplayTitle,
  HOME_QUEUE_ID,
  isEphemeralHomeQueue,
  QueueStore,
  shouldAutoDeleteHomeQueue,
} from "./queue-store.js";

describe("QueueStore", () => {
  it("defaults new queue titles to project-1, project-2, …", () => {
    const dir = mkdtempSync(join(tmpdir(), "mr-queue-"));
    const store = new QueueStore({
      filePath: join(dir, "queues.json"),
      id: (() => {
        let n = 0;
        return () => `t${++n}`;
      })(),
    });
    expect(store.create().title).toBe("project-1");
    expect(store.create().title).toBe("project-2");
    store.create("project-9");
    expect(store.create().title).toBe("project-10");
  });

  it("creates a queue and appends jobs in order", () => {
    const dir = mkdtempSync(join(tmpdir(), "mr-queue-"));
    const store = new QueueStore({
      filePath: join(dir, "queues.json"),
      now: () => "2026-01-01T00:00:00.000Z",
      id: (() => {
        let n = 0;
        return () => `id${++n}`;
      })(),
    });

    const q = store.create("Batch A");
    expect(q.title).toBe("Batch A");
    expect(q.jobs).toEqual([]);

    const after1 = store.addJob(q.id, {
      raw: "video một",
      durationTier: 1,
      videoLanguage: "vi",
      voiceProvider: "vivibe",
      bgm: null,
    });
    expect(after1?.jobs).toHaveLength(1);
    expect(after1?.jobs[0]?.raw).toBe("video một");
    expect(after1?.jobs[0]?.status).toBe("queued");

    const after2 = store.addJob(q.id, {
      raw: "video hai",
      durationTier: 2,
      videoLanguage: "en",
      voiceProvider: "elevenlabs",
      bgm: "track.mp3",
    });
    expect(after2?.jobs.map((j) => j.raw)).toEqual(["video một", "video hai"]);
    expect(store.list()).toHaveLength(1);
    expect(store.get(q.id)?.jobs).toHaveLength(2);
  });

  it("rejects empty raw and missing queue", () => {
    const dir = mkdtempSync(join(tmpdir(), "mr-queue-"));
    const store = new QueueStore({ filePath: join(dir, "queues.json") });
    const q = store.create();
    expect(store.addJob(q.id, {
      raw: "   ",
      durationTier: 1,
      videoLanguage: "vi",
      voiceProvider: "vivibe",
      bgm: null,
    })).toBeNull();
    expect(store.addJob("nope", {
      raw: "x",
      durationTier: 1,
      videoLanguage: "vi",
      voiceProvider: "vivibe",
      bgm: null,
    })).toBeNull();
  });

  it("renames queue, updates and deletes queued jobs", () => {
    const dir = mkdtempSync(join(tmpdir(), "mr-queue-"));
    const store = new QueueStore({
      filePath: join(dir, "queues.json"),
      id: (() => {
        let n = 0;
        return () => `z${++n}`;
      })(),
    });
    const q = store.create("Cũ");
    expect(store.rename(q.id, "Mới")?.title).toBe("Mới");
    const withJob = store.addJob(q.id, {
      raw: "prompt dài để cắt tiêu đề hiển thị cho card",
      durationTier: 2,
      videoLanguage: "vi",
      voiceProvider: "vivibe",
      bgm: null,
    });
    const jobId = withJob!.jobs[0]!.id;
    expect(withJob!.jobs[0]!.displayTitle).toBe("prompt dài để cắt tiêu đề hiển thị cho card");
    const edited = store.updateJobInput(q.id, jobId, { raw: "đã sửa", durationTier: 3 });
    expect(edited?.jobs[0]?.raw).toBe("đã sửa");
    expect(edited?.jobs[0]?.durationTier).toBe(3);
    expect(edited?.jobs[0]?.displayTitle).toBe("đã sửa");
    expect(store.deleteJob(q.id, jobId)?.jobs).toHaveLength(0);
  });

  it("job displayTitle is the prompt until replaced later", () => {
    expect(defaultJobDisplayTitle("  làm video chip   ")).toBe("làm video chip");
    expect(defaultJobDisplayTitle("x", true)).toBe("Smoke test");
    const dir = mkdtempSync(join(tmpdir(), "mr-queue-"));
    const store = new QueueStore({ filePath: join(dir, "queues.json") });
    const q = store.create();
    const after = store.addJob(q.id, {
      raw: "Video về pin điện thoại",
      durationTier: 1,
      videoLanguage: "vi",
      voiceProvider: "vivibe",
      bgm: null,
    });
    expect(after?.jobs[0]?.displayTitle).toBe("Video về pin điện thoại");
    store.updateJob(q.id, after!.jobs[0]!.id, { displayTitle: "Pin điện thoại 2026" });
    expect(store.get(q.id)?.jobs[0]?.displayTitle).toBe("Pin điện thoại 2026");
  });

  it("deletes a queue project", () => {
    const dir = mkdtempSync(join(tmpdir(), "mr-queue-"));
    const store = new QueueStore({ filePath: join(dir, "queues.json") });
    const q = store.create("Xóa tôi");
    expect(store.delete(q.id)).toBe(true);
    expect(store.get(q.id)).toBeNull();
    expect(store.list()).toHaveLength(0);
    expect(store.delete(q.id)).toBe(false);
  });

  it("reconcileStaleRunningJobs marks crash leftovers failed", () => {
    const dir = mkdtempSync(join(tmpdir(), "mr-queue-"));
    const store = new QueueStore({ filePath: join(dir, "queues.json") });
    const q = store.create();
    store.addJob(q.id, {
      raw: "zombie",
      durationTier: 1,
      videoLanguage: "vi",
      voiceProvider: "vivibe",
      bgm: null,
    });
    store.addJob(q.id, {
      raw: "still-waiting",
      durationTier: 1,
      videoLanguage: "vi",
      voiceProvider: "vivibe",
      bgm: null,
    });
    const jobs = store.get(q.id)!.jobs;
    store.updateJob(q.id, jobs[0]!.id, { status: "running", projectId: "p-zombie" });
    expect(store.reconcileStaleRunningJobs()).toBe(1);
    const after = store.get(q.id)!.jobs;
    expect(after[0]?.status).toBe("failed");
    expect(after[0]?.projectId).toBe("p-zombie");
    expect(after[0]?.error).toMatch(/dừng giữa chừng/i);
    expect(after[1]?.status).toBe("queued");
    expect(store.reconcileStaleRunningJobs()).toBe(0);
    // Start path can requeue the failed zombie.
    expect(store.requeueRetryable(q.id)).toBe(1);
    expect(store.get(q.id)?.jobs[0]?.status).toBe("queued");
  });

  it("requeueRetryable puts failed jobs back to queued for Start retry", () => {
    const dir = mkdtempSync(join(tmpdir(), "mr-queue-"));
    const store = new QueueStore({ filePath: join(dir, "queues.json") });
    const q = store.create();
    const after = store.addJob(q.id, {
      raw: "retry me",
      durationTier: 1,
      videoLanguage: "vi",
      voiceProvider: "vivibe",
      bgm: null,
    });
    const jobId = after!.jobs[0]!.id;
    store.updateJob(q.id, jobId, { status: "failed", error: "no key", projectId: "p-old" });
    expect(store.requeueRetryable(q.id)).toBe(1);
    const job = store.get(q.id)?.jobs[0];
    expect(job?.status).toBe("queued");
    expect(job?.error).toBeUndefined();
    expect(job?.projectId).toBeUndefined();
    expect(store.requeueRetryable(q.id)).toBe(0);
  });

  it("ensureHomeQueue is idempotent with fixed id and ephemeral flag", () => {
    const dir = mkdtempSync(join(tmpdir(), "mr-queue-"));
    const store = new QueueStore({ filePath: join(dir, "queues.json") });
    const a = store.ensureHomeQueue();
    expect(a.id).toBe(HOME_QUEUE_ID);
    expect(a.title).toBe("home");
    expect(a.ephemeralKind).toBe("home");
    expect(isEphemeralHomeQueue(a)).toBe(true);
    store.addJob(a.id, {
      raw: "from home",
      durationTier: 1,
      videoLanguage: "vi",
      voiceProvider: "vivibe",
      bgm: null,
    });
    const b = store.ensureHomeQueue();
    expect(b.id).toBe(HOME_QUEUE_ID);
    expect(b.jobs).toHaveLength(1);
    expect(store.list().filter((q) => q.id === HOME_QUEUE_ID)).toHaveLength(1);
    expect(store.rename(HOME_QUEUE_ID, "other")).toBeNull();
    expect(store.get(HOME_QUEUE_ID)?.title).toBe("home");
  });

  it("shouldAutoDeleteHomeQueue only when no work or failed jobs remain", () => {
    const dir = mkdtempSync(join(tmpdir(), "mr-queue-"));
    const store = new QueueStore({ filePath: join(dir, "queues.json") });
    const home = store.ensureHomeQueue();
    expect(shouldAutoDeleteHomeQueue(home)).toBe(true);
    store.addJob(home.id, {
      raw: "x",
      durationTier: 1,
      videoLanguage: "vi",
      voiceProvider: "vivibe",
      bgm: null,
    });
    const withQueued = store.get(home.id)!;
    expect(shouldAutoDeleteHomeQueue(withQueued)).toBe(false);
    const jobId = withQueued.jobs[0]!.id;
    store.updateJob(home.id, jobId, { status: "failed", error: "x" });
    expect(shouldAutoDeleteHomeQueue(store.get(home.id)!)).toBe(false);
    store.updateJob(home.id, jobId, { status: "done", error: "" });
    expect(shouldAutoDeleteHomeQueue(store.get(home.id)!)).toBe(true);
    const normal = store.create("user");
    expect(shouldAutoDeleteHomeQueue(normal)).toBe(false);
  });

  it("updateJob and nextQueuedJob support start-later workflow", () => {
    const dir = mkdtempSync(join(tmpdir(), "mr-queue-"));
    const store = new QueueStore({
      filePath: join(dir, "queues.json"),
      id: (() => {
        let n = 0;
        return () => `n${++n}`;
      })(),
    });
    const q = store.create();
    store.addJob(q.id, {
      raw: "a",
      durationTier: 1,
      videoLanguage: "vi",
      voiceProvider: "vivibe",
      bgm: null,
    });
    store.addJob(q.id, {
      raw: "b",
      durationTier: 1,
      videoLanguage: "vi",
      voiceProvider: "vivibe",
      bgm: null,
    });
    const first = store.nextQueuedJob(q.id);
    expect(first?.raw).toBe("a");
    store.updateJob(q.id, first!.id, { status: "running", projectId: "p1" });
    expect(store.nextQueuedJob(q.id)?.raw).toBe("b");
    expect(store.hasRunningJob(q.id)).toBe(true);
    store.updateJob(q.id, first!.id, { status: "done" });
    expect(store.hasRunningJob(q.id)).toBe(false);
  });
});
