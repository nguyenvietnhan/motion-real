import { beforeEach, describe, expect, it } from "vitest";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { __directoryFingerprint, __resetTypecheckAuthoredCache, __typecheckAuthoredCacheStats, typecheckAuthoredScenes } from "./typecheck-authored.js";

/**
 * N10 authored-typecheck self-tests (B-minimal / crash-only).
 *
 * Hard errors: unbound names (TS2304 / "Cannot find name") — ReferenceError under
 * transpile-only bundling → SceneErrorBoundary.
 *
 * Dropped (not reported): wrong-shape props, excess props, tone enums, spring
 * config typos, implicit-any — normalizer + vision own those classes.
 *
 * The check resolves @motionreal/* to the workspace sources, so these run against
 * the real component contracts, not a stub.
 */

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => join(here, "__fixtures__", name);
// repo root: packages/pipeline/src/safety → up 4.
const root = resolve(here, "..", "..", "..", "..");

describe("typecheckAuthoredScenes (N10)", () => {
  beforeEach(() => {
    __resetTypecheckAuthoredCache();
  });

  // Each of these spins up a real TypeScript program over the MotionReal sources
  // (~3-5s); the default 5s vitest timeout is too tight under parallel load, so
  // give the program-creating cases explicit headroom.
  const TS_PROGRAM_TIMEOUT = 60_000;

  it("passes a scene that uses the current authored component surface with correct prop types", () => {
    const issues = typecheckAuthoredScenes([fixture("typecheck-clean.tsx")], root);
    expect(issues).toEqual([]);
  }, TS_PROGRAM_TIMEOUT);

  it("exposes durationInFrames as top-level authored scene context", () => {
    const issues = typecheckAuthoredScenes([fixture("typecheck-duration-in-frames.tsx")], root);
    expect(issues).toEqual([]);
  }, TS_PROGRAM_TIMEOUT);

  it("resolves allowed bare imports for authored files outside the workspace", () => {
    const dir = mkdtempSync(join(tmpdir(), "n10-outside-workspace-"));
    try {
      const file = join(dir, "scene-01.tsx");
      writeFileSync(file, readFileSync(fixture("typecheck-clean.tsx"), "utf8"), "utf8");
      const issues = typecheckAuthoredScenes([file], root);
      expect(issues).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, TS_PROGRAM_TIMEOUT);

  // B-minimal: non-crash type noise is dropped (not soft-warnings).
  it("drops wrong-shape prop diagnostics (not crash-class under B-minimal)", () => {
    const issues = typecheckAuthoredScenes([fixture("typecheck-wrong-prop.tsx")], root);
    expect(issues).toEqual([]);
  }, TS_PROGRAM_TIMEOUT);

  it("drops invalid Remotion spring config field tension (TS2353 is non-crash)", () => {
    const file = fixture("typecheck-spring-tension.tsx");
    const issues = typecheckAuthoredScenes([file], root, new Map([[resolve(file), "scene-09"]]));
    expect(issues).toEqual([]);
  }, TS_PROGRAM_TIMEOUT);

  it("hard-fails an undefined identifier because it would render SceneFallback", () => {
    const issues = typecheckAuthoredScenes([fixture("typecheck-missing-identifier.tsx")], root);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues).toContainEqual(
      expect.objectContaining({
        check: "N10",
        severity: "error",
        message: expect.stringContaining("Cannot find name 'imageOpacity'"),
      }),
    );
  }, TS_PROGRAM_TIMEOUT);

  it("stamps each crash-class issue with the manifest sceneId so repair can target it", () => {
    const file = fixture("typecheck-missing-identifier.tsx");
    const sceneIdByFile = new Map([[resolve(file), "scene-05"]]);
    const issues = typecheckAuthoredScenes([file], root, sceneIdByFile);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.sceneId === "scene-05")).toBe(true);
  }, TS_PROGRAM_TIMEOUT);

  it("drops implicit-any parameter diagnostics (runtime-safe; not crash-class)", () => {
    const issues = typecheckAuthoredScenes([fixture("typecheck-implicit-any.tsx")], root);
    expect(issues).toEqual([]);
  }, TS_PROGRAM_TIMEOUT);

  it("drops excess component prop diagnostics (React ignores undeclared props)", () => {
    const issues = typecheckAuthoredScenes([fixture("typecheck-excess-prop.tsx")], root);
    expect(issues).toEqual([]);
  }, TS_PROGRAM_TIMEOUT);

  it("drops out-of-union string-literal prop diagnostics (tone enum)", () => {
    const issues = typecheckAuthoredScenes([fixture("typecheck-tone-enum.tsx")], root);
    expect(issues).toEqual([]);
  }, TS_PROGRAM_TIMEOUT);

  it("is a no-op for an empty file list", () => {
    expect(typecheckAuthoredScenes([], root)).toEqual([]);
  });

  it("degrades to a non-blocking diagnostic when the MotionReal sources can't be resolved", () => {
    const missingRoot = resolve(here, "no-such-workspace");
    const issues = typecheckAuthoredScenes([fixture("typecheck-wrong-prop.tsx")], missingRoot);
    expect(issues).toEqual([
      expect.objectContaining({
        check: "N10",
        severity: "warning",
        path: missingRoot,
        message: expect.stringContaining("N10 degraded to a no-op"),
      }),
    ]);
  });

  it("reuses the cached diagnostics when the authored files and contracts are unchanged", () => {
    const file = fixture("typecheck-wrong-prop.tsx");
    const sceneIdByFile = new Map([[resolve(file), "scene-05"]]);
    const first = typecheckAuthoredScenes([file], root, sceneIdByFile);
    const second = typecheckAuthoredScenes([file], root, sceneIdByFile);

    expect(second).toEqual(first);
    expect(__typecheckAuthoredCacheStats()).toEqual({ hits: 1, misses: 1, entries: 1 });
  }, TS_PROGRAM_TIMEOUT);

  it("fingerprints contract source bytes rather than mtime and size", () => {
    const dir = mkdtempSync(join(tmpdir(), "n10-fingerprint-"));
    try {
      const file = join(dir, "contract.ts");
      writeFileSync(file, "export const value = 'aaaa';\n", "utf8");
      const originalStat = statSync(file);
      const original = __directoryFingerprint(dir);

      // Same byte length and restored mtime, but different source bytes.
      writeFileSync(file, "export const value = 'bbbb';\n", "utf8");
      utimesSync(file, originalStat.atime, originalStat.mtime);
      expect(statSync(file).size).toBe(originalStat.size);
      expect(__directoryFingerprint(dir)).not.toBe(original);

      const changed = __directoryFingerprint(dir);
      const touched = new Date(Date.now() + 60_000);
      utimesSync(file, touched, touched);
      expect(__directoryFingerprint(dir)).toBe(changed);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
