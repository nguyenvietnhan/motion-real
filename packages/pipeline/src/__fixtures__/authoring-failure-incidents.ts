import type { ProjectBrief } from "../types.js";

export const STALE_TIER3_BRIEF_SHAPE: ProjectBrief = {
  projectId: "incident-stale-tier3",
  prompt: "Create a tier 3 TikTok explainer",
  duration: 60,
  format: "tiktok",
  durationTier: 3,
  ratio: "9:16",
  language: "vi",
  aiProvider: "mock",
  tts: {
    provider: "mock",
    speed: 1,
  },
  state: "scaffolded",
  currentStep: "scaffolded",
  error: null,
  createdAt: "2026-07-05T00:00:00.000Z",
  updatedAt: "2026-07-05T00:00:00.000Z",
};
