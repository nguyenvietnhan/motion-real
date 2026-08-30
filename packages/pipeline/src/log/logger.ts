/**
 * Centralized scoped logger. One small NDJSON writer for pipeline + desktop
 * main; callers take a SCOPE-tagged child so every line carries `scope`.
 *
 * Writes straight to stderr (fd 2) so logs never corrupt a stdout JSON protocol.
 * No worker-thread transport, no bundler special cases.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
type LogThreshold = LogLevel | "fatal";

export type LogBindings = { scope?: string };

type LogFields = Record<string, unknown>;

export type Logger = {
  bindings(): LogBindings;
  debug: LogMethod;
  info: LogMethod;
  warn: LogMethod;
  error: LogMethod;
};

/** Pino-compatible: `log.warn("msg")` or `log.warn(fields, "msg")`. */
export type LogMethod = (fieldsOrMsg?: unknown, msg?: string) => void;

/** Resolve the log level from env, defaulting to `info` (debug in dev). */
function resolveLevel(): LogThreshold {
  const fromEnv = process.env.LOG_LEVEL?.trim()?.toLowerCase();
  if (fromEnv === "debug" || fromEnv === "info" || fromEnv === "warn" || fromEnv === "error" || fromEnv === "fatal") {
    return fromEnv;
  }
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

const LEVEL_RANK: Record<LogThreshold, number> = {
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  // This logger has no fatal writer. Match common logger semantics by silencing
  // all available methods when callers request a fatal-only threshold.
  fatal: 60,
};

const minLevel = resolveLevel();

function serializeValue(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  if (Array.isArray(value)) {
    return value.map(serializeValue);
  }
  if (value && typeof value === "object") {
    const out: LogFields = {};
    for (const [k, v] of Object.entries(value as LogFields)) {
      out[k] = serializeValue(v);
    }
    return out;
  }
  return value;
}

function writeLine(level: LogLevel, bindings: LogBindings, fieldsOrMsg?: unknown, msg?: string): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[minLevel]) return;

  let message = "";
  let fields: LogFields = {};
  if (typeof fieldsOrMsg === "string" && msg === undefined) {
    message = fieldsOrMsg;
  } else if (fieldsOrMsg !== undefined && fieldsOrMsg !== null && typeof fieldsOrMsg === "object") {
    fields = (serializeValue(fieldsOrMsg) as LogFields) ?? {};
    message = typeof msg === "string" ? msg : "";
  } else if (typeof fieldsOrMsg === "string") {
    message = fieldsOrMsg;
  } else if (typeof msg === "string") {
    message = msg;
  }

  const line = {
    level,
    time: new Date().toISOString(),
    ...(bindings.scope ? { scope: bindings.scope } : {}),
    ...fields,
    ...(message ? { msg: message } : {}),
  };

  try {
    process.stderr.write(`${JSON.stringify(line)}\n`);
  } catch {
    // Never throw from logging.
  }
}

function makeLogger(bindings: LogBindings): Logger {
  const method = (level: LogLevel): LogMethod => {
    return (fieldsOrMsg?: unknown, msg?: string) => {
      writeLine(level, bindings, fieldsOrMsg, msg);
    };
  };

  return {
    bindings: () => ({ ...bindings }),
    debug: method("debug"),
    info: method("info"),
    warn: method("warn"),
    error: method("error"),
  };
}

const root: Logger = makeLogger({});

/**
 * A scope-tagged child logger. Every authoring/render/ingest module takes one at
 * top of file: `const log = createLogger("authoring")`.
 */
export function createLogger(scope: string): Logger {
  return makeLogger({ scope });
}

/** The bare root logger, for the rare caller that wants no scope. */
export { root as logger };
