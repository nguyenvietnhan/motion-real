import { spawn } from "node:child_process";

/**
 * Test launcher with a Windows ESM drive-letter casing guard.
 *
 * On Windows, drive letters are case-insensitive to the filesystem but
 * CASE-SENSITIVE to Node's ESM module-URL cache. Some terminals launch with a
 * lowercase drive letter (e.g. `v:\…`); Vitest then resolves `@vitest/runner`
 * under two different URL casings and loads it twice, so the worker initializes
 * one runner instance while the test files' `describe`/`beforeEach` register on
 * the other — every suite fails with "No test suite found" /
 * "Vitest failed to find the runner".
 *
 * The casing must be consistent at PROCESS LAUNCH (fixing it inside
 * vitest.config.ts is too late — the main process has already resolved its
 * module paths). So we re-exec vitest in a child process whose cwd uses an
 * uppercase drive letter. No-op on non-Windows.
 */
const args = process.argv.slice(2);
const cwd = process.cwd().replace(/^([a-z]):/, (_m, d: string) => `${d.toUpperCase()}:`);

const child = spawn("npx", ["vitest", "run", ...args], {
  cwd,
  stdio: "inherit",
  shell: true,
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
