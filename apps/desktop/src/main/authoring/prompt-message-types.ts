/** A text part or an inline image (data URL) — OpenAI multimodal content shape. */
export type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

/** Plain author message (text-only content) — compatible with the gateway today. */
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** Reauthor message: content may carry image parts (vision-guided repair). */
export type VisionMessage = { role: "system" | "user" | "assistant"; content: string | ContentPart[] };
