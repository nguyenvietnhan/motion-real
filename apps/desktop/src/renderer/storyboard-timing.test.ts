import { describe, expect, it } from "vitest";
import type { SceneCard } from "../shared/types.js";
import { sceneIndexAtSeconds, seekSecondsForScene } from "./storyboard-timing.js";

function card(id: string, start: number, end: number, order = 0): SceneCard {
  return {
    sceneId: id,
    order,
    stillPath: "",
    editText: "",
    timeline: { startSeconds: start, endSeconds: end },
  };
}

describe("seekSecondsForScene", () => {
  it("returns startSeconds for a valid timeline", () => {
    expect(seekSecondsForScene(card("scene-01", 1.5, 4))).toBe(1.5);
  });

  it("returns undefined for missing/invalid timing", () => {
    expect(seekSecondsForScene(undefined)).toBeUndefined();
    expect(seekSecondsForScene({ sceneId: "a", order: 0, stillPath: "", editText: "" })).toBeUndefined();
    expect(seekSecondsForScene(card("a", Number.NaN, 2))).toBeUndefined();
  });
});

describe("sceneIndexAtSeconds", () => {
  const scenes = [card("scene-01", 0, 2, 0), card("scene-02", 2, 5, 1), card("scene-03", 5, 8, 2)];

  it("maps interior times to the owning scene", () => {
    expect(sceneIndexAtSeconds(scenes, 0)).toBe(0);
    expect(sceneIndexAtSeconds(scenes, 1.9)).toBe(0);
    expect(sceneIndexAtSeconds(scenes, 3)).toBe(1);
  });

  it("time at a scene boundary resolves to the next scene", () => {
    expect(sceneIndexAtSeconds(scenes, 2)).toBe(1);
    expect(sceneIndexAtSeconds(scenes, 5)).toBe(2);
  });

  it("final endpoint resolves to the final scene", () => {
    expect(sceneIndexAtSeconds(scenes, 8)).toBe(2);
  });

  it("no timeline returns no active scene", () => {
    expect(
      sceneIndexAtSeconds(
        [{ sceneId: "a", order: 0, stillPath: "", editText: "" }],
        1,
      ),
    ).toBeUndefined();
  });

  it("invalid intervals are skipped without throwing", () => {
    const bad: SceneCard[] = [
      { sceneId: "a", order: 0, stillPath: "", editText: "", timeline: { startSeconds: 0, endSeconds: 0 } },
      card("b", 1, 3, 1),
    ];
    expect(sceneIndexAtSeconds(bad, 2)).toBe(1);
  });
});
