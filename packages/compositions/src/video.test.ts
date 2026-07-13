import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { makeTheme } from "@motionreal/theme";
import type { LockedSceneSpec } from "@motionreal/schema";
import { CompositionBackdrop, SceneContent, crossfadeOpacity } from "./video.js";

describe("VideoComposition missing-component fallback", () => {
  it("renders a visible error panel for unknown component ids", () => {
    const scene: LockedSceneSpec = {
      id: "scene-01",
      component: "not-registered",
      durationInSeconds: 3,
      headline: "Fallback",
      narration: "Một câu đọc thử.",
      props: {},
      startFrame: 0,
      durationInFrames: 90,
    };

    const html = renderToStaticMarkup(React.createElement(SceneContent, { scene }));

    expect(html).toContain("scene-01");
    expect(html).toContain("unknown component");
    expect(html).toContain("not-registered");
  });
});

describe("CompositionBackdrop default background wash", () => {
  // The composition's top-level backdrop must paint a gradient WASH, never the
  // flat near-black `colors.bg`. Tested directly (not through VideoComposition)
  // because the master composition mounts TransitionSeries, which needs a
  // Remotion video-config context; the backdrop is just a styled AbsoluteFill.
  it("paints a radial-gradient wash, not the flat bg", () => {
    const theme = makeTheme("#5B8CFF");
    const html = renderToStaticMarkup(
      React.createElement(CompositionBackdrop, { theme, children: "x" }),
    );
    expect(html).toContain("radial-gradient");
  });

  // N16 determinism: the wash is a pure function of the theme, so two renders
  // yield byte-identical markup.
  it("is deterministic across two renders", () => {
    const theme = makeTheme("#5B8CFF");
    const a = renderToStaticMarkup(React.createElement(CompositionBackdrop, { theme, children: "x" }));
    const b = renderToStaticMarkup(React.createElement(CompositionBackdrop, { theme, children: "x" }));
    expect(a).toBe(b);
  });
});

describe("crossfadeOpacity (true crossfade, no mid-dip)", () => {
  it("keeps both layers partially visible at mid progress (sum = 1)", () => {
    const enter = crossfadeOpacity(0.5, true);
    const exit = crossfadeOpacity(0.5, false);
    expect(enter).toBe(0.5);
    expect(exit).toBe(0.5);
    expect(enter + exit).toBe(1);
  });

  it("is correct at the endpoints", () => {
    expect(crossfadeOpacity(0, true)).toBe(0);
    expect(crossfadeOpacity(0, false)).toBe(1);
    expect(crossfadeOpacity(1, true)).toBe(1);
    expect(crossfadeOpacity(1, false)).toBe(0);
  });

  it("never yields a dual-zero window across the progress range", () => {
    // Guards against reintroducing sequential fade-to-background (both 0 at 0.5).
    for (let i = 0; i <= 20; i += 1) {
      const p = i / 20;
      const enter = crossfadeOpacity(p, true);
      const exit = crossfadeOpacity(p, false);
      expect(enter + exit).toBeCloseTo(1, 10);
      expect(enter === 0 && exit === 0).toBe(false);
    }
  });

  it("clamps out-of-range progress", () => {
    expect(crossfadeOpacity(-0.2, true)).toBe(0);
    expect(crossfadeOpacity(-0.2, false)).toBe(1);
    expect(crossfadeOpacity(1.5, true)).toBe(1);
    expect(crossfadeOpacity(1.5, false)).toBe(0);
  });
});
