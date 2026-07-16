import type {
  DurationTierChoice,
  VideoLanguageChoice,
  VoiceProviderChoice,
} from "./types.js";

/** One queued video brief inside a queue container (not yet / not only a video project). */
export type QueueJobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export type QueueJobVM = {
  id: string;
  raw: string;
  durationTier: DurationTierChoice;
  videoLanguage: VideoLanguageChoice;
  voiceProvider: VoiceProviderChoice;
  /** Library track name, or null for no music. */
  bgm: string | null;
  status: QueueJobStatus;
  createdAt: string;
  /** Filled when this job is turned into a real video project. */
  projectId?: string;
  error?: string;
  /** Silent ~10s test job (TTS none); only runs after queue Start. */
  smoke?: boolean;
  /**
   * Card title: prompt slice while waiting; updated to manifest/AI title when done.
   */
  displayTitle?: string;
};

/** Patch allowed only while job is still `queued`. */
export type QueueJobUpdateInput = {
  raw?: string;
  durationTier?: DurationTierChoice;
  videoLanguage?: VideoLanguageChoice;
  voiceProvider?: VoiceProviderChoice;
  bgm?: string | null;
  smoke?: boolean;
};

/** Container the user opens in the Queue tab (holds many prompts). */
export type QueueProjectVM = {
  id: string;
  title: string;
  createdAt: string;
  jobs: QueueJobVM[];
};

export type QueueJobInput = {
  raw: string;
  durationTier: DurationTierChoice;
  videoLanguage: VideoLanguageChoice;
  voiceProvider: VoiceProviderChoice;
  bgm: string | null;
  smoke?: boolean;
};
