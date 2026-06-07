import type { AiAccountState, GatewayState } from "../../shared/types.js";

/**
 * Model_Gateway (9Router) manager module (web-dashboard design §Model_Gateway).
 *
 * This file currently owns only the PURE AI-ready gate (Task 4.5, Req 2.4/2.9);
 * the network/child-process lifecycle (`start` retry, OAuth `connectAccount`,
 * `ensureLocalKey`) lands in tasks 6.3/6.4. Keeping the gate pure lets the
 * Create action and silent-draft start be tested without any process spawn.
 */

export const GATEWAY_BASE_URL = "http://localhost:20128/v1";

/**
 * Pure gate (Property 3): silent draft generation may start IFF the local
 * gateway is `ready` AND an AI account is `connected`. Any other combination
 * (starting/unavailable gateway, or disconnected/connecting account) is false,
 * which blocks the Create action with a "connect an account first" prompt.
 */
export function aiReady(gw: GatewayState, acc: AiAccountState): boolean {
  return gw.kind === "ready" && acc.kind === "connected";
}
