import type { ProjectBrief } from "@motionreal/pipeline";
import { isDurationTier, type DurationTier, type VideoLanguage } from "@motionreal/schema";
import { extractUrls } from "../../shared/create-validation.js";
import type { AuthorInput } from "../agent/agent-worker.js";

function durationTierFromBrief(brief: ProjectBrief): DurationTier | undefined {
  return isDurationTier(brief.durationTier) ? brief.durationTier : undefined;
}

function languageFromBrief(brief: ProjectBrief): VideoLanguage {
  return brief.language === "en" ? "en" : "vi";
}

export function authorInputFromBrief(brief: ProjectBrief): AuthorInput | null {
  const text = brief.prompt?.trim();
  if (!text) return null;
  const durationTier = durationTierFromBrief(brief);
  return {
    text,
    urls: extractUrls(text),
    format: "tiktok",
    ...(durationTier ? { durationTier } : { durationTier: 1 }),
    videoLanguage: languageFromBrief(brief),
  };
}
