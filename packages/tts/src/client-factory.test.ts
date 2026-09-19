import { describe, expect, it, vi } from "vitest";
import { createTtsClient } from "./client-factory.js";

describe("TTS client factory", () => {
  it("requires an explicit guarded transport for cloud providers", () => {
    expect(() => createTtsClient("vivibe", "secret")).toThrow(/guarded HTTP transport/i);
    expect(() => createTtsClient("elevenlabs", "secret")).toThrow(/guarded HTTP transport/i);
  });

  it("passes the selected transport through without falling back to global fetch", async () => {
    const apiFetch = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ result: { items: [] } }));
    const client = createTtsClient("vivibe", "secret", {
      apiFetch,
      audioFetch: vi.fn<typeof fetch>(),
      textFetch: vi.fn<typeof fetch>(),
    });

    await expect(client.listVoices()).resolves.toEqual([]);
    expect(apiFetch).toHaveBeenCalledOnce();
  });
});
