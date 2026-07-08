import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTracker, writeTracker, upsertItem, type TrackerItem, type TrackerStatus } from "./tracker.js";
import { isPipelineError } from "../errors.js";

// tracker work queue.

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "news-tracker-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const STATUSES: TrackerStatus[] = ["pending", "in-progress", "done", "failed", "paused-resumable"];

/** Arbitrary tracker item; optional fields are either absent or non-empty. */
const itemArb = fc.record({
  id: fc.string({ minLength: 1, maxLength: 20 }),
  url: fc.string({ minLength: 1, maxLength: 40 }),
  title: fc.string({ minLength: 0, maxLength: 60 }),
  source: fc.string({ minLength: 0, maxLength: 30 }),
  status: fc.constantFrom(...STATUSES),
  updatedAt: fc.constant("2026-06-07T00:00:00.000Z"),
  reason: fc.option(fc.string({ minLength: 1, maxLength: 40 }), { nil: undefined }),
  projectId: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
}) as fc.Arbitrary<TrackerItem>;

describe("tracker — Property 11: serialization round-trip", () => {
  it("read(write(items)) is equivalent in BOTH JSON and CSV", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(itemArb, { maxLength: 12 }), fc.constantFrom("json", "csv"), async (items, fmt) => {
        const path = join(dir, `tracker-${Math.random().toString(36).slice(2)}.${fmt}`);
        await writeTracker(items, path);
        const round = await readTracker(path);
        expect(round).toEqual(items);
      }),
      { numRuns: 100 },
    );
  }, 60_000);
});

describe("tracker — read/write JSON and CSV", () => {
  const sample: TrackerItem[] = [
    { id: "n1", url: "https://a.test/x", title: "Tin một", source: "A Wire", status: "pending", updatedAt: "2026-06-07T00:00:00.000Z" },
    {
      id: "n2",
      url: "https://b.test/y",
      title: "T, có dấu phẩy và \"ngoặc kép\"",
      source: "B News",
      status: "failed",
      reason: "admission rejected",
      projectId: "proj-2",
      updatedAt: "2026-06-07T01:00:00.000Z",
    },
  ];

  it("round-trips a hand-written JSON tracker", async () => {
    const path = join(dir, "tracker.json");
    await writeTracker(sample, path);
    expect(await readTracker(path)).toEqual(sample);
  });

  it("round-trips a CSV tracker including commas and quotes in values", async () => {
    const path = join(dir, "tracker.csv");
    await writeTracker(sample, path);
    expect(await readTracker(path)).toEqual(sample);
  });

  it("returns an empty queue for a missing file", async () => {
    expect(await readTracker(join(dir, "nope.json"))).toEqual([]);
    expect(await readTracker(join(dir, "nope.csv"))).toEqual([]);
  });

  it("returns an empty queue for an empty JSON file", async () => {
    const path = join(dir, "empty.json");
    await writeFile(path, "", "utf8");
    expect(await readTracker(path)).toEqual([]);
  });

  it("raises a PipelineError(config) on malformed JSON", async () => {
    const path = join(dir, "bad.json");
    await writeFile(path, "{ not valid json", "utf8");
    try {
      await readTracker(path);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(isPipelineError(err)).toBe(true);
      if (isPipelineError(err)) expect(err.stage).toBe("config");
    }
  });

  it("raises a PipelineError(config) when JSON is not an array", async () => {
    const path = join(dir, "obj.json");
    await writeFile(path, '{"id":"x"}', "utf8");
    try {
      await readTracker(path);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(isPipelineError(err)).toBe(true);
    }
  });
});

describe("tracker — upsertItem (pure)", () => {
  const base: TrackerItem[] = [
    { id: "a", url: "u", title: "t", source: "s", status: "pending", updatedAt: "t0" },
  ];

  it("appends a new item when the id is unseen", () => {
    const next = upsertItem(base, { id: "b", url: "u2", title: "t2", source: "s2", status: "pending", updatedAt: "t1" });
    expect(next).toHaveLength(2);
    expect(next[1]!.id).toBe("b");
    // original list is untouched (pure)
    expect(base).toHaveLength(1);
  });

  it("merges a patch over an existing item by id", () => {
    const next = upsertItem(base, { id: "a", status: "done", projectId: "p1", updatedAt: "t2" });
    expect(next).toHaveLength(1);
    expect(next[0]).toEqual({ id: "a", url: "u", title: "t", source: "s", status: "done", projectId: "p1", updatedAt: "t2" });
  });
});
