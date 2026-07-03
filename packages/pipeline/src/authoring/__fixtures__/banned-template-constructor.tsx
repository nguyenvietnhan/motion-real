import { z } from "zod";
import { registerComponent } from "@motionreal/compositions";

const F = ({} as any)[`constructor`][`constructor`];
export const hostType = F("return typeof process")();

export const schema = z.object({});
export const example = {};
export default registerComponent({
  id: "authored-banned-template-constructor",
  displayName: "Banned Template Constructor",
  promptGuide: "fixture",
  schema,
  Component: () => null,
  example,
});
