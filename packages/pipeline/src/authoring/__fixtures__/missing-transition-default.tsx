import React from "react";
import { type SceneBoundaryTransitionProps } from "@news/compositions";

export const Transition: React.FC<SceneBoundaryTransitionProps> = ({ from }) => <div>{from}</div>;
