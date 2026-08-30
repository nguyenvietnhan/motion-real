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
  /** Home composer spillover marker. */
  source?: "home";
};

type RawCreatePayload = {
  raw: string;
  durationTier?: unknown;
  videoLanguage?: VideoLanguageChoice;
  voiceProvider?: unknown;
  /** Track filename, null for no music, or omit. */
  bgm?: unknown;
  images?: StagedImageRef[];
  source?: unknown;
};

/** Normalize persisted/IPC staging refs before they reach filesystem joins. */
export function normalizeStagedImages(value: unknown): StagedImageRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const image = raw as Partial<StagedImageRef>;
    if (typeof image.ref !== "string" || !/^staging\/[A-Za-z0-9._-]+$/.test(image.ref) || image.ref.includes("..")) return [];
    if (!Number.isFinite(image.width) || !Number.isFinite(image.height) || Number(image.width) <= 0 || Number(image.height) <= 0) return [];
    return [{ ref: image.ref, width: Math.floor(Number(image.width)), height: Math.floor(Number(image.height)) }];
  });
}

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
  if (value === "vivibe" || value === "elevenlabs" || value === "vieneu") return value;
  throw new Error("Nhà cung cấp giọng đọc không hợp lệ.");
}

/** Coerce IPC duration tier; invalid/missing → undefined (controller defaults to tier 2). */
export function parseDurationTier(value: unknown): DurationTierChoice | undefined {
  if (isDurationTier(value)) return value;
  if (value === "1" || value === "2" || value === "3" || value === "4") {
    const n = Number(value);
    return isDurationTier(n) ? n : undefined;
  }
  return undefined;
}

export function createControllerArgsFromIpc(input: unknown): CreateControllerArgs {
  if (!input || typeof input !== "object") throw new Error("Dữ liệu tạo video không hợp lệ.");
  const payload = input as RawCreatePayload;
  if (typeof payload.raw !== "string") throw new Error("Nội dung tạo video không hợp lệ.");
  if (payload.videoLanguage !== undefined && payload.videoLanguage !== "vi" && payload.videoLanguage !== "en") {
    throw new Error("Ngôn ngữ video không hợp lệ.");
  }
  const durationTier = parseDurationTier(payload.durationTier);
  const bgm = parseCreateBgm(payload.bgm);
  const source = payload.source === "home" ? ("home" as const) : undefined;
  return {
    raw: payload.raw,
    images: normalizeStagedImages(payload.images),
    choices: {
      ...(durationTier ? { durationTier } : {}),
      ...(payload.videoLanguage ? { videoLanguage: payload.videoLanguage } : {}),
      ...(payload.voiceProvider ? { voiceProvider: parseVoiceProvider(payload.voiceProvider) } : {}),
      ...(bgm !== undefined ? { bgm } : {}),
    },
    ...(source ? { source } : {}),
  };
}
