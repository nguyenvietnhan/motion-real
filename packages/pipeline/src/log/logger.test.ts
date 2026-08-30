import { describe, expect, it, vi } from "vitest";
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

  it("honors a fatal-only threshold", async () => {
    vi.resetModules();
    vi.stubEnv("LOG_LEVEL", "fatal");
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const isolated = await import("./logger.js");
    isolated.createLogger("test").error("must stay quiet");
    expect(write).not.toHaveBeenCalled();
    write.mockRestore();
    vi.unstubAllEnvs();
  });
});
