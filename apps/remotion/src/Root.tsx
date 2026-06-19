import React from "react";
import { Composition } from "remotion";
import { z } from "zod";
import { FPS, LockedVideoSpecSchema, geometry, type LockedVideoSpec } from "@news/schema";
import { VideoComposition, ThumbnailComposition, ThumbnailPropsSchema } from "@news/compositions";
import { theme } from "@news/theme";
import "./demo-scenes.js"; // side-effect: registers demo scene components for the sample
import { sampleSpec } from "./fixtures/sample-spec.js";

const { width, height } = theme.canvas;

const propsSchema = z.object({ spec: LockedVideoSpecSchema, measure: z.boolean().optional() });

/** Frames the 1-frame thumbnail still renders within; the still is taken at the
 *  LAST frame so `TitleBlock`'s entrance reveal has fully settled (= 1). */
const THUMBNAIL_DURATION = 60;

/**
 * Registers the renderable composition. The whole video is driven by a single
 * `spec` input prop, so the server/CLI can render any project by passing its
 * locked spec via --props, while Studio previews the bundled sample.
 */
export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="NewsVideo"
        component={VideoComposition}
        schema={propsSchema}
        defaultProps={{ spec: sampleSpec } as { spec: LockedVideoSpec }}
        width={width}
        height={height}
        fps={FPS}
        durationInFrames={sampleSpec.durationInFrames}
        calculateMetadata={({ props }) => {
          const spec = props.spec;
          return {
            durationInFrames: spec.durationInFrames,
            fps: spec.fps ?? FPS,
            width,
            height,
          };
        }}
      />
      {/* Thumbnail/cover (R12, I3) — a single format-aware still. The canvas is
          sized off `geometry(props.format)` HERE (1080×1920 for tiktok, 1920×1080
          for youtube), the one place format drives dimensions; the still is taken
          at the last frame so the title's entrance reveal has settled. */}
      <Composition
        id="Thumbnail"
        component={ThumbnailComposition}
        schema={ThumbnailPropsSchema}
        defaultProps={{ format: "tiktok", dominant: theme.dominant, title: "Tiêu đề video mẫu" }}
        width={width}
        height={height}
        fps={FPS}
        durationInFrames={THUMBNAIL_DURATION}
        calculateMetadata={({ props }) => {
          const g = geometry(props.format);
          return { width: g.canvas.width, height: g.canvas.height, durationInFrames: THUMBNAIL_DURATION, fps: FPS };
        }}
      />
    </>
  );
};
