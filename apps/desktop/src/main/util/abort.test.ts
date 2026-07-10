import { describe, expect, it } from "vitest";
import { isAbortError, isCancelled, throwIfAborted } from "./abort.js";

describe("abort helpers", () => {
  it("detects AbortError by name", () => {
    const err = new Error("x");
    err.name = "AbortError";
    expect(isAbortError(err)).toBe(true);
    expect(isAbortError(new Error("nope"))).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });

  it("throwIfAborted only throws when the signal is aborted", () => {
    expect(() => throwIfAborted(undefined)).not.toThrow();
    expect(() => throwIfAborted(new AbortController().signal)).not.toThrow();
    const c = new AbortController();
    c.abort();
    expect(() => throwIfAborted(c.signal)).toThrowError(/aborted/i);
  });

  it("isCancelled covers signal and error", () => {
    const c = new AbortController();
    expect(isCancelled(c.signal)).toBe(false);
    c.abort();
    expect(isCancelled(c.signal)).toBe(true);
    const err = new Error("x");
    err.name = "AbortError";
    expect(isCancelled(undefined, err)).toBe(true);
  });
});
