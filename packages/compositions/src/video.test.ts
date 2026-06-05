import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { LockedSceneSpec } from "@news/schema";
import { SceneContent } from "./video.js";

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
