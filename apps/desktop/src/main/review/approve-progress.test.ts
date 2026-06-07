import { describe, expect, it, vi } from "vitest";
import { ApproveController, type FullRenderBackend } from "./approve-controller.js";
import {
  ProgressForwarder,
  toPercent,
  DRAFT_MIN_INTERVAL_MS,
  FULL_MIN_INTERVAL_MS,
} from "./progress-forwarder.js";
import type { ProgressEvent } from "../../shared/types.js";

/**
 * Feature: web-dashboard, Task 9.2 (approve→full wiring) and Task 9.6 (progress
 * forwarding, Req 5.2/9.5). Approve is draft-first gated; progress maps ratio→%
 * and respects the minimum cadence with a fake clock.
 */

describe("ApproveController.approveDraft", () => {
  const okBackend: FullRenderBackend = { renderFull: async () => ({ ok: true, outputPath: "/out/p1.mp4" }) };

  it("refuses draft-first when no reviewed draft exists and never renders", async () => {
    const renderFull = vi.fn(async () => ({ ok: true as const, outputPath: "/x" }));
    const ctrl = new ApproveController({ renderFull });
    expect(await ctrl.approveDraft("p1", false)).toEqual({ ok: false, reason: "draft-first" });
    expect(renderFull).not.toHaveBeenCalled();
  });

  it("drives render_full and returns the output path on success", async () => {
    const ctrl = new ApproveController(okBackend);
    expect(await ctrl.approveDraft("p1", true)).toEqual({ ok: true, outputPath: "/out/p1.mp4" });
  });

  it("on render failure retains the draft and returns a friendly full-retry error", async () => {
    const ctrl = new ApproveController({
      renderFull: async () => ({ ok: false, error: { message: "[render] boom N14", stage: "render", cause: "boom", severity: "error" } }),
    });
    const outcome = await ctrl.approveDraft("p1", true);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok && outcome.reason === "render-failed") {
      expect(outcome.error.retry).toBe("full");
      expect(outcome.error.message).not.toMatch(/N14/);
      expect(outcome.error.message.length).toBeGreaterThan(0);
    } else {
      throw new Error("expected render-failed");
    }
  });
});

describe("toPercent", () => {
  it("maps and clamps ratios to 0..100", () => {
    expect(toPercent(0)).toBe(0);
    expect(toPercent(0.5)).toBe(50);
    expect(toPercent(1)).toBe(100);
    expect(toPercent(1.5)).toBe(100);
    expect(toPercent(-1)).toBe(0);
    expect(toPercent(Number.NaN)).toBe(0);
  });
});

describe("ProgressForwarder cadence", () => {
  it("draft: emits the first update, coalesces within 2s, emits after the interval", () => {
    let t = 0;
    const events: ProgressEvent[] = [];
    const fwd = new ProgressForwarder("p1", "draft", (e) => events.push(e), { now: () => t });
    fwd.push(0.1); // first → emit
    t = 500;
    fwd.push(0.2); // within 2s → drop
    t = DRAFT_MIN_INTERVAL_MS;
    fwd.push(0.4); // interval elapsed → emit
    expect(events.map((e) => e.ratio)).toEqual([0.1, 0.4]);
    expect(events.every((e) => e.phase === "draft" && e.projectId === "p1")).toBe(true);
  });

  it("full: uses a 5s minimum cadence but always emits completion", () => {
    let t = 0;
    const events: ProgressEvent[] = [];
    const fwd = new ProgressForwarder("p1", "full", (e) => events.push(e), { now: () => t });
    fwd.push(0.1); // emit
    t = 1000;
    fwd.push(0.3); // within 5s → drop
    t = 2000;
    fwd.push(1); // completion always emits even before the interval
    expect(events.map((e) => e.ratio)).toEqual([0.1, 1]);
    expect(FULL_MIN_INTERVAL_MS).toBe(5000);
  });
});
