import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { makeTheme } from "@motionreal/theme";
import type { LockedSceneSpec } from "@motionreal/schema";
import { CompositionBackdrop, SceneContent } from "./video.js";

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
