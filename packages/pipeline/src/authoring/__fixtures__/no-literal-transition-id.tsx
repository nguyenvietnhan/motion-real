import React from "react";
import { registerTransition, type SceneBoundaryTransitionProps } from "@news/compositions";

const id = "scene-01-to-scene-02";
const Transition: React.FC<SceneBoundaryTransitionProps> = ({ from }) => <div>{from}</div>;

export default registerTransition({
  id,
  displayName: "Bad fixture",
  Component: Transition,
});
