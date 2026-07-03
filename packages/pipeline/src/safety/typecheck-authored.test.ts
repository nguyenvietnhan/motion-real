import { beforeEach, describe, expect, it } from "vitest";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { __directoryFingerprint, __resetTypecheckAuthoredCache, __typecheckAuthoredCacheStats, typecheckAuthoredScenes } from "./typecheck-authored.js";

/**
 * N10 authored-typecheck self-tests. Non-vacuous: a scene that composes
 * @motionreal/blocks with the CORRECT prop types passes (no issue), while the exact
 * real-world Gemini mistake — passing `{text}[]` where a block is typed
 * `string[]` — is caught as an N10 error BEFORE any render (the render bundler
 * is transpile-only and would let it crash headless Chromium at runtime).
 *
 * The check resolves @motionreal/* to the workspace sources, so these run against the
 * REAL block contracts, not a stub.
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
  const TS_PROGRAM_TIMEOUT = 30_000;

  it("passes a scene that uses block props with the correct types", () => {
    const issues = typecheckAuthoredScenes([fixture("typecheck-clean.tsx")], root);
    expect(issues).toEqual([]);
  }, TS_PROGRAM_TIMEOUT);

  // A render fallback is not an acceptable clean draft: SceneErrorBoundary keeps
  // the MP4 alive, but it replaces the authored design with a bland headline-only
  // frame. Crash/fallback-prone type errors must therefore be hard N10 errors so
  // the repair loop reauthors the scene before the user sees it.
  it("catches a wrong-shape prop ({text}[] vs string[]) and surfaces it as a hard N10 error", () => {
    const issues = typecheckAuthoredScenes([fixture("typecheck-wrong-prop.tsx")], root);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.check === "N10" && i.severity === "error")).toBe(true);
    // The diagnostic must point at the wrong-prop fixture, not a MotionReal source.
    expect(issues.every((i) => /typecheck-wrong-prop\.tsx/.test(i.path ?? ""))).toBe(true);
  }, TS_PROGRAM_TIMEOUT);

  it("stamps each issue with the manifest sceneId so the repair loop can target it", () => {
    const file = fixture("typecheck-wrong-prop.tsx");
    const sceneIdByFile = new Map([[resolve(file), "scene-05"]]);
    const issues = typecheckAuthoredScenes([file], root, sceneIdByFile);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.sceneId === "scene-05")).toBe(true);
  }, TS_PROGRAM_TIMEOUT);

  it("flags an un-aliased color token as a WARNING (not a hard error), since the runtime Proxy makes it safe", () => {
    const issues = typecheckAuthoredScenes([fixture("typecheck-missing-color.tsx")], root);
    expect(issues.length).toBeGreaterThan(0);
    // Every diagnostic here is a missing ThemeColors token → all warnings, no errors.
    expect(issues.every((i) => i.check === "N10")).toBe(true);
    expect(issues.every((i) => i.severity === "warning")).toBe(true);
    expect(issues.some((i) => /does not exist on type 'ThemeColors'/.test(i.message))).toBe(true);
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

  it("warns on an implicit-any parameter because the emitted JavaScript is runtime-safe", () => {
    const issues = typecheckAuthoredScenes([fixture("typecheck-implicit-any.tsx")], root);
    expect(issues).toContainEqual(
      expect.objectContaining({
        check: "N10",
        severity: "warning",
        message: expect.stringContaining("TS7006"),
      }),
    );
    expect(issues.some((i) => i.severity === "error")).toBe(false);
  }, TS_PROGRAM_TIMEOUT);

  it("flags a FLAT theme.* color read (type 'Theme') as a WARNING too, not a hard error", () => {
    // The gizmodo 591bfd84 habit: `theme.accent` / `theme.someUnknown` straight
    // off the theme. The theme Proxy resolves both safely, so an un-aliased flat
    // token must be a warning (never block), exactly like theme.colors.*.
    const issues = typecheckAuthoredScenes([fixture("typecheck-flat-theme.tsx")], root);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.severity === "warning")).toBe(true);
    expect(issues.every((i) => /does not exist on type 'Theme'/.test(i.message))).toBe(true);
  }, TS_PROGRAM_TIMEOUT);

  it("flags an EXCESS component prop (<Frame style={…}>) as a WARNING, not a hard error", () => {
    // The gemini-3-flash habit: passing `style`/other undeclared props to a block
    // to set a background. React ignores undeclared props at runtime, so the scene
    // renders fine — N10 must warn, never block.
    const issues = typecheckAuthoredScenes([fixture("typecheck-excess-prop.tsx")], root);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.severity === "warning")).toBe(true);
    expect(issues.some((i) => /does not exist on type 'IntrinsicAttributes/.test(i.message))).toBe(true);
  }, TS_PROGRAM_TIMEOUT);

  it("flags an out-of-union string-literal prop (<Tag tone=\"regular\">) as a WARNING, not a hard error", () => {
    // The cx/gpt-5.5 habit: passing an invented tone value like "regular" where
    // Tone is "accent" | "signal" | "blue" | …. The block resolves an unknown
    // tone through a `default:` switch arm to a safe color, so the scene renders
    // fine — N10 must warn, never block. The crash-class {text}[] case (whose
    // source type is an object array, not a quoted string) stays a hard error.
    const issues = typecheckAuthoredScenes([fixture("typecheck-tone-enum.tsx")], root);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.severity === "warning")).toBe(true);
    expect(issues.some((i) => /is not assignable to type 'Tone/.test(i.message))).toBe(true);
  }, TS_PROGRAM_TIMEOUT);

  it("is a no-op for an empty file list", () => {
    expect(typecheckAuthoredScenes([], root)).toEqual([]);
  });

  it("degrades to a no-op (never blocks) when the MotionReal sources can't be resolved", () => {
    const issues = typecheckAuthoredScenes([fixture("typecheck-wrong-prop.tsx")], resolve(here, "no-such-workspace"));
    expect(issues).toEqual([]);
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
