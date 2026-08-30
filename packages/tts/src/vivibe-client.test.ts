import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VivibeClient, VoiceProviderError } from "./index.js";

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

  it("classifies nested JSON-RPC insufficient credits", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      error: {
        code: "INTERNAL_ERROR",
        message: "Bạn đã hết credit, cần mua gói để tiếp tục sử dụng.",
        data: { code: "insufficient_credits", required: 195, available: -6650 },
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const client = new VivibeClient({ apiKey: "secret", fetch: fetchMock, retryAttempts: 1 });
    const error = await client.synthesize({ text: "x", voiceId: "v", speed: 1, outputPath: "unused" })
      .catch((value: unknown) => value);

    expect(error).toBeInstanceOf(VoiceProviderError);
    expect((error as VoiceProviderError).failure).toMatchObject({
      provider: "vivibe",
      code: "insufficient_credits",
      retryable: false,
    });
    expect((error as Error).message).not.toContain("-6650");
  });

  it("does not retry a billable ttsLongText POST", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("busy", { status: 503 }));
    const client = new VivibeClient({ apiKey: "secret", fetch: fetchMock, retryAttempts: 3, retryBaseDelayMs: 0 });

    await expect(client.synthesize({ text: "x", voiceId: "v", speed: 1, outputPath: "unused" })).rejects.toBeInstanceOf(VoiceProviderError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not start a provider request after cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn<typeof fetch>();
    const client = new VivibeClient({ apiKey: "secret", fetch: fetchMock, retryAttempts: 1 });

    await expect(client.synthesize(
      { text: "x", voiceId: "v", speed: 1, outputPath: "unused" },
      { signal: controller.signal },
    )).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("classifies HTTP auth, rate limit and outage without leaking response details", async () => {
    for (const [status, code] of [[401, "invalid_api_key"], [429, "rate_limited"], [503, "provider_unavailable"]] as const) {
      const client = new VivibeClient({
        apiKey: "secret",
        retryAttempts: 1,
        fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ message: `secret-${status}` }), {
          status,
          headers: { "content-type": "application/json", ...(status === 429 ? { "retry-after": "2" } : {}) },
        })),
      });
      const error = await client.synthesize({ text: "x", voiceId: "v", speed: 1, outputPath: "unused" })
        .catch((value: unknown) => value) as VoiceProviderError;
      expect(error.failure.code).toBe(code);
      if (status === 429) expect(error.failure.retryAfterMs).toBe(2000);
      expect(error.message).not.toContain(`secret-${status}`);
    }
  });
});
