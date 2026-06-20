import { describe, expect, it, vi } from "vitest";
import { runStartupSequence } from "./startup-sequence.js";

describe("runStartupSequence", () => {
  it("finishes stale-state reconciliation before gateway and window startup", async () => {
    const order: string[] = [];
    await runStartupSequence({
      reconcileStaleStates: async () => { order.push("reconcile:start"); order.push("reconcile:end"); },
      onReconcileError: vi.fn(),
      startGateway: () => { order.push("gateway"); },
      createWindow: async () => { order.push("window"); },
    });
    expect(order).toEqual(["reconcile:start", "reconcile:end", "gateway", "window"]);
  });

  it("reports a reconcile failure but still starts the desktop", async () => {
    const order: string[] = [];
    const onReconcileError = vi.fn();
    await runStartupSequence({
      reconcileStaleStates: async () => { throw new Error("broken brief"); },
      onReconcileError,
      startGateway: () => { order.push("gateway"); },
      createWindow: async () => { order.push("window"); },
    });
    expect(onReconcileError).toHaveBeenCalledOnce();
    expect(order).toEqual(["gateway", "window"]);
  });
});
