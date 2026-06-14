import pino, { type Logger } from "pino";

/**
 * Centralized structured logger (library-adoption pilot). One Pino instance for
 * the whole pipeline + desktop main; callers take a SCOPE-tagged child so every
 * line carries `scope` (`authoring`, `render`, `ingest`, …) and a failure is
 * never swallowed silently again (the "lỗi đẻ ra lỗi" root cause: a bare
 * `catch {}` hid a fault, state corrupted, an unrelated step later crashed).
 *
 * BUNDLER-SAFE BY DESIGN. Pino's worker-thread transports (`pino-pretty`,
 * `pino/file`) can't be esbuild-bundled without shipping extra worker files —
 * and the Electron main IS bundled (`apps/desktop/build-electron.mjs`, esbuild
 * `packages: "external"`). So we DON'T use a transport: we log straight to a
 * `pino.destination()` on the MAIN thread (NDJSON to the chosen fd). No worker,
 * no transport, nothing for the bundler to miss. Pretty rendering, if ever
 * wanted, is a downstream `| pino-pretty` on the terminal, never in-process.
 */

/** Resolve the log level from env, defaulting to `info` (debug in dev). */
function resolveLevel(): string {
  const fromEnv = process.env.LOG_LEVEL?.trim();
  if (fromEnv) return fromEnv;
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

/**
 * The single root logger. `pino.destination({ sync: false })` is a SonicBoom
 * stream on the main thread — fast, no worker thread, bundler-safe. fd 2
 * (stderr) keeps logs off stdout so they never corrupt a stdout JSON protocol
 * (the MCP stdio server writes its protocol to stdout).
 */
const root: Logger = pino(
  {
    level: resolveLevel(),
    // ISO timestamps read better than epoch ms in a terminal scrollback.
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  pino.destination({ fd: 2, sync: false }),
);

/**
 * A scope-tagged child logger. Every authoring/render/ingest module takes one at
 * top of file: `const log = createLogger("authoring")`. The `scope` field then
 * tags every line so a fault is greppable by subsystem.
 */
export function createLogger(scope: string): Logger {
  return root.child({ scope });
}

/** The bare root logger, for the rare caller that wants no scope. */
export { root as logger };
