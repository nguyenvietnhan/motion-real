import React from "react";
import { z } from "zod";
import { registerComponent } from "@motionreal/compositions";

export const schema = z.object({});
export const example = {};

const Scene = () => (
  <div style={{ backgroundImage: "url(https://cdn.example/x.svg)" }}>
    <img src="https://cdn.example/x.svg" />
  </div>
);
const HiddenFrame = () => React.createElement("iframe", { src: "assets/local.html" });
void HiddenFrame;

export default registerComponent({
  id: "authored-banned-raw-media-url",
  displayName: "Banned Raw Media Url",
  promptGuide: "fixture",
  schema,
  Component: Scene,
  example,
});
