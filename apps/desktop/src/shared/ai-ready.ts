import type { AiAccountState, GatewayState } from "./types.js";

/**
 * Pure gate (web-dashboard Property 3): silent draft generation may start IFF
 * the local gateway is `ready`, at least one account is `connected`, AND a model
 * is selected. Any other combination is false and blocks the Create action.
 *
 * Lives in `shared/` (not `main/`) so the renderer can import it without
 * reaching across the main/renderer boundary — it depends only on shared types.
 */
export function aiReady(gw: GatewayState, acc: AiAccountState): boolean {
  return (
    gw.kind === "ready" &&
    acc.kind === "connected" &&
    acc.accounts.length > 0 &&
    acc.selectedModel !== undefined
  );
}
