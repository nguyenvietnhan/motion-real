import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { spawn } from "node:child_process";
import type { TTSResult } from "./types.js";

const require = createRequire(import.meta.url);
const ffprobeStatic = require("ffprobe-static") as { path: string };
const ffmpegStatic = require("ffmpeg-static") as string | null;

/** Measure audio duration via ffprobe (already on the dep graph for mix). */
export async function measureAudioDuration(audioPath: string): Promise<number> {
  const ffprobePath = ffprobeStatic.path;
  const output = await runProcess(ffprobePath, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=nw=1:nk=1",
    audioPath,
  ]);
  const duration = Number(output.trim());
  if (!Number.isFinite(duration)) {
    throw new Error(`Unable to measure duration for ${basename(audioPath)}.`);
  }
  return duration;
}

export async function synthesizeMockAudio(text: string, outputPath: string): Promise<TTSResult> {
  await mkdir(dirname(outputPath), { recursive: true });
  const seconds = Math.max(2.5, Math.min(12, text.length / 18));
  const wav = createSilentWav(seconds);
  await writeFile(outputPath, wav);
  return { audioPath: outputPath, duration: seconds, raw: { provider: "mock", seconds } };
}

export async function concatAudio(inputs: string[], outputPath: string): Promise<void> {
  if (!inputs.length) {
    throw new Error("Cannot concatenate zero audio files.");
  }
  await mkdir(dirname(outputPath), { recursive: true });
  const listPath = join(dirname(outputPath), "concat-list.txt");
  await writeFile(listPath, inputs.map((input) => `file '${input.replace(/'/g, "'\\''")}'`).join("\n"));
  await runProcess(ffmpegStatic ?? "ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outputPath]);
}

/**
 * Concatenate narration clips with a SILENT BREATH GAP between consecutive
 * clips. Re-encodes through a filtergraph so the inserted
 * `anullsrc` silence and the (possibly mixed-codec) clips share one sample
 * format. The total length is `Σ clip_i + (n−1)·gap`, which the lock mirrors so
 * each transition overlap lands on a gap. `gapSeconds <= 0` or a single clip
 * falls back to a plain re-encode/concat.
 */
export async function concatAudioWithGaps(
  inputs: string[],
  gapSeconds: number,
  outputPath: string,
): Promise<void> {
  if (!inputs.length) {
    throw new Error("Cannot concatenate zero audio files.");
  }
  await mkdir(dirname(outputPath), { recursive: true });
  if (inputs.length === 1 || gapSeconds <= 0) {
    await concatAudio(inputs, outputPath);
    return;
  }

  const sr = 48000;
  const args: string[] = ["-y"];
  for (const input of inputs) args.push("-i", input);
  const gapCount = inputs.length - 1;
  for (let i = 0; i < gapCount; i += 1) {
    args.push("-f", "lavfi", "-t", gapSeconds.toFixed(4), "-i", `anullsrc=channel_layout=stereo:sample_rate=${sr}`);
  }

  const norm = (label: string, out: string) =>
    `[${label}]aresample=${sr},aformat=sample_fmts=fltp:channel_layouts=stereo[${out}]`;
  const parts: string[] = [];
  const order: string[] = [];
  inputs.forEach((_, i) => {
    parts.push(norm(`${i}:a`, `c${i}`));
    order.push(`[c${i}]`);
    if (i < gapCount) {
      const silenceIdx = inputs.length + i;
      parts.push(norm(`${silenceIdx}:a`, `g${i}`));
      order.push(`[g${i}]`);
    }
  });
  const filter = `${parts.join(";")};${order.join("")}concat=n=${order.length}:v=0:a=1[outa]`;

  await runProcess(ffmpegStatic ?? "ffmpeg", [
    ...args,
    "-filter_complex",
    filter,
    "-map",
    "[outa]",
    "-ar",
    String(sr),
    "-ac",
    "2",
    outputPath,
  ]);
}

export async function mixBgm(
  voicePath: string,
  bgmPath: string,
  outputPath: string,
  volume = 0.28,
  fadeDurationSeconds = 3.0,
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  const voiceDuration = await measureAudioDuration(voicePath);
  const bgmFadeStart = Math.max(0, voiceDuration - fadeDurationSeconds);

  const filterComplex =
    `[0:a]volume=1.0[voice];` +
    `[1:a]volume=${volume.toFixed(4)},afade=t=out:st=${bgmFadeStart.toFixed(4)}:d=${fadeDurationSeconds.toFixed(4)}[bgm];` +
    `[voice][bgm]amix=inputs=2:duration=first:dropout_transition=3[outa]`;

  await runProcess(ffmpegStatic ?? "ffmpeg", [
    "-y",
    "-i",
    voicePath,
    "-stream_loop",
    "-1",
    "-i",
    bgmPath,
    "-filter_complex",
    filterComplex,
    "-map",
    "[outa]",
    "-t",
    String(voiceDuration),
    "-ar",
    "48000",
    "-ac",
    "2",
    outputPath,
  ]);
}

function runProcess(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} exited ${code}: ${stderr}`));
    });
  });
}

function createSilentWav(durationSeconds: number): Buffer {
  const sampleRate = 48_000;
  const channels = 1;
  const bitsPerSample = 16;
  const samples = Math.ceil(durationSeconds * sampleRate);
  const dataSize = samples * channels * (bitsPerSample / 8);
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
  buffer.writeUInt16LE(channels * (bitsPerSample / 8), 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}
