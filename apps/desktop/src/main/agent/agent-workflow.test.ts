import { describe, expect, it } from "vitest";
import {
  initialAgentWorkflow,
  parseAgentWorkflow,
  pauseAgentWorkflow,
  resumeAgentWorkflow,
  transitionAgentWorkflow,
} from "./agent-workflow.js";

describe("Agent production workflow", () => {
  it("advances only through allowed transitions for the active job", () => {
    const collecting = transitionAgentWorkflow(initialAgentWorkflow(), {
      expectedRevision: 0,
      to: "collecting_assets",
      jobId: "job-1",
    });
    const reviewing = transitionAgentWorkflow(collecting, {
      expectedRevision: 1,
      to: "asset_review",
      jobId: "job-1",
    });

    expect(reviewing).toMatchObject({
      workflowRevision: 2,
      productionState: "asset_review",
      activeJobId: "job-1",
    });
    expect(() => transitionAgentWorkflow(reviewing, {
      expectedRevision: 2,
      to: "queued_create",
      jobId: "job-1",
    })).toThrow(/asset_review.*queued_create/);
  });

  it("rejects stale revisions, a wrong job, and duplicate transitions", () => {
    const collecting = transitionAgentWorkflow(initialAgentWorkflow(), {
      expectedRevision: 0,
      to: "collecting_assets",
      jobId: "job-1",
    });

    expect(() => transitionAgentWorkflow(collecting, {
      expectedRevision: 0,
      to: "asset_review",
      jobId: "job-1",
    })).toThrow(/tải lại/);
    expect(() => transitionAgentWorkflow(collecting, {
      expectedRevision: 1,
      to: "asset_review",
      jobId: "job-2",
    })).toThrow(/không khớp/);
    expect(() => transitionAgentWorkflow(collecting, {
      expectedRevision: 1,
      to: "collecting_assets",
      jobId: "job-1",
    })).toThrow(/collecting_assets.*collecting_assets/);
  });

  it("records a bounded error and resets it explicitly", () => {
    const collecting = transitionAgentWorkflow(initialAgentWorkflow(), {
      expectedRevision: 0,
      to: "collecting_assets",
      jobId: "job-1",
    });
    const failed = transitionAgentWorkflow(collecting, {
      expectedRevision: 1,
      to: "error",
      jobId: "job-1",
      error: "download failed",
    });
    const reset = transitionAgentWorkflow(failed, {
      expectedRevision: 2,
      to: "discovery",
      jobId: "job-1",
    });

    expect(failed.lastError).toBe("download failed");
    expect(reset).toEqual({ workflowVersion: 1, workflowRevision: 3, productionState: "discovery" });
  });

  it("migrates a legacy record but rejects explicit malformed workflow data", () => {
    expect(parseAgentWorkflow({})).toEqual(initialAgentWorkflow());
    expect(parseAgentWorkflow({
      workflowVersion: 1,
      workflowRevision: 4,
      productionState: "brief_review",
      activeJobId: "job-4",
    })).toMatchObject({ productionState: "brief_review", workflowRevision: 4 });
    expect(parseAgentWorkflow({ workflowVersion: 2, workflowRevision: 0, productionState: "discovery" })).toBeNull();
    expect(parseAgentWorkflow({ workflowVersion: 1, workflowRevision: 0, productionState: "asset_review" })).toBeNull();
  });

  it("pauses a running job durably and resumes the exact prior stage once", () => {
    const collecting = transitionAgentWorkflow(initialAgentWorkflow(), {
      expectedRevision: 0,
      to: "collecting_assets",
      jobId: "job-1",
    });
    const paused = pauseAgentWorkflow(collecting, { expectedRevision: 1, jobId: "job-1" });
    const resumed = resumeAgentWorkflow(paused, { expectedRevision: 2, jobId: "job-1" });

    expect(paused).toMatchObject({
      workflowRevision: 2,
      productionState: "paused",
      pausedFrom: "collecting_assets",
      activeJobId: "job-1",
    });
    expect(resumed).toEqual({
      workflowVersion: 1,
      workflowRevision: 3,
      productionState: "collecting_assets",
      activeJobId: "job-1",
    });
  });

  it("uses preparing_brief as a real running state and rejects malformed paused records", () => {
    const collecting = transitionAgentWorkflow(initialAgentWorkflow(), {
      expectedRevision: 0,
      to: "collecting_assets",
      jobId: "job-1",
    });
    const reviewingAssets = transitionAgentWorkflow(collecting, {
      expectedRevision: 1,
      to: "asset_review",
      jobId: "job-1",
    });
    const preparing = transitionAgentWorkflow(reviewingAssets, {
      expectedRevision: 2,
      to: "preparing_brief",
      jobId: "job-1",
    });

    expect(preparing.productionState).toBe("preparing_brief");
    expect(parseAgentWorkflow({
      workflowVersion: 1,
      workflowRevision: 3,
      productionState: "paused",
      activeJobId: "job-1",
    })).toBeNull();
  });
});
