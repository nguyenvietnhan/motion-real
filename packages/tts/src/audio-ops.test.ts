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

  it("uses output-scoped sidecars and removes them after concurrent concat work", async () => {
    const dir = await mkdtemp(join(tmpdir(), "audio-ops-concat-"));
    dirs.push(dir);
    const one = join(dir, "one.wav");
    const two = join(dir, "two.wav");
    await synthesizeMockAudio("One.", one);
    await synthesizeMockAudio("Two.", two);
    const firstOutput = join(dir, "first.wav");
    const secondOutput = join(dir, "second.wav");

    await Promise.all([
      concatAudio([one, two], firstOutput),
      concatAudio([two, one], secondOutput),
    ]);

    expect((await readFile(firstOutput)).byteLength).toBeGreaterThan(44);
    expect((await readFile(secondOutput)).byteLength).toBeGreaterThan(44);
    await expect(readFile(`${firstOutput}.concat-list.txt`)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(`${secondOutput}.concat-list.txt`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("removes the concat sidecar when ffmpeg fails or the caller has already aborted", async () => {
    const dir = await mkdtemp(join(tmpdir(), "audio-ops-failure-"));
    dirs.push(dir);
    const failedOutput = join(dir, "failed.wav");

    await expect(concatAudio([join(dir, "missing.wav")], failedOutput)).rejects.toThrow();
    await expect(readFile(`${failedOutput}.concat-list.txt`)).rejects.toMatchObject({ code: "ENOENT" });

    const source = join(dir, "source.wav");
    await synthesizeMockAudio("Abort.", source);
    const abortedOutput = join(dir, "aborted.wav");
    const controller = new AbortController();
    controller.abort();
    await expect(concatAudio([source], abortedOutput, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    await expect(readFile(`${abortedOutput}.concat-list.txt`)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
