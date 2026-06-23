import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  getComponent,
  getTransition,
  listTransitions,
  registerComponent,
  registerTransition,
  unregisterComponent,
  unregisterTransition,
  type SceneComponentDefinition,
  type SceneBoundaryTransitionDefinition,
} from "./registry.js";

function makeDef(id: string): SceneComponentDefinition<Record<string, never>> {
  return {
    id,
    displayName: "Test",
    promptGuide: "test-only definition",
    schema: z.object({}),
    Component: () => null,
    example: {},
  };
}

describe("unregisterComponent seam", () => {
  it("registers and resolves a component, then unregisters and re-registers without throwing", () => {
    const id = "test-unregister-seam";
    // Defensive cleanup in case a prior run leaked this id.
    unregisterComponent(id);

    const def = makeDef(id);

    // 1. register -> getComponent returns the def.
    registerComponent(def);
    expect(getComponent(id)).toBe(def);

    // 2. unregister -> getComponent is undefined.
    unregisterComponent(id);
    expect(getComponent(id)).toBeUndefined();

    // 3. after unregister, re-registering the same id does NOT throw
    //    (registerComponent throws on duplicate id, so unregister-first avoids it).
    expect(() => registerComponent(makeDef(id))).not.toThrow();

    // Leave the registry clean.
    unregisterComponent(id);
    expect(getComponent(id)).toBeUndefined();
  });
});

describe("boundary transition registry", () => {
  const id = "scene-01-to-scene-02";
  const makeTransition = (): SceneBoundaryTransitionDefinition => ({
    id,
    displayName: "Test boundary",
    Component: () => null,
  });

  it("registers, resolves, lists, and unregisters a transition", () => {
    unregisterTransition(id);
    const def = makeTransition();
    registerTransition(def);
    expect(getTransition(id)).toBe(def);
    expect(listTransitions()).toContain(def);
    unregisterTransition(id);
    expect(getTransition(id)).toBeUndefined();
  });

  it("rejects duplicate transition ids", () => {
    unregisterTransition(id);
    registerTransition(makeTransition());
    expect(() => registerTransition(makeTransition())).toThrow(/duplicate scene transition id/i);
    unregisterTransition(id);
  });
});
