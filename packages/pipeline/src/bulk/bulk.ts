import { readTracker, writeTracker, upsertItem, type TrackerItem, type TrackerStatus } from "../tracker/tracker.js";

/**
 * Resumable bulk automation over the tracker. The loop
 * reduces over non-`done` items, driving each through a per-item WORKER (the
 * driving agent supplies it — there is no in-tool planner). The loop owns only
 * the bookkeeping: item selection, status transitions, resumability, graceful
 * usage-limit pause, per-item isolation, and outcome recording. Each worker
 * reuses the single-process orchestrator (ingest → scaffold → author → draft →
 * full), so the full `N1–N31` grid, the draft-first gate, determinism, the
 * Vivibe voice, and the shared TTS/render caches apply per item.
 */

/** Signal a usage/API limit from a worker so the loop pauses gracefully. */
export class UsageLimitError extends Error {
  constructor(message = "usage limit reached") {
    super(message);
    this.name = "UsageLimitError";
  }
}

export function isUsageLimitError(value: unknown): value is UsageLimitError {
  return value instanceof UsageLimitError;
}

/** Per-item processor (agent-driven). Resolve with the produced project id on
 * success; throw `UsageLimitError` to pause; throw anything else to fail the item. */
export type BulkWorker = (item: TrackerItem) => Promise<{ projectId?: string }>;

export type BulkOutcome = { id: string; status: TrackerStatus; reason?: string; projectId?: string };

export type RunBulkLoopOptions = {
  worker: BulkWorker;
  trackerPath?: string;
  /** Max items to process this run (default: all eligible). */
  limit?: number;
  onItem?: (outcome: BulkOutcome) => void;
  /** Clock injection for deterministic timestamps in tests. */
  now?: () => string;
};

/** Items the loop will (re)process — pending / in-progress / paused-resumable. */
const RESUMABLE: ReadonlySet<TrackerStatus> = new Set<TrackerStatus>([
  "pending",
  "in-progress",
  "paused-resumable",
]);

/**
 * Run the bulk loop once. Processes eligible (non-`done`) items in order, up to
 * `limit`. `done` items are never reprocessed. On a usage limit the
 * current item is marked `paused-resumable` and the loop STOPS gracefully
 * without corrupting the tracker. A single item failure marks it
 * `failed`+reason and the loop CONTINUES. Every transition is persisted
 * immediately so a crash/restart resumes from the recorded point.
 */
export async function runBulkLoop(opts: RunBulkLoopOptions): Promise<{ outcomes: BulkOutcome[] }> {
  const now = opts.now ?? (() => new Date().toISOString());
  const outcomes: BulkOutcome[] = [];

  // Re-read on each call so a restart reflects the latest persisted state.
  let items = await readTracker(opts.trackerPath);
  const eligible = items.filter((it) => RESUMABLE.has(it.status));
  const slice = opts.limit !== undefined ? eligible.slice(0, opts.limit) : eligible;

  for (const target of slice) {
    // Mark in-progress and persist before doing any work (resume point).
    items = upsertItem(items, { id: target.id, status: "in-progress", updatedAt: now() });
    await writeTracker(items, opts.trackerPath);

    try {
      const result = await opts.worker(target);
      items = upsertItem(items, {
        id: target.id,
        status: "done",
        updatedAt: now(),
        ...(result.projectId ? { projectId: result.projectId } : {}),
      });
      await writeTracker(items, opts.trackerPath);
      const outcome: BulkOutcome = { id: target.id, status: "done", ...(result.projectId ? { projectId: result.projectId } : {}) };
      outcomes.push(outcome);
      opts.onItem?.(outcome);
    } catch (error) {
      if (isUsageLimitError(error)) {
        // Graceful pause: record progress + stop without corrupting the tracker.
        items = upsertItem(items, {
          id: target.id,
          status: "paused-resumable",
          reason: error.message,
          updatedAt: now(),
        });
        await writeTracker(items, opts.trackerPath);
        const outcome: BulkOutcome = { id: target.id, status: "paused-resumable", reason: error.message };
        outcomes.push(outcome);
        opts.onItem?.(outcome);
        break; // stop the run; a later run resumes from here
      }
      // Per-item isolation: mark failed + reason and CONTINUE the remaining items.
      const reason = error instanceof Error ? error.message : String(error);
      items = upsertItem(items, { id: target.id, status: "failed", reason, updatedAt: now() });
      await writeTracker(items, opts.trackerPath);
      const outcome: BulkOutcome = { id: target.id, status: "failed", reason };
      outcomes.push(outcome);
      opts.onItem?.(outcome);
    }
  }

  return { outcomes };
}
