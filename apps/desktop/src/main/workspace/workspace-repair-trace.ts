/**
 * Collects already-redacted FriendlyFix hooks for one render/edit attempt and
 * maps the final draft outcome to honest repair event types.
 */

import type { FriendlyFix } from "../../shared/types.js";

export type RepairTraceEvent =
  | { type: "repair.attempted"; sceneId?: string }
  | { type: "repair.resolved"; sceneId?: string }
  | { type: "repair.reverted"; sceneId?: string }
  | { type: "repair.unresolved"; sceneId?: string }
  | { type: "repair.cancelled"; sceneId?: string };

export type RepairAttemptOutcome = "passed" | "reverted" | "exhausted" | "infra" | "cancelled";

function safeSceneId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const id = value.trim();
  return /^scene-\d{2}$/.test(id) ? id : undefined;
}

export class WorkspaceRepairTrace {
  private attempts: Array<{ sceneId?: string }> = [];

  noteRepair(fix: FriendlyFix): void {
    this.attempts.push({ ...(safeSceneId(fix.sceneId) ? { sceneId: safeSceneId(fix.sceneId) } : {}) });
  }

  /** Emit events for this attempt. Never labels applied unless final draft passed. */
  finalize(outcome: RepairAttemptOutcome): RepairTraceEvent[] {
    if (this.attempts.length === 0) return [];
    const events: RepairTraceEvent[] = this.attempts.map((a) => ({
      type: "repair.attempted",
      ...(a.sceneId ? { sceneId: a.sceneId } : {}),
    }));
    const lastScene = this.attempts[this.attempts.length - 1]?.sceneId;
    if (outcome === "passed") {
      events.push({ type: "repair.resolved", ...(lastScene ? { sceneId: lastScene } : {}) });
    } else if (outcome === "reverted") {
      events.push({ type: "repair.reverted", ...(lastScene ? { sceneId: lastScene } : {}) });
    } else if (outcome === "cancelled") {
      events.push({ type: "repair.cancelled", ...(lastScene ? { sceneId: lastScene } : {}) });
    } else {
      events.push({ type: "repair.unresolved", ...(lastScene ? { sceneId: lastScene } : {}) });
    }
    return events;
  }
}
