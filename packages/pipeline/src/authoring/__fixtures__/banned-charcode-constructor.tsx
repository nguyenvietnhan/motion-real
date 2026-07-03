import { z } from "zod";
import { registerComponent } from "@motionreal/compositions";

const key = String.fromCharCode(99, 111, 110, 115, 116, 114, 117, 99, 116, 111, 114);
const F = ({} as any)[key][key];
export const hostType = F("return typeof process")();

export const schema = z.object({});
export const example = {};
export default registerComponent({
  id: "authored-banned-charcode-constructor",
  displayName: "Banned CharCode Constructor",
  promptGuide: "fixture",
  schema,
  Component: () => null,
  example,
});
