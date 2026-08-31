import {
  GatewayChatError,
  type NineRouterClient,
  type ChatMessage,
  type StructuredOutputFormat,
} from "../gateway/ninerouter-client.js";

type VisionChatLogger = {
  warn: (meta: unknown, message: string) => void;
};

export type VisionChatSessionDeps = {
  client: NineRouterClient;
  apiKey: () => string | undefined;
  logger: VisionChatLogger;
};

/** Flatten any multimodal (vision) message to text-only (drop image parts). */
export function toTextOnlyMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content: Array.isArray(m.content)
      ? m.content.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n")
      : m.content,
  }));
}

/** A 400 that means "this provider can't take the inline image", not a transient blip. */
export function isImageRejection(e: unknown): boolean {
  return e instanceof GatewayChatError && e.kind === "http" && e.status === 400;
}

/**
 * Per-backend-instance session cache for models that rejected inline images.
 * Callers that need full multimodal (e.g. visual-QA) should use the raw client
 * chat path instead of this session.
 */
export class VisionChatSession {
  private readonly imageUnsupportedModels = new Set<string>();

  constructor(private readonly deps: VisionChatSessionDeps) {}

  isImageUnsupported(model: string): boolean {
    return this.imageUnsupportedModels.has(model);
  }

  /**
   * Call the model with vision parts, degrading to text-only safely
   * (vision-capable model hardening). Key behaviors:
   * - if the chosen model already rejected an inline image THIS session, skip
   * vision and send text-only DIRECTLY — never re-trip 9router's ~2-minute
   * circuit breaker (a 400 there fails every following call, even authoring);
   * - on a 400 "improperly formed" from a call that carried an image, remember
   * the model can't take images, then retry text-only;
   * - a non-image failure (or a text-only message) is rethrown unchanged.
   */
  async chatWithVisionFallback(
    model: string,
    messages: ChatMessage[],
    signal?: AbortSignal,
    structured?: StructuredOutputFormat,
  ): Promise<string> {
    const apiKey = this.deps.apiKey();
    const hasImage = messages.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === "image_url"));
    const call = (currentMessages: ChatMessage[]) => structured
      ? this.deps.client.chatStructured(model, currentMessages, structured, { apiKey, ...(signal ? { signal } : {}) })
      : this.deps.client.chat(model, currentMessages, { apiKey, ...(signal ? { signal } : {}) });

    // Known image-incapable model → don't even attempt vision (avoid the breaker).
    if (hasImage && this.imageUnsupportedModels.has(model)) {
      return call(toTextOnlyMessages(messages));
    }
    try {
      return await call(messages);
    } catch (e) {
      if (!hasImage) throw e;
      // The image part is what the provider choked on → remember it so future
      // calls skip vision, then retry this one text-only.
      if (isImageRejection(e)) {
        this.imageUnsupportedModels.add(model);
        this.deps.logger.warn({ model }, "model rejected an inline image (HTTP 400); using text-only for it this session");
      } else {
        this.deps.logger.warn({ err: e }, "vision chat failed; retrying text-only");
      }
      return call(toTextOnlyMessages(messages));
    }
  }
}
