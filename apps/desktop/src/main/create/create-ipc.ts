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
  /** Library BGM track name, or null for explicit silence. */
  bgm?: string | null;
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
  /** Track filename, null for no music, or omit. */
  bgm?: unknown;
  images?: StagedImageRef[];
};

/** Coerce IPC BGM selection: string name, null silence, or undefined omit. */
export function parseCreateBgm(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string") {
    const name = value.trim();
    return name.length > 0 ? name : null;
  }
  return undefined;
}

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
  const bgm = parseCreateBgm(payload.bgm);
  return {
    raw: payload.raw,
    images: payload.images ?? [],
    choices: {
      ...(durationTier ? { durationTier } : {}),
      ...(payload.videoLanguage ? { videoLanguage: payload.videoLanguage } : {}),
      ...(payload.voiceProvider ? { voiceProvider: parseVoiceProvider(payload.voiceProvider) } : {}),
      ...(bgm !== undefined ? { bgm } : {}),
    },
  };
}
