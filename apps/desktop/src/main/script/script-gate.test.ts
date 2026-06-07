import { describe, expect, it } from "vitest";
import { ScriptApprovalGate } from "./script-gate.js";

/**
 * Feature: web-dashboard, Task 8.2 — script-gate default + sequencing
 * (Req 4.1, 4.2, 4.6, 4.7, 4.8).
 */

describe("ScriptApprovalGate", () => {
  it("is ON by default and holds the first draft until approved (Req 4.1/4.2)", () => {
    const gate = new ScriptApprovalGate();
    expect(gate.isEnabled()).toBe(true);
    gate.initialize();
    expect(gate.canStartFirstDraft()).toBe(false);
    expect(gate.phase()).toBe("awaiting-approval");
    gate.approve();
    expect(gate.canStartFirstDraft()).toBe(true);
    expect(gate.phase()).toBe("proceeding");
  });

  it("disabling the gate skips the text gate (Req 4.2)", () => {
    const gate = new ScriptApprovalGate();
    gate.setEnabled(false);
    expect(gate.canStartFirstDraft()).toBe(true);
    expect(gate.phase()).toBe("skipped");
  });

  it("an approve before initialization waits for config, then proceeds (Req 4.8)", () => {
    const gate = new ScriptApprovalGate();
    gate.approve(); // arrives before initialize()
    expect(gate.canStartFirstDraft()).toBe(false);
    expect(gate.phase()).toBe("initializing");
    gate.initialize();
    expect(gate.canStartFirstDraft()).toBe(true);
    expect(gate.phase()).toBe("proceeding");
  });

  it("stays held while enabled and not yet approved even after init", () => {
    const gate = new ScriptApprovalGate(true);
    gate.initialize();
    expect(gate.canStartFirstDraft()).toBe(false);
  });
});
