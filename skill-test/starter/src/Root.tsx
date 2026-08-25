import React from "react";
import { Composition } from "remotion";
import SampleVideo from "./video/SampleVideo";
import { VIDEO_FPS, VIDEO_HEIGHT, VIDEO_WIDTH } from "./lib/geometry";
import { ensureFonts } from "./lib/fonts";

ensureFonts();

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="SampleVideo"
      component={SampleVideo}
      durationInFrames={150}
      fps={VIDEO_FPS}
      width={VIDEO_WIDTH}
      height={VIDEO_HEIGHT}
      defaultProps={{
        titleText: "MotionReal Skill Studio",
        showSafeAreaGuides: true,
      }}
    />
  );
};
