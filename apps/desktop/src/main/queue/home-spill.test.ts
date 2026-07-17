import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOME_QUEUE_ID, QueueStore } from "./queue-store.js";
import { QueueRunner } from "./queue-runner.js";
import {
  shouldSpillHomeCreate,
  shouldSpillHomeSmoke,
  spillHomeCreateIfBusy,
  spillHomeSmokeIfBusy,
} from "./home-spill.js";
import type { CreateController } from "../create/create-controller.js";

describe("home-spill", () => {
  it("shouldSpillHomeCreate only for home source when busy", () => {
    expect(shouldSpillHomeCreate("home", true)).toBe(true);
    expect(shouldSpillHomeCreate("home", false)).toBe(false);
    expect(shouldSpillHomeCreate(undefined, true)).toBe(false);
    expect(shouldSpillHomeCreate("other", true)).toBe(false);
  });

  it("shouldSpillHomeSmoke when runner busy", () => {
    expect(shouldSpillHomeSmoke(true)).toBe(true);
    expect(shouldSpillHomeSmoke(false)).toBe(false);
  });

  it("returns not_busy when runner is idle", () => {
    const dir = mkdtempSync(join(tmpdir(), "mr-spill-"));
    const store = new QueueStore({ filePath: join(dir, "queues.json") });
    const runner = new QueueRunner({
      store,
      create: { create: vi.fn() } as unknown as CreateController,
      createSmoke: async () => ({ ok: false as const, error: "x" }),
      stageOf: async () => ({ kind: "published", outputPath: "/o", title: "t" }),
      cancelProject: () => {},
      sleep: async () => {},
    });
    const res = spillHomeCreateIfBusy({
      source: "home",
      busy: false,
      raw: "hello",
      choices: {},
      imageCount: 0,
      store,
      runner,
    });
    expect(res).toEqual({ kind: "not_busy" });
    expect(store.get(HOME_QUEUE_ID)).toBeNull();
  });

  it("ensures home, appends job, schedules when busy", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mr-spill-"));
    const store = new QueueStore({ filePath: join(dir, "queues.json") });
    // Occupy runner with another container.
    const q1 = store.create("A");
    store.addJob(q1.id, {
      raw: "first",
      durationTier: 1,
      videoLanguage: "vi",
      voiceProvider: "vivibe",
      bgm: null,
    });
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const create = {
      create: vi.fn(async (raw: string) => {
        if (raw === "first") await gate;
        return { projectId: `p-${raw}` };
      }),
    } as unknown as CreateController;
    const runner = new QueueRunner({
      store,
      create,
      createSmoke: async () => ({ ok: false as const, error: "x" }),
      stageOf: async () => ({ kind: "published", outputPath: "/o", title: "t" }),
      cancelProject: () => {},
      sleep: async () => {},
    });
    expect(runner.start(q1.id).ok).toBe(true);
    for (let i = 0; i < 40 && !runner.isBusy(); i += 1) {
      await new Promise((r) => setTimeout(r, 5));
    }

    const res = spillHomeCreateIfBusy({
      source: "home",
      busy: runner.isBusy(),
      raw: "  from homepage  ",
      choices: { durationTier: 2, videoLanguage: "en", voiceProvider: "elevenlabs", bgm: "a.mp3" },
      imageCount: 2,
      store,
      runner,
    });
    expect(res.kind).toBe("queued");
    if (res.kind !== "queued") return;
    expect(res.queueId).toBe(HOME_QUEUE_ID);
    expect(res.imagesDropped).toBe(true);
    const home = store.get(HOME_QUEUE_ID);
    expect(home?.jobs).toHaveLength(1);
    expect(home?.jobs[0]?.raw).toBe("from homepage");
    expect(home?.jobs[0]?.durationTier).toBe(2);
    expect(runner.pendingQueues()).toContain(HOME_QUEUE_ID);

    // Second spill reuses same container.
    const res2 = spillHomeCreateIfBusy({
      source: "home",
      busy: true,
      raw: "second home",
      choices: {},
      imageCount: 0,
      store,
      runner,
    });
    expect(res2.kind).toBe("queued");
    expect(store.get(HOME_QUEUE_ID)?.jobs).toHaveLength(2);

    release();
    for (let i = 0; i < 80 && runner.isBusy(); i += 1) {
      await new Promise((r) => setTimeout(r, 5));
    }
  });

  it("spills home smoke job when busy", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mr-spill-sm-"));
    const store = new QueueStore({ filePath: join(dir, "queues.json") });
    const q1 = store.create("A");
    store.addJob(q1.id, {
      raw: "hold",
      durationTier: 1,
      videoLanguage: "vi",
      voiceProvider: "vivibe",
      bgm: null,
    });
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const create = {
      create: vi.fn(async (raw: string) => {
        if (raw === "hold") await gate;
        return { projectId: `p-${raw}` };
      }),
    } as unknown as CreateController;
    const createSmoke = vi.fn(async () => ({ ok: true as const, projectId: "p-smoke-direct" }));
    const runner = new QueueRunner({
      store,
      create,
      createSmoke,
      stageOf: async () => ({ kind: "published", outputPath: "/o", title: "t" }),
      cancelProject: () => {},
      sleep: async () => {},
    });
    expect(runner.start(q1.id).ok).toBe(true);
    for (let i = 0; i < 40 && !runner.isBusy(); i += 1) {
      await new Promise((r) => setTimeout(r, 5));
    }

    const res = spillHomeSmokeIfBusy({
      busy: true,
      raw: "",
      videoLanguage: "vi",
      store,
      runner,
    });
    expect(res.kind).toBe("queued");
    const home = store.get(HOME_QUEUE_ID);
    expect(home?.jobs.some((j) => j.smoke)).toBe(true);
    expect(createSmoke).not.toHaveBeenCalled();

    release();
    for (let i = 0; i < 80 && runner.isBusy(); i += 1) {
      await new Promise((r) => setTimeout(r, 5));
    }
  });
});
