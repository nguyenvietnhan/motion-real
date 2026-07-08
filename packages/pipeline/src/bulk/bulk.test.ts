import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBulkLoop, UsageLimitError, type BulkWorker } from "./bulk.js";
import { readTracker, writeTracker, type TrackerItem, type TrackerStatus } from "../tracker/tracker.js";

// resumable bulk automation over the tracker.

let dir: string;
let trackerPath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "news-bulk-"));
  trackerPath = join(dir, "tracker.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function item(id: string, status: TrackerStatus): TrackerItem {
  return { id, url: `https://x.test/${id}`, title: id, source: "s", status, updatedAt: "t0" };
}

const STATUSES: TrackerStatus[] = ["pending", "in-progress", "done", "failed", "paused-resumable"];
const idArb = fc.string({ minLength: 1, maxLength: 6 }).map((s) => s.replace(/[^a-zA-Z0-9]/g, "x") || "i");
const PROPERTY_TIMEOUT_MS = 120_000;

/** A worker that always succeeds, recording which ids it processed. */
function recordingWorker(seen: string[]): BulkWorker {
  return async (it) => {
    seen.push(it.id);
    return { projectId: `proj-${it.id}` };
  };
}

describe("bulk — Property 12: resumes without redoing work", () => {
  it("processes exactly the non-done items and never touches done ones", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.tuple(idArb, fc.constantFrom(...STATUSES)), {
          minLength: 0,
          maxLength: 5,
          selector: (t) => t[0],
        }),
        async (pairs) => {
          const items = pairs.map(([id, status]) => item(id, status));
          await writeTracker(items, trackerPath);
          const seen: string[] = [];
          await runBulkLoop({ trackerPath, worker: recordingWorker(seen) });

          const expected = items.filter((i) => i.status !== "done" && i.status !== "failed").map((i) => i.id);
          expect(seen.sort()).toEqual(expected.sort());

          // done items remain done and untouched; processed items become done.
          const after = await readTracker(trackerPath);
          for (const orig of items) {
            const now = after.find((a) => a.id === orig.id)!;
            if (orig.status === "done") expect(now.status).toBe("done");
            if (expected.includes(orig.id)) expect(now.status).toBe("done");
          }
        },
      ),
      { numRuns: 100 },
    );
  }, PROPERTY_TIMEOUT_MS);

  it("a second run reprocesses nothing once all items are done (Property 15: cache/work reuse)", async () => {
    await writeTracker([item("a", "pending"), item("b", "pending")], trackerPath);
    const firstSeen: string[] = [];
    await runBulkLoop({ trackerPath, worker: recordingWorker(firstSeen) });
    expect(firstSeen.sort()).toEqual(["a", "b"]);

    const secondSeen: string[] = [];
    const res = await runBulkLoop({ trackerPath, worker: recordingWorker(secondSeen) });
    expect(secondSeen).toEqual([]); // zero re-processing → caches/work reused
    expect(res.outcomes).toEqual([]);
  });
});

describe("bulk — Property 13: usage-limit pause is graceful and resumable", () => {
  it("pauses the current item, keeps the tracker valid, and a later run finishes the rest", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 5 }), async (failAt) => {
        const ids = ["a", "b", "c", "d", "e", "f"];
        await writeTracker(ids.map((id) => item(id, "pending")), trackerPath);

        let count = 0;
        const limitWorker: BulkWorker = async (it) => {
          if (count === failAt) throw new UsageLimitError("rate limited");
          count++;
          return { projectId: `p-${it.id}` };
        };
        const first = await runBulkLoop({ trackerPath, worker: limitWorker });

        // The run stopped at the pause; tracker still round-trips (valid).
        const mid = await readTracker(trackerPath);
        expect(mid).toHaveLength(6);
        const paused = mid.filter((i) => i.status === "paused-resumable");
        expect(paused).toHaveLength(1);
        expect(first.outcomes.at(-1)!.status).toBe("paused-resumable");

        // A subsequent run (no limit) completes every remaining item.
        const seen: string[] = [];
        await runBulkLoop({ trackerPath, worker: recordingWorker(seen) });
        const done = await readTracker(trackerPath);
        expect(done.every((i) => i.status === "done")).toBe(true);
      }),
      { numRuns: 100 },
    );
  }, PROPERTY_TIMEOUT_MS);
});

describe("bulk — Property 14: per-item isolation", () => {
  it("an arbitrary failing subset does not abort the run; others reach done, failures recorded", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.boolean(), { minLength: 1, maxLength: 5 }), async (failFlags) => {
        const ids = failFlags.map((_, i) => `n${i}`);
        await writeTracker(ids.map((id) => item(id, "pending")), trackerPath);
        const failSet = new Set(ids.filter((_, i) => failFlags[i]));

        const worker: BulkWorker = async (it) => {
          if (failSet.has(it.id)) throw new Error(`boom ${it.id}`);
          return { projectId: `p-${it.id}` };
        };
        const { outcomes } = await runBulkLoop({ trackerPath, worker });

        // Every item produced an outcome (none skipped by an early abort).
        expect(outcomes).toHaveLength(ids.length);
        const after = await readTracker(trackerPath);
        for (const id of ids) {
          const it = after.find((a) => a.id === id)!;
          if (failSet.has(id)) {
            expect(it.status).toBe("failed");
            expect(it.reason).toContain(id);
          } else {
            expect(it.status).toBe("done");
          }
        }
      }),
      { numRuns: 100 },
    );
  }, PROPERTY_TIMEOUT_MS);
});

describe("bulk — limit + outcomes", () => {
  it("honours the limit and records per-item outcomes in order", async () => {
    await writeTracker([item("a", "pending"), item("b", "pending"), item("c", "pending")], trackerPath);
    const seen: string[] = [];
    const { outcomes } = await runBulkLoop({ trackerPath, worker: recordingWorker(seen), limit: 2 });
    expect(seen).toEqual(["a", "b"]);
    expect(outcomes.map((o) => o.id)).toEqual(["a", "b"]);
    expect(outcomes.every((o) => o.status === "done")).toBe(true);
    // The unprocessed item stays pending for a later run.
    const after = await readTracker(trackerPath);
    expect(after.find((i) => i.id === "c")!.status).toBe("pending");
  });
});
