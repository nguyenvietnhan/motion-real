import React from "react";
import { AbsoluteFill } from "remotion";
import {
  registerTransition,
  type SceneBoundaryTransitionProps,
} from "@news/compositions";

const Transition: React.FC<SceneBoundaryTransitionProps> = ({ progress, from, to }) => (
  <AbsoluteFill>
    <AbsoluteFill style={{ opacity: 1 - progress }}>{from}</AbsoluteFill>
    <AbsoluteFill style={{ opacity: progress }}>{to}</AbsoluteFill>
  </AbsoluteFill>
);

export default registerTransition({
  id: "scene-01-to-scene-02",
  displayName: "Clean fixture",
  Component: Transition,
});
