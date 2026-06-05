import React from "react";
import { Composition } from "remotion";
import { z } from "zod";
import { FPS, LockedVideoSpecSchema, type LockedVideoSpec } from "@news/schema";
import { VideoComposition } from "@news/compositions";
import { theme } from "@news/design";
import { sampleSpec } from "./fixtures/sample-spec.js";

const { width, height } = theme.canvas;

const propsSchema = z.object({ spec: LockedVideoSpecSchema });

/**
 * Registers the renderable composition. The whole video is driven by a single
 * `spec` input prop, so the server/CLI can render any project by passing its
 * locked spec via --props, while Studio previews the bundled sample.
 */
export const RemotionRoot: React.FC = () => {
  return (
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
  );
};
