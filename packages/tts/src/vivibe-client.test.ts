import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VivibeClient } from "./index.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("VivibeClient", () => {
  it("writes base64 provider audio without changing request shape", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vivibe-test-"));
    dirs.push(dir);
    const audio = Buffer.from("x".repeat(80));
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      result: { audioBase64: audio.toString("base64") },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const client = new VivibeClient({
      apiKey: "secret",
      baseUrl: "https://api.test/json-rpc",
      fetch: fetchMock,
      retryAttempts: 1,
      measureDuration: async () => 1.25,
    });

    const result = await client.synthesize({
      text: "Xin chao",
      voiceId: "voice-1",
      speed: 1,
      outputPath: join(dir, "clip"),
    });

    expect(result.audioPath).toBe(join(dir, "clip.mp3"));
    expect(await readFile(result.audioPath)).toEqual(audio);
    expect(result.duration).toBe(1.25);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.test/json-rpc");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json",
      },
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      method: "ttsLongText",
      input: { text: "Xin chao", userVoiceId: "voice-1", speed: 1 },
    });
  });
});
