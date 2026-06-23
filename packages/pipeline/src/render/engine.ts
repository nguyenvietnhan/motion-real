import type { VideoFormat } from "@news/schema";
import type { VideoRenderer } from "../types.js";

export type RenderEngineMode = VideoRenderer | "auto";

const VALID_RENDER_ENGINE_MODES = new Set<RenderEngineMode>(["auto", "remotion", "hyperframes"]);

export function normalizeRenderEngineMode(value: string | undefined): RenderEngineMode {
  const normalized = value?.trim().toLowerCase();
  return normalized && VALID_RENDER_ENGINE_MODES.has(normalized as RenderEngineMode)
    ? (normalized as RenderEngineMode)
    : "auto";
}

export function resolveVideoRenderer(format: VideoFormat, mode: RenderEngineMode = envRenderEngineMode()): VideoRenderer {
  if (mode === "remotion" || mode === "hyperframes") return mode;
  return format === "youtube" ? "hyperframes" : "remotion";
}

export function envRenderEngineMode(): RenderEngineMode {
  return normalizeRenderEngineMode(process.env.NEWS_RENDER_ENGINE);
}

