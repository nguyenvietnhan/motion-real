import { describe, expect, it } from "vitest";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { typecheckAuthoredScenes } from "./typecheck-authored.js";

/**
 * N10 authored-typecheck self-tests. Non-vacuous: a scene that composes
 * @news/blocks with the CORRECT prop types passes (no issue), while the exact
 * real-world Gemini mistake — passing `{text}[]` where a block is typed
 * `string[]` — is caught as an N10 error BEFORE any render (the render bundler
 * is transpile-only and would let it crash headless Chromium at runtime).
 *
 * The check resolves @news/* to the workspace sources, so these run against the
 * REAL block contracts, not a stub.
 */

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => join(here, "__fixtures__", name);
// repo root: packages/pipeline/src/safety → up 4.
const root = resolve(here, "..", "..", "..", "..");

describe("typecheckAuthoredScenes (N10)", () => {
  // Each of these spins up a real TypeScript program over the @news sources
  // (~3-5s); the default 5s vitest timeout is too tight under parallel load, so
  // give the program-creating cases explicit headroom.
  const TS_PROGRAM_TIMEOUT = 30_000;

  it("passes a scene that uses block props with the correct types", () => {
    const issues = typecheckAuthoredScenes([fixture("typecheck-clean.tsx")], root);
    expect(issues).toEqual([]);
  }, TS_PROGRAM_TIMEOUT);

  it("catches a wrong-shape prop ({text}[] vs string[]) as an N10 error", () => {
    const issues = typecheckAuthoredScenes([fixture("typecheck-wrong-prop.tsx")], root);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.check === "N10" && i.severity === "error")).toBe(true);
    // The diagnostic must point at the wrong-prop fixture, not a @news source.
    expect(issues.every((i) => /typecheck-wrong-prop\.tsx/.test(i.path ?? ""))).toBe(true);
  }, TS_PROGRAM_TIMEOUT);

  it("stamps each issue with the manifest sceneId so the repair loop can target it", () => {
    const file = fixture("typecheck-wrong-prop.tsx");
    const sceneIdByFile = new Map([[resolve(file), "scene-05"]]);
    const issues = typecheckAuthoredScenes([file], root, sceneIdByFile);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.sceneId === "scene-05")).toBe(true);
  }, TS_PROGRAM_TIMEOUT);

  it("is a no-op for an empty file list", () => {
    expect(typecheckAuthoredScenes([], root)).toEqual([]);
  });

  it("degrades to a no-op (never blocks) when the @news sources can't be resolved", () => {
    const issues = typecheckAuthoredScenes([fixture("typecheck-wrong-prop.tsx")], resolve(here, "no-such-workspace"));
    expect(issues).toEqual([]);
  });
});
