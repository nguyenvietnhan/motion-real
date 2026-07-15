import { describe, expect, it } from "vitest";
import { createLogger, logger } from "./logger.js";

describe("createLogger", () => {
  it("scopes methods and never throws on structured warn", () => {
    const log = createLogger("ingest");
    expect(log.bindings().scope).toBe("ingest");
    for (const level of ["debug", "info", "warn", "error"] as const) {
      expect(typeof log[level]).toBe("function");
    }
    expect(() => log.warn({ projectId: "p1", err: new Error("boom") }, "something recoverable")).not.toThrow();
    expect(logger.bindings().scope).toBeUndefined();
  });
});
