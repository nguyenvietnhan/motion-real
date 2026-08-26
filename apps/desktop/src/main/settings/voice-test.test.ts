import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { VoiceProviderError, type TtsClient } from "@motionreal/pipeline";
import { createVoiceTester } from "./voice-test.js";

const roots: string[] = [];
const config = { provider: "vivibe" as const, apiKey: "key", voiceId: "voice", speed: 1 };

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "voice-test-"));
  roots.push(value);
  return value;
}

function client(synthesize: TtsClient["synthesize"]): TtsClient {
  return {
    provider: "vivibe",
    isConfigured: () => true,
    listVoices: async () => [],
    synthesize,
  };
}

describe("createVoiceTester", () => {
  it("returns a bounded audio data URL and removes its temp directory", async () => {
    const base = await root();
    const testVoice = createVoiceTester({
      rootDir: base,
      id: () => "ok",
      createClient: () => client(async (input) => {
        const audioPath = `${input.outputPath}.mp3`;
        await writeFile(audioPath, Buffer.from("sample"));
        return { audioPath, duration: 0.2, raw: null };
      }),
    });

    await expect(testVoice(config)).resolves.toEqual({
      ok: true,
      audioDataUrl: `data:audio/mpeg;base64,${Buffer.from("sample").toString("base64")}`,
    });
    expect(await readdir(base)).toEqual([]);
  });

  it("returns a safe structured provider failure and cleans up", async () => {
    const base = await root();
    const testVoice = createVoiceTester({
      rootDir: base,
      createClient: () => client(async () => {
        throw new VoiceProviderError({ provider: "vivibe", code: "insufficient_credits", retryable: false });
      }),
    });
    const result = await testVoice(config);
    expect(result).toMatchObject({
      ok: false,
      voiceFailure: { provider: "vivibe", code: "insufficient_credits" },
    });
    if (!result.ok) expect(result.error).toMatch(/hết credit/i);
    expect(await readdir(base)).toEqual([]);
  });

  it("rejects an oversized sample and prevents overlapping tests", async () => {
    const base = await root();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const testVoice = createVoiceTester({
      rootDir: base,
      id: () => "large",
      createClient: () => client(async (input) => {
        await gate;
        const audioPath = `${input.outputPath}.mp3`;
        await writeFile(audioPath, Buffer.alloc(1024 * 1024 + 1));
        return { audioPath, duration: 0.2, raw: null };
      }),
    });

    const first = testVoice(config);
    const overlapping = await testVoice(config);
    expect(overlapping).toMatchObject({ ok: false, error: expect.stringMatching(/Đang kiểm tra/) });
    release();
    await expect(first).resolves.toMatchObject({ ok: false, voiceFailure: { code: "unknown" } });
    expect(await readdir(base)).toEqual([]);
  });
});
