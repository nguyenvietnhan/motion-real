import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const pkg = (name: string) => resolve(__dirname, "packages", name, "src", "index.ts");

export default defineConfig({
  resolve: {
    alias: {
      "@news/schema": pkg("schema"),
      "@news/design": pkg("design"),
      "@news/tts": pkg("tts"),
      "@news/compositions": pkg("compositions"),
      "@news/pipeline": pkg("pipeline"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["packages/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
