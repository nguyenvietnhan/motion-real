import { describe, expect, it, vi } from "vitest";
import { GatewayChatError, type ChatMessage, type NineRouterClient } from "../gateway/ninerouter-client.js";
import { isImageRejection, toTextOnlyMessages, VisionChatSession } from "./authoring-vision-chat.js";

const imageMsg: ChatMessage = {
  role: "user",
  content: [
    { type: "text", text: "hi" },
    { type: "image_url", image_url: { url: "data:image/png;base64,xx" } },
  ],
};

const textMsg: ChatMessage = { role: "user", content: "hi" };

describe("toTextOnlyMessages", () => {
  it("drops image parts", () => {
    expect(toTextOnlyMessages([imageMsg])).toEqual([{ role: "user", content: "hi" }]);
  });
});

describe("isImageRejection", () => {
  it("detects HTTP 400 gateway errors", () => {
    expect(isImageRejection(new GatewayChatError("http", "bad", { status: 400 }))).toBe(true);
    expect(isImageRejection(new GatewayChatError("http", "bad", { status: 500 }))).toBe(false);
    expect(isImageRejection(new Error("x"))).toBe(false);
  });
});

describe("VisionChatSession", () => {
  it("on 400 image rejection marks model unsupported and retries text-only", async () => {
    const chat = vi.fn(async (_model: string, messages: ChatMessage[]) => {
      const hasImage = messages.some(
        (m) => Array.isArray(m.content) && m.content.some((p) => p.type === "image_url"),
      );
      if (hasImage) throw new GatewayChatError("http", "HTTP 400", { status: 400 });
      return "ok-text";
    });
    const logger = { warn: vi.fn() };
    const session = new VisionChatSession({
      client: { chat } as unknown as NineRouterClient,
      apiKey: () => "k",
      logger,
    });

    await expect(session.chatWithVisionFallback("m1", [imageMsg])).resolves.toBe("ok-text");
    expect(session.isImageUnsupported("m1")).toBe(true);
    expect(chat).toHaveBeenCalledTimes(2);

    chat.mockClear();
    chat.mockResolvedValue("direct-text");
    await expect(session.chatWithVisionFallback("m1", [imageMsg])).resolves.toBe("direct-text");
    expect(chat).toHaveBeenCalledOnce();
    const secondMsgs = chat.mock.calls[0]![1] as ChatMessage[];
    expect(secondMsgs[0]!.content).toBe("hi");
  });

  it("rethrows non-image failures when messages have no image parts", async () => {
    const chat = vi.fn(async () => {
      throw new GatewayChatError("timeout", "slow");
    });
    const session = new VisionChatSession({
      client: { chat } as unknown as NineRouterClient,
      apiKey: () => undefined,
      logger: { warn: vi.fn() },
    });
    await expect(session.chatWithVisionFallback("m1", [textMsg])).rejects.toBeInstanceOf(GatewayChatError);
    expect(chat).toHaveBeenCalledOnce();
  });

  it("retries text-only on non-400 vision failure without marking unsupported", async () => {
    const chat = vi.fn(async (_model: string, messages: ChatMessage[]) => {
      const hasImage = messages.some(
        (m) => Array.isArray(m.content) && m.content.some((p) => p.type === "image_url"),
      );
      if (hasImage) throw new Error("blip");
      return "recovered";
    });
    const session = new VisionChatSession({
      client: { chat } as unknown as NineRouterClient,
      apiKey: () => undefined,
      logger: { warn: vi.fn() },
    });
    await expect(session.chatWithVisionFallback("m1", [imageMsg])).resolves.toBe("recovered");
    expect(session.isImageUnsupported("m1")).toBe(false);
  });
});
