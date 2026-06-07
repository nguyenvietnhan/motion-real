/**
 * Progressive-disclosure placement (web-dashboard Task 4.15, design §Settings,
 * Req 11.1/11.2/11.4/11.5). A pure, TOTAL map from every `ControlId` to its
 * disclosure level. L0 ids are engine internals that are NEVER rendered in the
 * user-facing UI (Property 12).
 */

export type DisclosureLevel = "L0" | "L1" | "L2" | "L3";

export type ControlId =
  // L1 — the core happy path, always visible.
  | "topic-input"
  | "create-action"
  | "draft-player"
  | "scene-edit-box"
  | "approve"
  // L2 — collapsed per-scene / styling actions.
  | "style-pack"
  | "accent-color"
  | "regenerate-scene"
  | "scene-add"
  | "scene-remove"
  | "scene-reorder"
  // L3 — settings screen.
  | "ai-account"
  | "voice"
  | "output-location"
  | "advanced-render"
  // L0 — engine internals, never shown.
  | "grid-codes"
  | "determinism"
  | "manifest-json"
  | "tsx-source"
  | "mcp"
  | "stack-trace";

const LEVEL_OF: Record<ControlId, DisclosureLevel> = {
  "topic-input": "L1",
  "create-action": "L1",
  "draft-player": "L1",
  "scene-edit-box": "L1",
  approve: "L1",
  "style-pack": "L2",
  "accent-color": "L2",
  "regenerate-scene": "L2",
  "scene-add": "L2",
  "scene-remove": "L2",
  "scene-reorder": "L2",
  "ai-account": "L3",
  voice: "L3",
  "output-location": "L3",
  "advanced-render": "L3",
  "grid-codes": "L0",
  determinism: "L0",
  "manifest-json": "L0",
  "tsx-source": "L0",
  mcp: "L0",
  "stack-trace": "L0",
};

/** Every known control id (for total-coverage assertions). */
export const ALL_CONTROL_IDS = Object.keys(LEVEL_OF) as ControlId[];

/** Pure, total: where does this control live? L0 ⇒ never rendered (Req 11.5). */
export function disclosureOf(id: ControlId): DisclosureLevel {
  return LEVEL_OF[id];
}

/** Should this control ever be rendered in the user-facing UI? */
export function isRenderable(id: ControlId): boolean {
  return disclosureOf(id) !== "L0";
}
