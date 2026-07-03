import React from "react";
import { Img, staticFile } from "remotion";
import { z } from "zod";
import { registerComponent, type SceneComponentProps } from "@motionreal/compositions";

export const schema = z.object({ label: z.string() });
type Props = z.infer<typeof schema>;

// Smuggle attempt: an authored scene must NOT reach for Remotion's raw media
// primitives — images may reach the screen ONLY through the sanctioned
// <SceneImage> block (admission N5 bans Img/staticFile/Video/OffthreadVideo).
const C: React.FC<SceneComponentProps<Props>> = ({ headline }) => (
  <div>
    {headline}
    <Img src={staticFile("assets/x.png")} />
  </div>
);

export const example: Props = { label: "x" };

export default registerComponent<Props>({
  id: "authored-bad-media",
  displayName: "Bad Media",
  promptGuide: "x",
  schema,
  Component: C,
  example,
});
