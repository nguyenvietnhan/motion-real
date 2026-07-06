import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { concatAudio, measureAudioDuration, synthesizeMockAudio } from "./index.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("audio ops", () => {
  it("writes measurable mock wav audio", async () => {
    const dir = await mkdtemp(join(tmpdir(), "audio-ops-test-"));
    dirs.push(dir);
    const outputPath = join(dir, "mock.wav");

    const result = await synthesizeMockAudio("A short narration line.", outputPath);

    expect(result.audioPath).toBe(outputPath);
    expect(result.duration).toBeGreaterThanOrEqual(2.5);
    expect((await readFile(outputPath, "utf8")).slice(0, 4)).toBe("RIFF");
    await expect(measureAudioDuration(outputPath)).resolves.toBeCloseTo(result.duration, 1);
  });

  it("rejects empty concat input before invoking ffmpeg", async () => {
    await expect(concatAudio([], "unused.wav")).rejects.toThrow("Cannot concatenate zero audio files.");
  });
});
