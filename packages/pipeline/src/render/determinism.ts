import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LockedVideoSpec } from "@motionreal/schema";
import { makeReport, type SafetyIssue, type SafetyReport } from "../types.js";
import { renderFrameTwice, type RenderFrameOptions } from "./renderer.js";

/**
 * Determinism guard (N16, Requirement 7.2). Scene visuals must be pure
 * functions of the frame, so rendering the same frame of the same locked spec
 * twice must be byte-identical. This pre-render guard samples ONE frame, renders
 * it twice via the renderer (renderStill, single bundle), and byte-compares the
 * two PNGs. A mismatch means hidden randomness/time leaked into scene code
 * (the static forbidden-API lint, N5, is the complementary defense).
 *
 * Returns a SafetyReport (rather than throwing) for testability and to match the
 * build-grid convention (runBuildGridStatic). `assertDeterministicFrame` is the
 * throwing variant for orchestrator call sites that want to fail fast.
 */
export type DeterminismOptions = RenderFrameOptions;

/** Deterministic sample frame: the midpoint of the first scene. */
export function sampleFrame(spec: LockedVideoSpec): number {
  const first = spec.scenes[0];
  if (!first) return 0;
  const midpoint = first.startFrame + Math.floor(first.durationInFrames / 2);
  return Math.min(Math.max(0, midpoint), Math.max(0, spec.durationInFrames - 1));
}

/**
 * Render the sampled frame twice and byte-compare. Cleans up its temp files.
 * ok === false (N16 error) when the two renders differ.
 */
export async function checkDeterminism(
  spec: LockedVideoSpec,
  opts: DeterminismOptions = {},
): Promise<SafetyReport> {
  const frame = sampleFrame(spec);
  const dir = await mkdtemp(join(tmpdir(), "news-determinism-"));
  try {
    const [pathA, pathB] = await renderFrameTwice(
      spec,
      frame,
      [join(dir, "frame-a.png"), join(dir, "frame-b.png")],
      opts,
    );
    const [bytesA, bytesB] = await Promise.all([readFile(pathA), readFile(pathB)]);
    const identical = bytesA.length === bytesB.length && bytesA.equals(bytesB);
    const issues: SafetyIssue[] = identical
      ? []
      : [
          {
            check: "N16",
            severity: "error",
            message:
              `Frame ${frame} rendered twice produced different bytes (${bytesA.length} vs ${bytesB.length}). ` +
              "Scene code is non-deterministic — remove Math.random/Date/network/fs and use Remotion's random(seed).",
          },
        ];
    return makeReport(issues, ["render"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Throwing variant of {@link checkDeterminism} for fail-fast orchestration. */
export async function assertDeterministicFrame(
  spec: LockedVideoSpec,
  opts: DeterminismOptions = {},
): Promise<void> {
  const report = await checkDeterminism(spec, opts);
  if (!report.ok) {
    throw new Error(report.issues.map((issue) => `${issue.check}: ${issue.message}`).join("; "));
  }
}
