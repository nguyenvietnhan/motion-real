import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";

/**
 * Render-free tests for the SURVIVING @news/blocks surface (post-block-removal):
 * the layout blocks (Frame/TitleBlock/KeyPoints/Panel/Story/…) were deleted —
 * the AI bốc them into every scene → monotony — so authored scenes now write raw
 * JSX/SVG. What remains is the render runtime + `SceneImage`, the one sanctioned
 * image block (authored code reaches it via @news/compositions). These two are
 * what the render path still depends on, so they keep a non-vacuous test.
 *
 * Blocks call Remotion's frame hooks, so we mock ONLY `useCurrentFrame`/
 * `useVideoConfig` (frame 0) and keep the rest of Remotion real.
 */

vi.mock("remotion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("remotion")>();
  return {
    ...actual,
    useCurrentFrame: () => 0,
    useVideoConfig: () =>
      ({ fps: 30, durationInFrames: 300, width: 1080, height: 1920 } as unknown as ReturnType<
        typeof actual.useVideoConfig
      >),
    // `staticFile` reads Remotion's bundler context (absent under SSR), so map it
    // to a stable local URL — the SceneImage test only asserts the ref flows into
    // the <img src> and is fitted, not how Remotion resolves a real bundle path.
    staticFile: (path: string) => `static/${path}`,
    // Remotion's <Img> needs a real composition/video config at render time;
    // under SSR it throws. Stub it to a plain <img> so the SceneImage test can
    // assert the src/alt/fit it produces (the wrapper styling is the block's own).
    Img: (props: Record<string, unknown>) => React.createElement("img", props),
  };
});

import { Captions, SceneImage } from "./index.js";
import { type CaptionCue } from "@news/schema";

const html = (el: React.ReactElement): string => renderToStaticMarkup(el);

describe("@news/blocks — surviving render surface", () => {
  it("Captions shows the active cue and hides when none is active (R16.1)", () => {
    const cues: CaptionCue[] = [
      { startFrame: 0, endFrame: 60, text: "Dòng caption đang chạy", sceneId: "scene-01" },
      { startFrame: 90, endFrame: 150, text: "Dòng sau", sceneId: "scene-02" },
    ];
    const active = html(React.createElement(Captions, { cues }));
    expect(active).toContain("Dòng caption đang chạy");
    expect(active).not.toContain("Dòng sau");

    const none = html(React.createElement(Captions, { cues: [cues[1]!] }));
    expect(none).toBe("");
  });

  it("SceneImage fills the content column width with height following the image aspect (no side gaps)", () => {
    const markup = html(React.createElement(SceneImage, { imageRef: "assets/photo.png", alt: "biểu đồ" }));
    // The local ref flows through staticFile into the <img src> (mocked to static/<ref>).
    expect(markup).toContain('src="static/assets/photo.png"');
    expect(markup).toContain('alt="biểu đồ"');
    // FILL the column width (no empty side gaps); height auto-follows the image's
    // true aspect ratio, with a maxHeight + object-fit cap for tall portraits.
    expect(markup).toContain("width:100%");
    expect(markup).toContain("height:auto");
    expect(markup).toMatch(/max-height:[1-9]/);
    expect(markup).toContain("object-fit:contain");
    // The frame (border) is drawn ON the image so the chrome hugs the picture.
    expect(markup).toContain("border:");
    // Tagged so the N15 layout probe can measure it.
    expect(markup).toContain('data-nrt-block="scene-image"');
  });
});
