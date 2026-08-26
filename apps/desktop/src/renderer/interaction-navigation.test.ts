import { describe, expect, it } from "vitest";
import { menuIndexForKey } from "./use-menu-navigation.js";
import { wrappedDialogFocusIndex } from "./use-modal-focus.js";

describe("keyboard interaction helpers", () => {
  it("wraps menu arrow keys and supports Home/End", () => {
    expect(menuIndexForKey("ArrowDown", 2, 3)).toBe(0);
    expect(menuIndexForKey("ArrowUp", 0, 3)).toBe(2);
    expect(menuIndexForKey("Home", 2, 3)).toBe(0);
    expect(menuIndexForKey("End", 0, 3)).toBe(2);
    expect(menuIndexForKey("Tab", 0, 3)).toBeNull();
  });

  it("traps Tab at both edges of a modal", () => {
    expect(wrappedDialogFocusIndex(0, 3, true)).toBe(2);
    expect(wrappedDialogFocusIndex(2, 3, false)).toBe(0);
    expect(wrappedDialogFocusIndex(1, 3, false)).toBeNull();
  });
});
