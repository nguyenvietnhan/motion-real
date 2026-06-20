import React from "react";
import { z } from "zod";
import { registerComponent, type SceneComponentProps } from "@news/compositions";

export const schema = z.object({});
type Props = z.infer<typeof schema>;

const Scene: React.FC<SceneComponentProps<Props>> = () => (
  <svg viewBox="0 0 200 200" width="200" height="200">
    <defs>
      <linearGradient id="bgGradient" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0%" stopColor="#1E9CB0" />
        <stop offset="100%" stopColor="#F7C948" />
      </linearGradient>
      <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#F7C948" />
      </marker>
    </defs>
    <rect x="10" y="10" width="180" height="120" fill="url(#bgGradient)" />
    <path d="M 40 160 L 160 160" stroke="#F7C948" strokeWidth="8" markerEnd="url(#arrow)" />
  </svg>
);

export const example: Props = {};

export default registerComponent<Props>({
  id: "authored-svg-fragment-url-ok",
  displayName: "SVG Fragment URL OK",
  promptGuide: "Uses local SVG gradient and marker fragment refs.",
  schema,
  Component: Scene,
  example,
});
