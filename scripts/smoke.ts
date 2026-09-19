/**
 * Real-render smoke test. The offline test suite mocks `@remotion/renderer`, so
 * no ordinary unit test exercises the real Chromium render path; a Remotion/Chromium
 * upgrade or a regression in the shipped `@motionreal/blocks` / neutral theme would slip
 * through green CI and only surface when a user renders. This script closes that
 * gap with a fast, portable, no-voice render of the bundled sample fixture.
 *
 * It deliberately avoids a committed golden-HASH baseline: byte-identical frames
 * are only stable on the SAME machine/Chromium (font hinting + antialiasing vary
 * across OS/version), so a checked-in hash would false-fail on every other box.
 * Instead it asserts properties that ARE portable:
 *
 *   1. The sample renders to one PNG per scene with the neutral runtime theme,
 *      at the right canvas size and not blank.
 *   2. The real N14 safe-area oracles pass on those real stills (0 hard errors) —
 *      catching a layout regression in blocks/theme runtime that the in-memory
 *      oracle self-tests can't (they use synthetic frames, not a real render).
 *   3. A draft MP4 has the expected duration, usable size, and both audio/video
 *      streams, proving the actual export path works.
 *   4. Determinism (N16) holds end-to-end: the SAME frame rendered twice is
 *      byte-identical (the one "golden" comparison that IS portable — it compares
 *      a render against itself on this machine, not against a committed baseline).
 *
 * Exits non-zero on the first failure so it can gate a manual pre-release check.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { LockedVideoSpec } from "@motionreal/schema";
import { sampleSpec } from "../apps/remotion/src/fixtures/sample-spec.js";
import {
  renderSceneStills,
  renderVideo,
  checkDeterminism,
  clipLockedSpecToSeconds,
  runRenderGrid,
  decodePng,
} from "../packages/pipeline/src/index.js";
import { synthesizeMockAudio } from "../packages/tts/src/audio-ops.js";

const SMOKE_SCENARIO = "neutral";
const require = createRequire(import.meta.url);
const ffprobePath = (require("ffprobe-static") as { path: string }).path;
const execFileAsync = promisify(execFile);

/** Apply a stable dominant color without mutating the shared fixture. */
function smokeSpec(): LockedVideoSpec {
  return { ...sampleSpec, theme: { ...sampleSpec.theme, dominant: sampleSpec.theme?.dominant ?? "#5B8CFF" } };
}

/** True when a decoded frame has meaningful non-uniform content (not a blank fill). */
function hasContent(data: Uint8Array): boolean {
  // Sample the first pixel as the reference; if ANY sampled pixel differs from it
  // beyond a small threshold, the frame carries real content (text/blocks), not a
  // flat background. Step coarsely — we only need "not blank", not a pixel census.
  const r0 = data[0]!;
  const g0 = data[1]!;
  const b0 = data[2]!;
  for (let i = 0; i < data.length; i += 4 * 997) {
    if (Math.abs(data[i]! - r0) + Math.abs(data[i + 1]! - g0) + Math.abs(data[i + 2]! - b0) > 24) return true;
  }
  return false;
}

type Failure = { scenario: string; message: string };

async function smokeSample(failures: Failure[]): Promise<void> {
  const spec = clipLockedSpecToSeconds(smokeSpec(), 10);
  const artifactRoot = process.env.MOTIONREAL_SMOKE_ARTIFACT_DIR;
  const dir = artifactRoot
    ? join(artifactRoot, SMOKE_SCENARIO)
    : await mkdtemp(join(tmpdir(), `motionreal-smoke-${SMOKE_SCENARIO}-`));
  if (artifactRoot) await rm(dir, { recursive: true, force: true });
  const fail = (message: string) => failures.push({ scenario: SMOKE_SCENARIO, message });
  try {
    // (1) Render one still per scene through the REAL Chromium path.
    const stills = await renderSceneStills(spec, dir, { logLevel: "error" });
    if (stills.length !== spec.scenes.length) {
      fail(`expected ${spec.scenes.length} stills, got ${stills.length}`);
    }
    for (const path of stills) {
      const frame = decodePng(await readFile(path));
      if (frame.width !== 1080 || frame.height !== 1920) {
        fail(`still ${path} is ${frame.width}×${frame.height}, expected 1080×1920`);
      } else if (!hasContent(frame.data)) {
        fail(`still ${path} is blank (no non-background content)`);
      }
    }

    // (2) Real N14 safe-area oracles over the real stills: zero hard errors.
    const grid = await runRenderGrid(spec, { framesDir: dir });
    const hardErrors = grid.issues.filter((i) => i.severity === "error");
    if (hardErrors.length > 0) {
      const n14 = hardErrors.map((i) => `${i.check} ${i.sceneId ?? ""}: ${i.message}`);
      fail(`${hardErrors.length} hard render-grid error(s):\n      - ${n14.join("\n      - ")}`);
    }

    // (3) Produce a real short-form MP4 with a local WAV. It exercises the
    // actual encode/mux path without a paid TTS dependency.
    const audioPath = join(dir, "audio", "smoke.wav");
    await synthesizeMockAudio("MotionReal render smoke audio.", audioPath);
    const videoPath = join(dir, "smoke.mp4");
    const rendered = await renderVideo({
      spec: { ...spec, audio: { ...spec.audio, narrationSrc: "audio/smoke.wav" } },
      projectRoot: dir,
      outPath: videoPath,
      quality: "draft",
      concurrency: 1,
      logLevel: "error",
    });
    await assertPlayableVideo(videoPath, rendered.durationInFrames / rendered.fps, fail);

    // (4) Determinism (N16): the sampled frame rendered twice is byte-identical.
    const det = await checkDeterminism(spec, { logLevel: "error" });
    if (!det.ok) fail(`determinism (N16) failed: ${det.issues.map((i) => i.message).join("; ")}`);
  } catch (error) {
    fail(`render threw: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (!artifactRoot) await rm(dir, { recursive: true, force: true });
  }
}

async function assertPlayableVideo(videoPath: string, expectedSeconds: number, fail: (message: string) => void): Promise<void> {
  const size = (await stat(videoPath)).size;
  if (size < 8 * 1024) fail(`video ${videoPath} is unexpectedly small (${size} bytes)`);
  const { stdout } = await execFileAsync(ffprobePath, [
    "-v", "error",
    "-show_entries", "format=duration:stream=codec_type",
    "-of", "json",
    videoPath,
  ]);
  const probe = JSON.parse(stdout) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string }> };
  const duration = Number(probe.format?.duration);
  if (!Number.isFinite(duration) || Math.abs(duration - expectedSeconds) > 1) {
    fail(`video duration ${probe.format?.duration ?? "missing"}s does not match ${expectedSeconds.toFixed(2)}s`);
  }
  const streams = new Set(probe.streams?.map((stream) => stream.codec_type));
  if (!streams.has("video")) fail("video artifact has no video stream");
  if (!streams.has("audio")) fail("video artifact has no audio stream");
}

async function main(): Promise<void> {
  console.log("[smoke] real-render smoke test — sample fixture, MP4 mux, neutral theme (needs Chromium)…");
  const failures: Failure[] = [];
  console.log(`[smoke]   rendering scenario "${SMOKE_SCENARIO}"…`);
  await smokeSample(failures);
  console.log(`[smoke]   ${SMOKE_SCENARIO}: ${failures.length === 0 ? "OK" : `${failures.length} failure(s)`}`);

  if (failures.length > 0) {
    console.error("\n[smoke] FAILED");
    for (const f of failures) console.error(`  [${f.scenario}] ${f.message}`);
    process.exitCode = 1;
    return;
  }
  console.log("\n[smoke] OK — neutral sample renders, N14 clean, determinism holds.");
}

main().catch((error: unknown) => {
  console.error("[smoke] FAILED (unexpected)");
  console.error(error);
  process.exitCode = 1;
});
