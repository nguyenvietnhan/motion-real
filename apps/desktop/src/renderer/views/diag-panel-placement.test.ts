import { describe, expect, it } from "vitest";
import { placeDiagPanel } from "./diag-panel-placement.js";

describe("placeDiagPanel", () => {
  it("keeps a wide panel inside the viewport when the trigger sits near the left of main", () => {
    // Storyboard action cluster can sit mid-window; a 28rem absolute panel used
    // to extend under the sidebar and get clipped by main overflow.
    const placed = placeDiagPanel(
      { top: 48, left: 280, right: 400, bottom: 84, width: 120, height: 36 },
      { width: 1280, height: 800 },
    );
    expect(placed.left).toBeGreaterThanOrEqual(12);
    expect(placed.left + placed.width).toBeLessThanOrEqual(1280 - 12);
    expect(placed.top).toBeGreaterThanOrEqual(84);
    expect(placed.maxHeight).toBeGreaterThan(100);
  });

  it("clamps when the trigger is near the right edge", () => {
    const placed = placeDiagPanel(
      { top: 40, left: 1100, right: 1220, bottom: 76, width: 120, height: 36 },
      { width: 1280, height: 720 },
    );
    expect(placed.left + placed.width).toBeLessThanOrEqual(1280 - 12);
    expect(placed.left).toBeGreaterThanOrEqual(12);
  });

  it("flips above the trigger when there is little room below", () => {
    const placed = placeDiagPanel(
      { top: 640, left: 400, right: 520, bottom: 680, width: 120, height: 40 },
      { width: 1000, height: 720 },
    );
    expect(placed.top + placed.maxHeight).toBeLessThanOrEqual(680);
    expect(placed.top).toBeGreaterThanOrEqual(12);
  });

  it("shrinks width on a narrow window instead of overflowing", () => {
    const placed = placeDiagPanel(
      { top: 40, left: 80, right: 200, bottom: 76, width: 120, height: 36 },
      { width: 360, height: 640 },
    );
    expect(placed.width).toBeLessThanOrEqual(360 - 24);
    expect(placed.left).toBe(12);
  });
});
