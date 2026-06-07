/**
 * Script-approval-gate sequencing (web-dashboard Task 8.1, design §script gate,
 * Req 4.1/4.2/4.6/4.7/4.8). A small, pure state machine that controls WHEN the
 * first Draft may begin:
 *   - the gate is ON by default (Req 4.1);
 *   - while ON, the first Draft does not begin until the user approves OR
 *     disables the gate (Req 4.2/4.7);
 *   - an approval arriving BEFORE the gate is initialized (scenes/config loaded)
 *     is remembered and applied once initialization completes (Req 4.8);
 *   - disabling the gate skips the text gate entirely (Req 4.2).
 * The actual narration edits reuse `script-gate-apply.ts` (Req 4.6).
 */

export type GatePhase =
  | "initializing" // gate ON, scenes/config not loaded yet
  | "awaiting-approval" // gate ON, initialized, waiting for the user
  | "proceeding" // approved (or disabled) → first draft may begin
  | "skipped"; // gate OFF → text gate skipped

export class ScriptApprovalGate {
  private enabled: boolean;
  private initialized = false;
  private approved = false;
  private pendingApprove = false;

  constructor(enabled = true) {
    // Req 4.1 — the gate is ON by default.
    this.enabled = enabled;
  }

  /** Disable (skip) or re-enable the gate before the first draft. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Mark the gate initialized once scenes + config are loaded. */
  initialize(): void {
    this.initialized = true;
    if (this.pendingApprove) {
      this.approved = true;
      this.pendingApprove = false;
    }
  }

  /** User approval. Before initialization it is queued and applied later (Req 4.8). */
  approve(): void {
    if (!this.initialized) {
      this.pendingApprove = true;
      return;
    }
    this.approved = true;
  }

  /** The first Draft may begin iff the gate is off, or it is approved+initialized. */
  canStartFirstDraft(): boolean {
    if (!this.enabled) return true;
    return this.initialized && this.approved;
  }

  phase(): GatePhase {
    if (!this.enabled) return "skipped";
    if (this.canStartFirstDraft()) return "proceeding";
    if (!this.initialized) return "initializing";
    return "awaiting-approval";
  }
}
