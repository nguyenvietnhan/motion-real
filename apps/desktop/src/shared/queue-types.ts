import type {
  DurationTierChoice,
  StagedImageRef,
  VideoLanguageChoice,
  VoiceProviderChoice,
} from "./types.js";
import type { VoiceProviderFailure } from "@motionreal/pipeline";

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
   * Card title: full user prompt while waiting/running; AI clip title when done.
   */
  displayTitle?: string;
  /** Content-addressed create-time images kept in staging until the job runs. */
  images?: StagedImageRef[];
};

/** Patch allowed only while job is still `queued`. */
export type QueueJobUpdateInput = {
  raw?: string;
  durationTier?: DurationTierChoice;
  videoLanguage?: VideoLanguageChoice;
  voiceProvider?: VoiceProviderChoice;
  bgm?: string | null;
  smoke?: boolean;
  images?: StagedImageRef[];
};

/** Container the user opens in the Queue tab (holds many prompts). */
export type QueueProjectVM = {
  id: string;
  title: string;
  createdAt: string;
  jobs: QueueJobVM[];
  /**
   * Ephemeral Home spillover container (`queue-home`).
   * Auto-deleted after drain when no work/fail remains — not a user project-N.
   */
  ephemeralKind?: "home";
};

export type QueueJobInput = {
  raw: string;
  durationTier: DurationTierChoice;
  videoLanguage: VideoLanguageChoice;
  voiceProvider: VoiceProviderChoice;
  bgm: string | null;
  smoke?: boolean;
  images?: StagedImageRef[];
};

/** Result of queue:start — may schedule behind a running container (queue-of-queues). */
export type QueueStartResult =
  | { ok: true; mode: "started" | "scheduled" | "already_running" | "already_scheduled" }
  | { ok: false; code?: "FULL_AUTO_REQUIRED" | "QUEUE_PAUSED"; error: string };

export type QueuePauseState = {
  kind: "manual" | "voice_provider" | "full_auto_required";
  message: string;
  voiceFailure?: VoiceProviderFailure;
};

/** Process-wide serial runner status; Start intent and pause state are persisted. */
export type QueueRunnerStatus = {
  busy: boolean;
  activeQueueId: string | null;
  /** FIFO of containers waiting after the active one. */
  pendingQueueIds: string[];
  paused?: QueuePauseState;
};
