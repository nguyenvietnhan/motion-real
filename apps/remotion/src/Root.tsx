import React from "react";
import { Composition } from "remotion";
import { z } from "zod";
import { FPS, LockedVideoSpecSchema, geometry, type LockedVideoSpec } from "@motionreal/schema";
import { VideoComposition, ThumbnailComposition, ThumbnailPropsSchema } from "@motionreal/compositions";
import { theme } from "@motionreal/theme";
import "./demo-scenes.js"; // side-effect: registers demo scene components for the sample
import { sampleSpec } from "./fixtures/sample-spec.js";

const defaultCanvas = geometry().canvas;
const { width, height } = defaultCanvas;

const propsSchema = z.object({
  spec: LockedVideoSpecSchema,
  measure: z.boolean().optional(),
  strictSceneErrors: z.boolean().optional(),
});
// `NewsVideo`: legacy composition id for old saved render commands/entries.
// New work targets `MotionRealVideo`. Removal needs owner-approved sunset.
const VIDEO_COMPOSITION_IDS = ["MotionRealVideo", "NewsVideo"] as const;
const defaultVideoProps = { spec: sampleSpec } as { spec: LockedVideoSpec };

/** Frames the 1-frame thumbnail still renders within; the still is taken at the
 * LAST frame so the cover title's entrance reveal has fully settled (= 1). */
const THUMBNAIL_DURATION = 60;

/**
 * Registers the renderable composition. The whole video is driven by a single
 * `spec` input prop, so the server/CLI can render any project by passing its
 * locked spec via --props, while Studio previews the bundled sample.
 */
export const RemotionRoot: React.FC = () => {
  return (
    <>
      {VIDEO_COMPOSITION_IDS.map((id) => (
        <Composition
          key={id}
          id={id}
          component={VideoComposition}
          schema={propsSchema}
          defaultProps={defaultVideoProps}
          width={width}
          height={height}
          fps={FPS}
          durationInFrames={sampleSpec.durationInFrames}
          calculateMetadata={({ props }) => {
            const spec = props.spec;
            const g = geometry();
            return {
              durationInFrames: spec.durationInFrames,
              fps: spec.fps ?? FPS,
              width: g.canvas.width,
              height: g.canvas.height,
            };
          }}
        />
      ))}
      {/* Thumbnail/cover — short-form 9:16 still. Canvas from geometry(); still
          taken at the last frame so the title entrance reveal has settled. */}
      <Composition
        id="Thumbnail"
        component={ThumbnailComposition}
        schema={ThumbnailPropsSchema}
        defaultProps={{ format: "tiktok", dominant: theme.dominant, title: "Tiêu đề video mẫu" }}
        width={width}
        height={height}
        fps={FPS}
        durationInFrames={THUMBNAIL_DURATION}
        calculateMetadata={({ props: _props }) => {
          const g = geometry();
          return { width: g.canvas.width, height: g.canvas.height, durationInFrames: THUMBNAIL_DURATION, fps: FPS };
        }}
      />
    </>
  );
};
