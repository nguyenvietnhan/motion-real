import type {
  DurationTierChoice,
  StagedImageRef,
  VideoFormatChoice,
  VideoLanguageChoice,
  VoiceProviderChoice,
} from "../../shared/types.js";

export type CreateControllerChoices = {
  format?: VideoFormatChoice;
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
  format?: VideoFormatChoice;
  durationTier?: DurationTierChoice;
  videoLanguage?: VideoLanguageChoice;
  voiceProvider?: unknown;
  images?: StagedImageRef[];
};

export function parseVoiceProvider(value: unknown): VoiceProviderChoice {
  if (value === "vivibe" || value === "elevenlabs") return value;
  throw new Error("Nhà cung cấp giọng đọc không hợp lệ.");
}

export function createControllerArgsFromIpc(input: unknown): CreateControllerArgs {
  const payload = input as RawCreatePayload;
  return {
    raw: payload.raw,
    images: payload.images ?? [],
    choices: {
      ...(payload.format ? { format: payload.format } : {}),
      ...(payload.durationTier ? { durationTier: payload.durationTier } : {}),
      ...(payload.videoLanguage ? { videoLanguage: payload.videoLanguage } : {}),
      ...(payload.voiceProvider ? { voiceProvider: parseVoiceProvider(payload.voiceProvider) } : {}),
    },
  };
}
