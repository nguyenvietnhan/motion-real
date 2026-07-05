import type { ProjectBrief } from "@motionreal/pipeline";
import type { DurationTier, VideoFormat, VideoLanguage } from "@motionreal/schema";
import { extractUrls } from "../../shared/create-validation.js";
import type { AuthorInput } from "../agent/agent-worker.js";

function formatFromBrief(brief: ProjectBrief): VideoFormat | undefined {
  if (brief.format === "tiktok" || brief.format === "youtube") return brief.format;
  return brief.ratio === "16:9" ? "youtube" : undefined;
}

function durationTierFromBrief(brief: ProjectBrief): DurationTier | undefined {
  return brief.durationTier === 1 || brief.durationTier === 2 || brief.durationTier === 3
    ? brief.durationTier
    : undefined;
}

function languageFromBrief(brief: ProjectBrief): VideoLanguage {
  return brief.language === "en" ? "en" : "vi";
}

export function authorInputFromBrief(brief: ProjectBrief): AuthorInput | null {
  const text = brief.prompt?.trim();
  if (!text) return null;
  const format = formatFromBrief(brief);
  const durationTier = durationTierFromBrief(brief);
  return {
    text,
    urls: extractUrls(text),
    ...(format ? { format } : {}),
    ...(durationTier ? { durationTier } : {}),
    videoLanguage: languageFromBrief(brief),
  };
}
