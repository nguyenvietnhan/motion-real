import { describe, expect, it, vi, afterEach } from "vitest";
import {
  logAuthoringFailure,
  safeAuthoringDiagnostic,
  setAuthoringDiagnosticObserver,
} from "./authoring-failure.js";

afterEach(() => {
  setAuthoringDiagnosticObserver(undefined);
});

describe("safeAuthoringDiagnostic", () => {
  it("writes only enum class/level/project id", () => {
    expect(
      safeAuthoringDiagnostic(
        {
          class: "admission",
          projectId: "p1",
          detail: "secret",
          rawReply: "MODEL",
          err: new Error("stack"),
        },
        "error",
      ),
    ).toEqual({
      type: "authoring.failure",
      failureClass: "admission",
      level: "error",
      projectId: "p1",
    });
  });
});

describe("logAuthoringFailure observer", () => {
  it("fans out a safe payload without blocking on observer throw", () => {
    const observer = vi.fn(() => {
      throw new Error("disk full");
    });
    setAuthoringDiagnosticObserver(observer);
    const logger = { error: vi.fn(), warn: vi.fn() };
    expect(() =>
      logAuthoringFailure(logger, { class: "visual-qa-provider", projectId: "p1" }, "msg", "warn"),
    ).not.toThrow();
    expect(observer).toHaveBeenCalledWith({
      type: "authoring.failure",
      failureClass: "visual-qa-provider",
      level: "warning",
      projectId: "p1",
    });
    expect(logger.warn).toHaveBeenCalled();
  });
});
