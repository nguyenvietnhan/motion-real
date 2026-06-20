import { z } from "zod";
import { registerComponent } from "@news/compositions";

export const schema = z.object({});
export const example = {};
const Scene = () => <div>broken;

export default registerComponent({
  id: "authored-banned-invalid-syntax",
  displayName: "Invalid Syntax",
  promptGuide: "fixture",
  schema,
  Component: Scene,
  example,
});
