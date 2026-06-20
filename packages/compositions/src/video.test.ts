import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { makeTheme } from "@news/theme";
import type { LockedSceneSpec } from "@news/schema";
import { z } from "zod";
import { registerComponent, unregisterComponent, type SceneTransitionProps } from "./registry.js";
import { CompositionBackdrop, presentationForSceneTransition, SceneContent } from "./video.js";

function makeScene(overrides: Partial<LockedSceneSpec> = {}): LockedSceneSpec {
  return {
    id: "scene-01",
    component: "not-registered",
    durationInSeconds: 3,
    headline: "Fallback",
    narration: "Một câu đọc thử.",
    props: {},
    startFrame: 0,
    durationInFrames: 90,
    ...overrides,
  };
}

function renderPresentation(
  presentation: ReturnType<typeof presentationForSceneTransition>,
  direction: "entering" | "exiting",
  progress: number,
): string {
  return renderToStaticMarkup(
    React.createElement(
      presentation.component as React.ComponentType<Record<string, unknown>>,
      {
        presentationProgress: progress,
        presentationDirection: direction,
        presentationDurationInFrames: 15,
        passedProps: presentation.props,
        onElementImage: () => {},
        onUnmount: () => {},
        bothEnteringAndExiting: false,
      },
      React.createElement("span", null, "child"),
    ),
  );
}

describe("VideoComposition missing-component fallback", () => {
  it("renders a visible error panel for unknown component ids", () => {
    const scene: LockedSceneSpec = makeScene();

    const html = renderToStaticMarkup(React.createElement(SceneContent, { scene }));

    expect(html).toContain("scene-01");
    expect(html).toContain("unknown component");
    expect(html).toContain("not-registered");
  });
});

describe("VideoComposition authored transitions", () => {
  it("uses the outgoing component's authored transition before the legacy enum", () => {
    const id = "test-transition-scene";
    unregisterComponent(id);
    const Transition: React.FC<SceneTransitionProps> = ({ direction, children }) =>
      React.createElement("div", { "data-authored-transition": direction }, children);
    registerComponent({
      id,
      displayName: "Test transition",
      promptGuide: "test only",
      schema: z.object({}),
      Component: () => null,
      transitionToNext: Transition,
      example: {},
    });

    const presentation = presentationForSceneTransition(makeScene({ component: id, transitionToNext: "slide" }), 0);
    const html = renderPresentation(presentation, "entering", 0.5);
    expect(html).toContain('data-authored-transition="entering"');

    unregisterComponent(id);
  });

  it("falls back to fade when no authored transition or legacy enum exists", () => {
    const presentation = presentationForSceneTransition(makeScene(), 0);
    const html = renderPresentation(presentation, "entering", 0.5);
    expect(html).toContain("opacity:0.5");
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
