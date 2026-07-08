import type { AiAccountState, ConnectedAccount } from "./types.js";

/**
 * Pick the ONE account to surface in the UI (settings + sidebar). 9router may
 * hold several connected accounts at once (e.g. an old Gemini login + a fresh
 * Codex one), but the user wants to see only the account actually in use — not a
 * comma-joined list that still shows the stale one.
 *
 * The signal is 9router's own `isActive` flag on each connection (threaded into
 * `ConnectedAccount.active`): it marks the connection the gateway routes through,
 * and is authoritative for EVERY provider — no model-id→provider guessing table.
 *
 * Resolution order (each step a safe fallback for the next):
 * 1. the single `active` account, if exactly one is flagged;
 * 2. if none/many are flagged (older 9router, or a tie), the first account —
 * i.e. the prior behavior, so we never show "nothing connected" by mistake.
 *
 * Pure + total: lives in `shared/` so both the renderer and any main-side view
 * can use it without crossing the process boundary.
 */
export function activeAccount(account: AiAccountState): ConnectedAccount | undefined {
  if (account.kind !== "connected" || account.accounts.length === 0) return undefined;
  const flagged = account.accounts.filter((a) => a.active);
  if (flagged.length === 1) return flagged[0];
  return account.accounts[0];
}
