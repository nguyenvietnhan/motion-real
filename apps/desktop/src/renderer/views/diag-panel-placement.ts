/**
 * Viewport-clamped placement for the project diagnostics popover.
 * Absolute positioning inside the storyboard shell is clipped by overflow
 * ancestors (main / story-shell), which hid entry text under the sidebar.
 */

export type RectLike = {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export type DiagPanelPlacement = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
};

const DEFAULT_MARGIN = 12;
const GAP_BELOW_TRIGGER = 8;
/** ~28rem — keep in sync with .ns-diag-panel preferred width. */
export const DIAG_PANEL_PREFERRED_WIDTH_PX = 448;
export const DIAG_PANEL_PREFERRED_MAX_HEIGHT_PX = 360;

export function placeDiagPanel(
  trigger: RectLike,
  viewport: { width: number; height: number },
  options?: { margin?: number; preferredWidth?: number; preferredMaxHeight?: number },
): DiagPanelPlacement {
  const margin = options?.margin ?? DEFAULT_MARGIN;
  const preferredWidth = options?.preferredWidth ?? DIAG_PANEL_PREFERRED_WIDTH_PX;
  const preferredMaxHeight = options?.preferredMaxHeight ?? DIAG_PANEL_PREFERRED_MAX_HEIGHT_PX;

  const width = Math.max(
    200,
    Math.min(preferredWidth, Math.max(0, viewport.width - margin * 2)),
  );

  // Prefer right-aligning to the trigger (matches prior CSS right: 0), then clamp.
  let left = trigger.right - width;
  left = Math.min(left, viewport.width - width - margin);
  left = Math.max(margin, left);

  const spaceBelow = viewport.height - trigger.bottom - GAP_BELOW_TRIGGER - margin;
  const spaceAbove = trigger.top - GAP_BELOW_TRIGGER - margin;
  const placeBelow = spaceBelow >= 120 || spaceBelow >= spaceAbove;

  let top: number;
  let maxHeight: number;
  if (placeBelow) {
    top = trigger.bottom + GAP_BELOW_TRIGGER;
    maxHeight = Math.min(preferredMaxHeight, Math.max(120, spaceBelow));
  } else {
    maxHeight = Math.min(preferredMaxHeight, Math.max(120, spaceAbove));
    top = Math.max(margin, trigger.top - GAP_BELOW_TRIGGER - maxHeight);
  }

  // Final clamp so a short viewport never pushes the panel off-screen.
  if (top + maxHeight > viewport.height - margin) {
    maxHeight = Math.max(120, viewport.height - margin - top);
  }
  if (top < margin) top = margin;

  return { top, left, width, maxHeight };
}
