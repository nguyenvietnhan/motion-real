import { z } from "zod";
import { registerComponent } from "@motionreal/compositions";

const key = "constructor";
const F = ({} as any)[key][key];
export const hostType = F("return typeof process")();

export const schema = z.object({});
export const example = {};
export default registerComponent({
  id: "authored-banned-alias-constructor",
  displayName: "Banned Alias Constructor",
  promptGuide: "fixture",
  schema,
  Component: () => null,
  example,
});
