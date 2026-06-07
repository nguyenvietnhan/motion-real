import type { ProgressEvent } from "../../shared/types.js";

/**
 * Progress forwarding (web-dashboard Task 9.6, design §onProgress mapping,
 * Req 5.2/9.5). The engine's `onProgress(ratio)` (ratio ∈ [0,1]) is mapped to a
 * `ProgressEvent` carrying the phase and forwarded to the renderer. A minimum
 * cadence is enforced with an injected clock so the UI updates at least every 2s
 * (draft) / 5s (full); the terminal `ratio>=1` always emits so completion is
 * never dropped.
 */

export const DRAFT_MIN_INTERVAL_MS = 2000;
export const FULL_MIN_INTERVAL_MS = 5000;

/** Map a [0,1] ratio to an integer percentage, clamped. */
export function toPercent(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0;
  return Math.max(0, Math.min(100, Math.round(ratio * 100)));
}

export type ProgressForwarderOptions = {
  minIntervalMs?: number;
  now?: () => number;
};

export class ProgressForwarder {
  private lastAt: number | null = null;
  private readonly minIntervalMs: number;
  private readonly now: () => number;

  constructor(
    private readonly projectId: string,
    private readonly phase: "draft" | "full",
    private readonly sink: (e: ProgressEvent) => void,
    opts: ProgressForwarderOptions = {},
  ) {
    this.minIntervalMs = opts.minIntervalMs ?? (phase === "full" ? FULL_MIN_INTERVAL_MS : DRAFT_MIN_INTERVAL_MS);
    this.now = opts.now ?? (() => Date.now());
  }

  /** Forward a ratio, throttled to the minimum cadence (completion always emits). */
  push(ratio: number): void {
    const t = this.now();
    const due = this.lastAt === null || t - this.lastAt >= this.minIntervalMs || ratio >= 1;
    if (!due) return;
    this.lastAt = t;
    this.sink({ projectId: this.projectId, ratio, phase: this.phase });
  }
}
