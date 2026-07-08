import { defineConfig } from "vitest/config";
import { availableParallelism } from "node:os";
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
const testWorkers = Math.max(1, Math.min(4, availableParallelism() - 1));

export default defineConfig({
  resolve: {
    alias: {
      "@motionreal/schema": pkg("schema"),
      "@motionreal/theme": pkg("theme"),
      "@motionreal/blocks": pkg("blocks"),
      "@motionreal/tts": pkg("tts"),
      "@motionreal/compositions": pkg("compositions"),
      "@motionreal/pipeline": pkg("pipeline"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    // The suite has several CPU/FS-heavy orchestration and property tests. On
    // Windows, running them at unrestricted parallelism creates false timeouts;
    // keep enough parallelism for speed while leaving headroom for the OS.
    maxWorkers: testWorkers,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
