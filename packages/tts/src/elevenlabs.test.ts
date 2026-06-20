import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ELEVENLABS_DEFAULT_MODEL_ID,
  ELEVENLABS_OUTPUT_FORMAT,
  ElevenLabsClient,
  alignmentToSrt,
  ttsCacheKey,
} from "./index.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("ElevenLabsClient", () => {
  it("lists every voice page with the provider API key", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        voices: [{ voice_id: "v1", name: "An", preview_url: "https://audio.test/an.mp3" }],
        has_more: true,
        next_page_token: "next",
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        voices: [{ voice_id: "v2", name: "Binh" }],
        has_more: false,
      }), { status: 200, headers: { "content-type": "application/json" } }));
    const client = new ElevenLabsClient({ apiKey: "secret", baseUrl: "https://api.test", fetch: fetchMock });

    await expect(client.listVoices()).resolves.toEqual([
      { id: "v1", name: "An", isActive: true, previewUrl: "https://audio.test/an.mp3" },
      { id: "v2", name: "Binh", isActive: true },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]![0])).toContain("next_page_token=next");
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ headers: { "xi-api-key": "secret" } });
  });

  it("writes timestamped audio and a word-timed SRT without retrying synthesis", async () => {
    const dir = await mkdtemp(join(tmpdir(), "elevenlabs-test-"));
    dirs.push(dir);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      audio_base64: Buffer.from("fake-mp3").toString("base64"),
      alignment: {
        characters: ["X", "i", "n", " ", "c", "h", "a", "o"],
        character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7],
        character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const client = new ElevenLabsClient({
      apiKey: "secret",
      baseUrl: "https://api.test",
      fetch: fetchMock,
      measureDuration: async () => 0.8,
    });

    const result = await client.synthesize({ text: "Xin chao", voiceId: "voice/1", speed: 1, outputPath: join(dir, "clip") });

    expect(result.audioPath).toBe(join(dir, "clip.mp3"));
    expect(await readFile(result.audioPath, "utf8")).toBe("fake-mp3");
    expect(await readFile(result.srtPath!, "utf8")).toContain("00:00:00,400 --> 00:00:00,800\nchao");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain(`/voice%2F1/with-timestamps?output_format=${ELEVENLABS_OUTPUT_FORMAT}`);
    expect(init).toMatchObject({ method: "POST", headers: { "xi-api-key": "secret" } });
    expect(JSON.parse(String(init?.body))).toEqual({
      text: "Xin chao",
      model_id: ELEVENLABS_DEFAULT_MODEL_ID,
      language_code: "vi",
    });
  });

  it.each([401, 403, 422, 429])("surfaces HTTP %s without retrying", async (status) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ detail: `failure-${status}` }),
      { status, headers: { "content-type": "application/json" } },
    ));
    const client = new ElevenLabsClient({ apiKey: "secret", fetch: fetchMock });
    await expect(client.synthesize({ text: "x", voiceId: "v", speed: 1, outputPath: "unused" }))
      .rejects.toThrow(`ElevenLabs synthesize speech failed (${status})`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("TTS provider identity", () => {
  it("keeps cache entries distinct across providers and models", () => {
    const base = { text: "xin chao", voiceId: "same", speed: 1 };
    const vivibe = ttsCacheKey({ ...base, provider: "vivibe" });
    const eleven = ttsCacheKey({ ...base, provider: "elevenlabs", modelId: "m1" });
    const otherModel = ttsCacheKey({ ...base, provider: "elevenlabs", modelId: "m2" });
    expect(new Set([vivibe, eleven, otherModel]).size).toBe(3);
  });

  it("groups character alignment into SRT words", () => {
    expect(alignmentToSrt({
      characters: ["A", " ", "B"],
      character_start_times_seconds: [0, 0.1, 0.2],
      character_end_times_seconds: [0.1, 0.2, 0.4],
    })).toContain("00:00:00,200 --> 00:00:00,400\nB");
  });
});
