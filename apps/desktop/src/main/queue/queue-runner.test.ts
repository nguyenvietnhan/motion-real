import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QueueStore } from "./queue-store.js";
import { QueueRunner } from "./queue-runner.js";
import type { CreateController } from "../create/create-controller.js";
import type { ProjectStage } from "../../shared/types.js";

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
    store.addJob(q.id, {
      raw: "one",
      durationTier: 1,
      videoLanguage: "vi",
      voiceProvider: "vivibe",
      bgm: null,
    });
    store.addJob(q.id, {
      raw: "two",
      durationTier: 1,
      videoLanguage: "vi",
      voiceProvider: "vivibe",
      bgm: null,
    });

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

    // Adding never starts create.
    expect(create.create).not.toHaveBeenCalled();
    expect(store.get(q.id)?.jobs.every((j) => j.status === "queued")).toBe(true);

    const kick = runner.start(q.id);
    expect(kick).toEqual({ ok: true });
    // Allow the background loop to finish.
    for (let i = 0; i < 20 && runner.isBusy(); i += 1) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(order).toEqual(["one", "two"]);
    expect(store.get(q.id)?.jobs.map((j) => j.status)).toEqual(["done", "done"]);
  });

  it("refuses a second start while busy", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mr-qrun-"));
    const store = new QueueStore({ filePath: join(dir, "queues.json") });
    const q = store.create();
    store.addJob(q.id, {
      raw: "slow",
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
      create: vi.fn(async () => {
        await gate;
        return { projectId: "p-slow" };
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

    expect(runner.start(q.id).ok).toBe(true);
    const second = runner.start(q.id);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/đang chạy/i);
    release();
    for (let i = 0; i < 40 && runner.isBusy(); i += 1) {
      await new Promise((r) => setTimeout(r, 5));
    }
  });
});
