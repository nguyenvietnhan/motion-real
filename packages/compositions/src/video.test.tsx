import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { makeTheme } from "@news/theme";
import type { LockedSceneSpec } from "@news/schema";
import {
  BoundaryTransitionStage,
  CompositionBackdrop,
  FallbackBoundaryWipe,
  SceneContent,
  isBaseSceneHiddenAtFrame,
  usesAuthoredBoundaryTimeline,
} from "./video.js";
import { registerTransition, unregisterTransition, type BoundarySceneInfo } from "./registry.js";

function scene(id: string, startFrame: number): LockedSceneSpec {
  return {
    id,
    component: id + "-component",
    durationInSeconds: 3,
    headline: id,
    narration: "Một câu đọc thử.",
    props: {},
    startFrame,
    durationInFrames: 90,
  };
}

function sceneInfo(value: LockedSceneSpec): BoundarySceneInfo {
  return {
    id: value.id,
    component: value.component,
    headline: value.headline,
    narration: value.narration,
    props: value.props,
    startFrame: value.startFrame,
    durationInFrames: value.durationInFrames,
  };
}

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

describe("CompositionBackdrop default background wash (freeform-engine L2)", () => {
  // The composition's top-level backdrop must paint a gradient WASH, never the
  // flat near-black `colors.bg` (which looked dead on both formats). The backdrop
  // is format-agnostic — the same wash backs TikTok and YouTube — so one theme
  // exercises both. Tested directly (not through VideoComposition) because the
  // master composition mounts TransitionSeries, which needs a Remotion
  // video-config context; the backdrop is just a styled AbsoluteFill.
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

describe("boundary-authored transition runtime", () => {
  const id = "scene-01-to-scene-02";
  const fromScene = scene("scene-01", 0);
  const toScene = scene("scene-02", 75);

  it("keeps legacy mode when no transition is registered and selects v2 when one exists", () => {
    unregisterTransition(id);
    expect(usesAuthoredBoundaryTimeline([fromScene, toScene])).toBe(false);
    registerTransition({ id, displayName: "Test", Component: () => null });
    expect(usesAuthoredBoundaryTimeline([fromScene, toScene])).toBe(true);
    unregisterTransition(id);
  });

  it("passes both layers and boundary metadata to the authored component", () => {
    unregisterTransition(id);
    registerTransition({
      id,
      displayName: "Test",
      Component: ({ progress, from, to, fromScene: a, toScene: b }) => (
        <div data-transition={`${a.id}:${b.id}:${progress}`}>
          {from}
          {to}
        </div>
      ),
    });
    const html = renderToStaticMarkup(
      <BoundaryTransitionStage
        progress={0.5}
        durationInFrames={15}
        boundaryId={id}
        from={<span>FROM_LAYER</span>}
        to={<span>TO_LAYER</span>}
        fromScene={sceneInfo(fromScene)}
        toScene={sceneInfo(toScene)}
      />,
    );
    expect(html).toContain("scene-01:scene-02:0.5");
    expect(html).toContain("FROM_LAYER");
    expect(html).toContain("TO_LAYER");
    unregisterTransition(id);
  });

  it("forces exact from/to endpoints and hides base layers throughout overlaps", () => {
    const atStart = renderToStaticMarkup(
      <BoundaryTransitionStage
        progress={0}
        durationInFrames={15}
        boundaryId={id}
        from={<span>FROM_ONLY</span>}
        to={<span>TO_ONLY</span>}
        fromScene={sceneInfo(fromScene)}
        toScene={sceneInfo(toScene)}
      />,
    );
    expect(atStart).toContain("FROM_ONLY");
    expect(atStart).not.toContain("TO_ONLY");
    expect(isBaseSceneHiddenAtFrame(fromScene, 0, 2, 15, 80)).toBe(true);
    expect(isBaseSceneHiddenAtFrame(toScene, 1, 2, 15, 80)).toBe(true);
    expect(isBaseSceneHiddenAtFrame(toScene, 1, 2, 15, 95)).toBe(false);
  });

  it("fallback wipe keeps both scene layers instead of clearing to a fade", () => {
    const html = renderToStaticMarkup(
      <FallbackBoundaryWipe progress={0.5} from={<span>FROM</span>} to={<span>TO</span>} />,
    );
    expect(html).toContain("FROM");
    expect(html).toContain("TO");
    expect(html).toContain("clip-path");
  });
});
