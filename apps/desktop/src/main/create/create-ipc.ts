import type {
  StagedImageRef,
  VideoLanguageChoice,
  VoiceProviderChoice,
} from "../../shared/types.js";

export type CreateControllerChoices = {
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
      ...(payload.videoLanguage ? { videoLanguage: payload.videoLanguage } : {}),
      ...(payload.voiceProvider ? { voiceProvider: parseVoiceProvider(payload.voiceProvider) } : {}),
    },
  };
}
