import React from "react";
import { registerTransition, type SceneBoundaryTransitionProps } from "@news/compositions";

const Transition: React.FC<SceneBoundaryTransitionProps> = ({ from }) => <div>{from}{Math.random()}</div>;

export default registerTransition({
  id: "scene-01-to-scene-02",
  displayName: "Bad fixture",
  Component: Transition,
});
