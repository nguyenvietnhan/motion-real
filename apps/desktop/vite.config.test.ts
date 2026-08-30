import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "./vite.config.js";

describe("desktop CSP", () => {
  it("permits Vite's inline React-refresh preamble only during development", () => {
    expect(contentSecurityPolicy(true)).toContain("script-src 'self' 'unsafe-eval' 'unsafe-inline'");
    expect(contentSecurityPolicy(false)).toContain("script-src 'self'");
    expect(contentSecurityPolicy(false)).not.toContain("script-src 'self' 'unsafe-inline'");
  });
});
