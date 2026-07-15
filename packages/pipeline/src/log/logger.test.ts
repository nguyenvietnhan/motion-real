import { describe, expect, it } from "vitest";
import { createLogger, logger } from "./logger.js";

/**
 * Logger smoke tests (library-adoption pilot). We don't assert on the NDJSON
 * bytes (the root writes to fd 2 via SonicBoom, off-limits to a unit test);
 * instead we assert the SHAPE the rest of the code relies on: a scope-tagged
 * child carries its `scope` binding, distinct scopes don't bleed, and the
 * standard level methods exist (so a `log.warn(...)` call site never throws).
 */

describe("createLogger", () => {
  it("tags the child logger with its scope binding", () => {
    const log = createLogger("authoring");
    expect(log.bindings().scope).toBe("authoring");
  });

  it("keeps distinct scopes independent", () => {
    const a = createLogger("authoring");
    const b = createLogger("render");
    expect(a.bindings().scope).toBe("authoring");
    expect(b.bindings().scope).toBe("render");
  });

  it("exposes the standard level methods a call site uses", () => {
    const log = createLogger("ingest");
    for (const level of ["debug", "info", "warn", "error"] as const) {
      expect(typeof log[level]).toBe("function");
    }
  });

  it("does not throw when logging a structured payload + message", () => {
    const log = createLogger("test");
    expect(() => log.warn({ projectId: "p1", err: new Error("boom") }, "something recoverable")).not.toThrow();
  });

  it("exposes a bare root logger with no scope binding", () => {
    expect(logger.bindings().scope).toBeUndefined();
  });
});
