import { isDurationTier } from "@motionreal/schema";
import type {
  DurationTierChoice,
  StagedImageRef,
  VideoLanguageChoice,
  VoiceProviderChoice,
} from "../../shared/types.js";

export type CreateControllerChoices = {
  /** Short-form pacing tier (1≈45s, 2≈90s, 3≈150s, 4≈210s). */
  durationTier?: DurationTierChoice;
  videoLanguage?: VideoLanguageChoice;
  voiceProvider?: VoiceProviderChoice;
};

export type CreateControllerArgs = {
  raw: string;
  images: StagedImageRef[];
  choices: CreateControllerChoices;
};

type RawCreatePayload = {
  raw: string;
  durationTier?: unknown;
  videoLanguage?: VideoLanguageChoice;
  voiceProvider?: unknown;
  images?: StagedImageRef[];
};

export function parseVoiceProvider(value: unknown): VoiceProviderChoice {
  if (value === "vivibe" || value === "elevenlabs") return value;
  throw new Error("Nhà cung cấp giọng đọc không hợp lệ.");
}

/** Coerce IPC duration tier; invalid/missing → undefined (controller defaults to 1). */
export function parseDurationTier(value: unknown): DurationTierChoice | undefined {
  if (isDurationTier(value)) return value;
  if (value === "1" || value === "2" || value === "3" || value === "4") {
    const n = Number(value);
    return isDurationTier(n) ? n : undefined;
  }
  return undefined;
}

export function createControllerArgsFromIpc(input: unknown): CreateControllerArgs {
  const payload = input as RawCreatePayload;
  const durationTier = parseDurationTier(payload.durationTier);
  return {
    raw: payload.raw,
    images: payload.images ?? [],
    choices: {
      ...(durationTier ? { durationTier } : {}),
      ...(payload.videoLanguage ? { videoLanguage: payload.videoLanguage } : {}),
      ...(payload.voiceProvider ? { voiceProvider: parseVoiceProvider(payload.voiceProvider) } : {}),
    },
  };
}
