import { describe, expect, it } from "vitest";
import { z } from "zod";
import type React from "react";
import {
  getComponent,
  registerComponent,
  unregisterComponent,
  type SceneComponentDefinition,
  type SceneTransitionProps,
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

  it("stores an optional authored transition on the component definition", () => {
    const id = "test-authored-transition";
    unregisterComponent(id);
    const Transition: React.FC<SceneTransitionProps> = ({ children }) => children;
    const def = { ...makeDef(id), transitionToNext: Transition };

    registerComponent(def);
    expect(getComponent(id)?.transitionToNext).toBe(Transition);

    unregisterComponent(id);
  });
});
