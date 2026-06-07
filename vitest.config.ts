import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

/**
 * Windows ESM drive-letter casing guard (defense in depth).
 *
 * On Windows, drive letters are case-insensitive to the filesystem but
 * CASE-SENSITIVE to Node's ESM module-URL cache. If the process launches with a
 * lowercase drive letter (e.g. `v:\…`), Vitest can resolve `@vitest/runner`
 * under two URL casings and load it twice, detaching the test collector from
 * the worker runner ("No test suite found" / "failed to find the runner").
 *
 * The reliable fix is launching with a normalized cwd — see `scripts/test.ts`,
 * which `npm test` uses. Here we additionally normalize the alias targets to an
 * uppercase drive so module URLs stay consistent however vitest is invoked.
 */
const toUpperDrive = (p: string): string =>
  process.platform === "win32" ? p.replace(/^([a-z]):/, (_m, d: string) => `${d.toUpperCase()}:`) : p;

const rootDir = toUpperDrive(__dirname);
const pkg = (name: string) => resolve(rootDir, "packages", name, "src", "index.ts");

export default defineConfig({
  resolve: {
    alias: {
      "@news/schema": pkg("schema"),
      "@news/design": pkg("design"),
      "@news/blocks": pkg("blocks"),
      "@news/tts": pkg("tts"),
      "@news/compositions": pkg("compositions"),
      "@news/pipeline": pkg("pipeline"),
      "@news/mcp": pkg("mcp"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["packages/**/*.test.ts", "tests/**/*.test.ts", "apps/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
