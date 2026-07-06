import type { AuthorImageRef } from "../agent/agent-worker.js";
import type { ChatMessage } from "../gateway/ninerouter-client.js";
import { extractJsonObject } from "./manifest-schema.js";
import { buildImageFilterMessages, type AuthorImageInput } from "./prompt.js";

type ImageFilterLogger = {
  warn: (meta: unknown, message: string) => void;
};

export type ImageFilterRunnerArgs = {
  model?: string;
  projectId: string;
  articleText: string;
  refs: readonly AuthorImageRef[];
  signal?: AbortSignal;
  isImageUnsupported: (model: string) => boolean;
  buildAuthorImages: (projectId: string, refs: AuthorImageRef[]) => AuthorImageInput[];
  chat: (model: string, messages: ChatMessage[], signal?: AbortSignal) => Promise<string>;
  logger: ImageFilterLogger;
};

/**
 * Best-effort AI preselection for crawled article images. Any missing model,
 * unreadable image, model vision failure, or malformed reply yields no
 * preselection instead of blocking authoring.
 */
export async function runImageFilter(args: ImageFilterRunnerArgs): Promise<string[]> {
  if (!args.model || args.refs.length === 0) return [];

  // This call is image-ONLY (no meaningful text-only form), so if the model is
  // already known to reject inline images, don't even try; authoring can still
  // proceed without a pre-ticked review selection.
  if (args.isImageUnsupported(args.model)) return [];

  const images = args.buildAuthorImages(args.projectId, [...args.refs]);
  if (images.length === 0) return [];

  const allowed = new Set(images.map((image) => image.ref));
  let reply: string;
  try {
    reply = await args.chat(args.model, buildImageFilterMessages(args.articleText, images), args.signal);
  } catch (error) {
    args.logger.warn({ err: error, projectId: args.projectId }, "[image-filter] vision call failed; no pre-selection");
    return [];
  }

  const json = extractJsonObject(reply);
  if (!json) return [];
  try {
    const keep = (JSON.parse(json) as { keep?: unknown }).keep;
    if (!Array.isArray(keep)) return [];
    return keep.filter((ref): ref is string => typeof ref === "string" && allowed.has(ref));
  } catch (error) {
    args.logger.warn({ err: error, projectId: args.projectId }, "image-filter JSON parse failed; using no preselection");
    return [];
  }
}
