import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOME_QUEUE_ID, QueueStore } from "./queue-store.js";
import { QueueRunner } from "./queue-runner.js";
import type { CreateController } from "../create/create-controller.js";
import type { ProjectStage } from "../../shared/types.js";

function jobInput(raw: string) {
  return {
    raw,
    durationTier: 1 as const,
    videoLanguage: "vi" as const,
    voiceProvider: "vivibe" as const,
    bgm: null,
  };
}

async function waitUntilIdle(runner: QueueRunner, max = 80): Promise<void> {
  for (let i = 0; i < max && runner.isBusy(); i += 1) {
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("QueueRunner", () => {
  it("does not run until start; start processes queued jobs serially", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mr-qrun-"));
    const store = new QueueStore({
      filePath: join(dir, "queues.json"),
      id: (() => {
        let n = 0;
        return () => `x${++n}`;
      })(),
    });
    const q = store.create();
    store.addJob(q.id, jobInput("one"));
    store.addJob(q.id, jobInput("two"));

    const order: string[] = [];
    const create = {
      create: vi.fn(async (raw: string) => {
        order.push(raw);
        return { projectId: `p-${raw}` };
      }),
    } as unknown as CreateController;

    const stages = new Map<string, ProjectStage>([
      ["p-one", { kind: "published", outputPath: "/out/one.mp4", title: "one" }],
      ["p-two", { kind: "published", outputPath: "/out/two.mp4", title: "two" }],
    ]);

    const runner = new QueueRunner({
      store,
      create,
      createSmoke: async () => ({ ok: false as const, error: "not used" }),
      stageOf: async (id) => stages.get(id) ?? { kind: "writing" },
      cancelProject: () => {},
      sleep: async () => {},
    });

    expect(create.create).not.toHaveBeenCalled();
    expect(store.get(q.id)?.jobs.every((j) => j.status === "queued")).toBe(true);

    const kick = runner.start(q.id);
    expect(kick).toEqual({ ok: true, mode: "started" });
    await waitUntilIdle(runner);
    expect(order).toEqual(["one", "two"]);
    expect(store.get(q.id)?.jobs.map((j) => j.status)).toEqual(["done", "done"]);
  });

  it("start requeues failed jobs so retry works after a fix", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mr-qrun-"));
    const store = new QueueStore({
      filePath: join(dir, "queues.json"),
      id: (() => {
        let n = 0;
        return () => `r${++n}`;
      })(),
    });
    const q = store.create();
    store.addJob(q.id, jobInput("again"));
    const jobId = store.get(q.id)!.jobs[0]!.id;
    store.updateJob(q.id, jobId, { status: "failed", error: "no key" });

    const create = {
      create: vi.fn(async () => ({ projectId: "p-retry" })),
    } as unknown as CreateController;
    const runner = new QueueRunner({
      store,
      create,
      createSmoke: async () => ({ ok: false as const, error: "not used" }),
      stageOf: async () => ({ kind: "published", outputPath: "/out/r.mp4", title: "r" }),
      cancelProject: () => {},
      sleep: async () => {},
    });

    expect(runner.start(q.id)).toEqual({ ok: true, mode: "started" });
    await waitUntilIdle(runner);
    expect(create.create).toHaveBeenCalledWith(
      "again",
      [],
      expect.objectContaining({ durationTier: 1 }),
    );
    expect(store.get(q.id)?.jobs[0]?.status).toBe("done");
  });

  it("schedules a second container while busy and drains it after the first", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mr-qrun-"));
    const store = new QueueStore({
      filePath: join(dir, "queues.json"),
      id: (() => {
        let n = 0;
        return () => `s${++n}`;
      })(),
    });
    const q1 = store.create("A");
    const q2 = store.create("B");
    store.addJob(q1.id, jobInput("first-batch"));
    store.addJob(q2.id, jobInput("second-batch"));

    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const order: string[] = [];
    const create = {
      create: vi.fn(async (raw: string) => {
        order.push(raw);
        if (raw === "first-batch") await gate;
        return { projectId: `p-${raw}` };
      }),
    } as unknown as CreateController;

    const runner = new QueueRunner({
      store,
      create,
      createSmoke: async () => ({ ok: false as const, error: "not used" }),
      stageOf: async () => ({ kind: "published", outputPath: "/out/t.mp4", title: "t" }),
      cancelProject: () => {},
      sleep: async () => {},
    });

    expect(runner.start(q1.id)).toEqual({ ok: true, mode: "started" });
    // Wait until first job is inside create (busy + active).
    for (let i = 0; i < 40 && order.length === 0; i += 1) {
      await new Promise((r) => setTimeout(r, 5));
    }
    const second = runner.start(q2.id);
    expect(second).toEqual({ ok: true, mode: "scheduled" });
    expect(runner.status()).toMatchObject({
      busy: true,
      activeQueueId: q1.id,
      pendingQueueIds: [q2.id],
    });

    release();
    await waitUntilIdle(runner);
    expect(order).toEqual(["first-batch", "second-batch"]);
    expect(store.get(q1.id)?.jobs[0]?.status).toBe("done");
    expect(store.get(q2.id)?.jobs[0]?.status).toBe("done");
    expect(runner.status()).toEqual({ busy: false, activeQueueId: null, pendingQueueIds: [] });
  });

  it("drains three containers in Start order", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mr-qrun-"));
    const store = new QueueStore({
      filePath: join(dir, "queues.json"),
      id: (() => {
        let n = 0;
        return () => `o${++n}`;
      })(),
    });
    const q1 = store.create("1");
    const q2 = store.create("2");
    const q3 = store.create("3");
    store.addJob(q1.id, jobInput("c1"));
    store.addJob(q2.id, jobInput("c2"));
    store.addJob(q3.id, jobInput("c3"));

    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const order: string[] = [];
    const create = {
      create: vi.fn(async (raw: string) => {
        order.push(raw);
        if (raw === "c1") await gate;
        return { projectId: `p-${raw}` };
      }),
    } as unknown as CreateController;

    const runner = new QueueRunner({
      store,
      create,
      createSmoke: async () => ({ ok: false as const, error: "not used" }),
      stageOf: async () => ({ kind: "published", outputPath: "/out/x.mp4", title: "x" }),
      cancelProject: () => {},
      sleep: async () => {},
    });

    expect(runner.start(q1.id).ok).toBe(true);
    for (let i = 0; i < 40 && order.length === 0; i += 1) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(runner.start(q2.id)).toEqual({ ok: true, mode: "scheduled" });
    expect(runner.start(q3.id)).toEqual({ ok: true, mode: "scheduled" });
    expect(runner.pendingQueues()).toEqual([q2.id, q3.id]);

    release();
    await waitUntilIdle(runner);
    expect(order).toEqual(["c1", "c2", "c3"]);
  });

  it("idempotent start on active and pending containers", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mr-qrun-"));
    const store = new QueueStore({ filePath: join(dir, "queues.json") });
    const q1 = store.create();
    const q2 = store.create();
    store.addJob(q1.id, jobInput("slow"));
    store.addJob(q2.id, jobInput("later"));

    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const create = {
      create: vi.fn(async (raw: string) => {
        if (raw === "slow") await gate;
        return { projectId: `p-${raw}` };
      }),
    } as unknown as CreateController;

    const runner = new QueueRunner({
      store,
      create,
      createSmoke: async () => ({ ok: false as const, error: "not used" }),
      stageOf: async () => ({ kind: "published", outputPath: "/out/t.mp4", title: "t" }),
      cancelProject: () => {},
      sleep: async () => {},
    });

    expect(runner.start(q1.id)).toEqual({ ok: true, mode: "started" });
    for (let i = 0; i < 40 && !runner.isBusy(); i += 1) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(runner.start(q1.id)).toEqual({ ok: true, mode: "already_running" });
    expect(runner.start(q2.id)).toEqual({ ok: true, mode: "scheduled" });
    expect(runner.start(q2.id)).toEqual({ ok: true, mode: "already_scheduled" });
    expect(runner.pendingQueues()).toEqual([q2.id]);

    release();
    await waitUntilIdle(runner);
  });

  it("rejects start when there are no startable jobs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mr-qrun-"));
    const store = new QueueStore({ filePath: join(dir, "queues.json") });
    const q = store.create();
    const runner = new QueueRunner({
      store,
      create: { create: vi.fn() } as unknown as CreateController,
      createSmoke: async () => ({ ok: false as const, error: "not used" }),
      stageOf: async () => ({ kind: "published", outputPath: "/out/t.mp4", title: "t" }),
      cancelProject: () => {},
      sleep: async () => {},
    });
    const res = runner.start(q.id);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/chưa có video/i);
  });

  it("skips a pending container that lost all jobs before its turn", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mr-qrun-"));
    const store = new QueueStore({
      filePath: join(dir, "queues.json"),
      id: (() => {
        let n = 0;
        return () => `e${++n}`;
      })(),
    });
    const q1 = store.create("A");
    const q2 = store.create("B");
    const q3 = store.create("C");
    store.addJob(q1.id, jobInput("keep"));
    store.addJob(q2.id, jobInput("will-delete"));
    store.addJob(q3.id, jobInput("after-empty"));

    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const order: string[] = [];
    const create = {
      create: vi.fn(async (raw: string) => {
        order.push(raw);
        if (raw === "keep") await gate;
        return { projectId: `p-${raw}` };
      }),
    } as unknown as CreateController;

    const runner = new QueueRunner({
      store,
      create,
      createSmoke: async () => ({ ok: false as const, error: "not used" }),
      stageOf: async () => ({ kind: "published", outputPath: "/out/t.mp4", title: "t" }),
      cancelProject: () => {},
      sleep: async () => {},
    });

    expect(runner.start(q1.id)).toEqual({ ok: true, mode: "started" });
    for (let i = 0; i < 40 && order.length === 0; i += 1) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(runner.start(q2.id)).toEqual({ ok: true, mode: "scheduled" });
    expect(runner.start(q3.id)).toEqual({ ok: true, mode: "scheduled" });

    const doomed = store.get(q2.id)!.jobs[0]!.id;
    store.deleteJob(q2.id, doomed);
    expect(store.get(q2.id)?.jobs).toHaveLength(0);

    release();
    await waitUntilIdle(runner);
    expect(order).toEqual(["keep", "after-empty"]);
    expect(create.create).toHaveBeenCalledTimes(2);
  });

  it("unschedule removes a pending container without aborting the active run", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mr-qrun-"));
    const store = new QueueStore({ filePath: join(dir, "queues.json") });
    const q1 = store.create();
    const q2 = store.create();
    store.addJob(q1.id, jobInput("active"));
    store.addJob(q2.id, jobInput("pending"));

    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const order: string[] = [];
    const create = {
      create: vi.fn(async (raw: string) => {
        order.push(raw);
        if (raw === "active") await gate;
        return { projectId: `p-${raw}` };
      }),
    } as unknown as CreateController;

    const runner = new QueueRunner({
      store,
      create,
      createSmoke: async () => ({ ok: false as const, error: "not used" }),
      stageOf: async () => ({ kind: "published", outputPath: "/out/t.mp4", title: "t" }),
      cancelProject: () => {},
      sleep: async () => {},
    });

    runner.start(q1.id);
    for (let i = 0; i < 40 && order.length === 0; i += 1) {
      await new Promise((r) => setTimeout(r, 5));
    }
    runner.start(q2.id);
    expect(runner.unschedule(q2.id)).toBe(true);
    expect(runner.pendingQueues()).toEqual([]);

    release();
    await waitUntilIdle(runner);
    expect(order).toEqual(["active"]);
  });

  it("auto-deletes ephemeral home after drain when all jobs done", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mr-qrun-"));
    const store = new QueueStore({ filePath: join(dir, "queues.json") });
    const home = store.ensureHomeQueue();
    store.addJob(home.id, jobInput("home-job"));
    const create = {
      create: vi.fn(async () => ({ projectId: "p-home" })),
    } as unknown as CreateController;
    const runner = new QueueRunner({
      store,
      create,
      createSmoke: async () => ({ ok: false as const, error: "not used" }),
      stageOf: async () => ({ kind: "published", outputPath: "/out/h.mp4", title: "h" }),
      cancelProject: () => {},
      sleep: async () => {},
    });
    expect(runner.start(HOME_QUEUE_ID)).toEqual({ ok: true, mode: "started" });
    await waitUntilIdle(runner);
    expect(store.get(HOME_QUEUE_ID)).toBeNull();
    expect(create.create).toHaveBeenCalled();
  });

  it("keeps ephemeral home after drain when a job failed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mr-qrun-"));
    const store = new QueueStore({ filePath: join(dir, "queues.json") });
    const home = store.ensureHomeQueue();
    store.addJob(home.id, jobInput("will-fail"));
    const create = {
      create: vi.fn(async () => ({ projectId: "p-fail" })),
    } as unknown as CreateController;
    const runner = new QueueRunner({
      store,
      create,
      createSmoke: async () => ({ ok: false as const, error: "not used" }),
      stageOf: async () => ({ kind: "error", message: "boom", fixable: true }),
      cancelProject: () => {},
      sleep: async () => {},
    });
    expect(runner.start(HOME_QUEUE_ID)).toEqual({ ok: true, mode: "started" });
    await waitUntilIdle(runner);
    expect(store.get(HOME_QUEUE_ID)?.jobs[0]?.status).toBe("failed");
    expect(store.get(HOME_QUEUE_ID)?.ephemeralKind).toBe("home");
  });

  it("does not auto-delete a normal container after drain", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mr-qrun-"));
    const store = new QueueStore({ filePath: join(dir, "queues.json") });
    const q = store.create("keep-me");
    store.addJob(q.id, jobInput("normal"));
    const create = {
      create: vi.fn(async () => ({ projectId: "p-n" })),
    } as unknown as CreateController;
    const runner = new QueueRunner({
      store,
      create,
      createSmoke: async () => ({ ok: false as const, error: "not used" }),
      stageOf: async () => ({ kind: "published", outputPath: "/out/n.mp4", title: "n" }),
      cancelProject: () => {},
      sleep: async () => {},
    });
    expect(runner.start(q.id)).toEqual({ ok: true, mode: "started" });
    await waitUntilIdle(runner);
    expect(store.get(q.id)?.title).toBe("keep-me");
    expect(store.get(q.id)?.jobs[0]?.status).toBe("done");
  });
});
