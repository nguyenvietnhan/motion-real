import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import {
  ELEVENLABS_DEFAULT_MODEL_ID,
  ELEVENLABS_OUTPUT_FORMAT,
  TTS_NORMALIZER_VERSION,
  ElevenLabsClient,
  VivibeClient,
  concatAudioWithGaps,
  defaultVivibeVoiceId,
  defaultElevenLabsVoiceId,
  elevenLabsApiKey,
  measureAudioDuration,
  mixBgm,
  synthesizeMockAudio,
  ttsCacheKey,
  vivibeApiKey,
  type TtsClient,
} from "@news/tts";
import { BREATH_GAP_SECONDS, DEFAULT_TTS_SPEED, type VideoSpec } from "@news/schema";
import type { TtsManifest, TtsManifestScene, TtsProvider } from "../types.js";
import { projectPaths, ttsCacheDir } from "../store/store.js";
import { parseSrt, type SrtSegment } from "./captions.js";
import { normalizeVietnameseNumbers } from "./vi-number.js";

/**
 * TTS synthesis + audio assembly (design B.5). Per-scene narration is
 * synthesized via @news/tts (Vivibe), cached by text+voiceId+speed, measured,
 * concatenated into one track, and optionally BGM-mixed. Locked timing is then
 * derived from the MEASURED durations (see lock.ts).
 *
 * Provider contract (preserved from news_video_tool / math_video_tool):
 *  - "vivibe": real voice; STOP AND REPORT if key/voice missing — never silently
 *    downgrade to mock.
 *  - "mock": offline silent clips sized from text length (for smoke/visual draft).
 *  - "none": no audio at all (visual-draft path); returns null.
 */

export type SynthesizeOptions = {
  projectId: string;
  provider: TtsProvider;
  /** Explicit in-memory credential. Desktop passes this after scrubbing process.env. */
  apiKey?: string;
  voiceId?: string;
  modelId?: string;
  speed?: number;
  /** absolute path to a BGM file to mix under the narration, if any */
  bgmPath?: string;
  /** BGM gain relative to the voice (0–1); defaults to DEFAULT_BGM_VOLUME (~20%). */
  bgmVolume?: number;
};

export type VivibeCredentials = { apiKey: string; voiceId: string | undefined };
export type ElevenLabsCredentials = VivibeCredentials & { modelId: string };

/** Resolve explicit credentials first; environment remains a CLI-only fallback. */
export function resolveVivibeCredentials(
  opts: Pick<SynthesizeOptions, "apiKey" | "voiceId">,
  fallback: VivibeCredentials = { apiKey: vivibeApiKey(), voiceId: defaultVivibeVoiceId() },
): VivibeCredentials {
  return {
    apiKey: opts.apiKey?.trim() || fallback.apiKey,
    voiceId: opts.voiceId?.trim() || fallback.voiceId,
  };
}

export function resolveElevenLabsCredentials(
  opts: Pick<SynthesizeOptions, "apiKey" | "voiceId" | "modelId">,
  fallback: ElevenLabsCredentials = {
    apiKey: elevenLabsApiKey(),
    voiceId: defaultElevenLabsVoiceId(),
    modelId: ELEVENLABS_DEFAULT_MODEL_ID,
  },
): ElevenLabsCredentials {
  return {
    apiKey: opts.apiKey?.trim() || fallback.apiKey,
    voiceId: opts.voiceId?.trim() || fallback.voiceId,
    modelId: opts.modelId?.trim() || fallback.modelId,
  };
}

/** Default background-music gain under the narration (~20% of the voice). */
export const DEFAULT_BGM_VOLUME = 0.2;

const VIVIBE_TTS_DICTIONARY: Array<[RegExp, string]> = [
  // Prepare common English brand/tech terms for natural Vietnamese pronunciation.
  // Display text keeps the original English; only the spoken text is adapted.
  [/\bGoogle\b/gi, "Gút-gồ"],
  [/\bYouTube\b/gi, "Diu-túp"],
  [/\bGemini\b/gi, "Giê-mi-nai"],
  [/\bDeepSeek\b/gi, "Đíp-xích"],
  [/\bOpenAI\b/gi, "Ô-pừn Ây-Ai"],
  [/\bChatGPT\b/gi, "Chát-Gi-Pi-Ti"],
  [/\bClaude\b/gi, "Cờ-lốt"],
  [/\bAnthropic\b/gi, "An-thrô-pic"],
  [/\bLLM\b/g, "Eo-Eo-Em"],
  [/\bGPT\b/g, "Gi-Pi-Ti"],
  [/\bAPI\b/g, "Ây-Pi-Ai"],
  [/\bGPU\b/g, "Gi-Pi-Diu"],
  [/\bAI\b/g, "Ây-Ai"],
];

export function prepareTtsText(text: string, provider: TtsProvider, language: VideoSpec["language"]): string {
  // Vietnamese narration gets deterministic number reading and Vivibe-specific
  // pronunciation preparation. English must remain untouched so digits/words are
  // interpreted by the multilingual provider in English.
  let out = language === "vi" ? normalizeVietnameseNumbers(text.trim()) : text.trim();
  if (language === "vi" && provider === "vivibe") {
    for (const [pattern, replacement] of VIVIBE_TTS_DICTIONARY) {
      out = out.replace(pattern, replacement);
    }
  }
  // Preserve sentence-final intonation (author-mode-v2 R4.2): do NOT convert a
  // trailing period into a comma. The silent breath gap between clips (inserted
  // structurally during assembly) provides the pause between scenes. Only add a
  // gentle terminal mark when the text has none, so the voice resolves cleanly.
  if (!/[.,!?;:]$/.test(out)) out = `${out}.`;
  return out;
}

function findCached(cacheBase: string): string | null {
  for (const ext of [".mp3", ".wav", ".m4a"]) {
    const candidate = `${cacheBase}${ext}`;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Synthesize narration for every scene and assemble the mixed track.
 * Returns null when provider is "none" (no-voice visual draft).
 */
export async function synthesizeNarration(
  spec: VideoSpec,
  opts: SynthesizeOptions,
): Promise<TtsManifest | null> {
  if (opts.provider === "none") return null;
  if (opts.provider === "vivibe" && spec.language === "en") {
    throw new Error("Vivibe only supports Vietnamese. Select ElevenLabs for English video narration.");
  }

  const speed = opts.speed ?? DEFAULT_TTS_SPEED;
  const p = projectPaths(opts.projectId);
  await mkdir(p.audioDir, { recursive: true });
  const cacheRoot = ttsCacheDir();
  await mkdir(cacheRoot, { recursive: true });

  // Resolve voice + validate config up front (stop-and-report).
  const credentials = opts.provider === "elevenlabs"
    ? resolveElevenLabsCredentials(opts)
    : resolveVivibeCredentials(opts);
  const voiceId = credentials.voiceId;
  if (opts.provider === "vivibe") {
    if (!credentials.apiKey) {
      throw new Error(
        "Vivibe TTS selected but VIVIBE_API_KEY / VIETNAMESE_API_KEY is missing. Set it in .env before rendering.",
      );
    }
    if (!voiceId) {
      throw new Error("Vivibe TTS requires a voice id. Set VIVIBE_VOICE_ID / VIETNAMESE_VOICEID in .env.");
    }
  }
  if (opts.provider === "elevenlabs") {
    if (!credentials.apiKey) {
      throw new Error("ElevenLabs TTS selected but ELEVENLABS_API_KEY is missing. Set it before rendering.");
    }
    if (!voiceId) {
      throw new Error("ElevenLabs TTS requires a voice id. Set ELEVENLABS_VOICE_ID before rendering.");
    }
  }
  const effectiveVoiceId = voiceId ?? "mock";
  const modelId = opts.provider === "elevenlabs"
    ? (credentials as ElevenLabsCredentials).modelId
    : undefined;

  let client: TtsClient | null = null;
  if (opts.provider === "vivibe") client = new VivibeClient({ apiKey: credentials.apiKey });
  if (opts.provider === "elevenlabs") client = new ElevenLabsClient({ apiKey: credentials.apiKey });
  const byScene: Record<string, TtsManifestScene> = {};
  const orderedClips: string[] = [];

  for (let i = 0; i < spec.scenes.length; i += 1) {
    const scene = spec.scenes[i]!;
    const text = prepareTtsText(scene.narration, opts.provider, spec.language);
    const key = ttsCacheKey({
      provider: opts.provider === "mock" ? "mock" : opts.provider,
      text,
      voiceId: effectiveVoiceId,
      speed,
      ...(modelId ? { modelId } : {}),
      languageCode: spec.language,
      outputFormat: opts.provider === "elevenlabs" ? ELEVENLABS_OUTPUT_FORMAT : "provider-default",
      normalizerVersion: spec.language === "vi" ? TTS_NORMALIZER_VERSION : "none-v1",
    });
    const cacheBase = join(cacheRoot, key);

    let audioPath: string;
    let source: TtsManifestScene["source"];
    let srt: SrtSegment[] | undefined;

    if (opts.provider === "mock") {
      audioPath = join(p.audioDir, `${scene.id}.wav`);
      await synthesizeMockAudio(text, audioPath);
      source = "mock";
    } else {
      const cached = findCached(cacheBase);
      if (cached) {
        audioPath = join(p.audioDir, `${scene.id}${extname(cached)}`);
        await copyFile(cached, audioPath);
        source = "cached";
        srt = await loadSrt(`${cached}.srt`);
      } else {
        const result = await client!.synthesize({
          text,
          voiceId: effectiveVoiceId,
          speed,
          outputPath: cacheBase,
          ...(modelId ? { modelId } : {}),
          ...(opts.provider === "elevenlabs" ? { languageCode: spec.language } : {}),
        });
        audioPath = join(p.audioDir, `${scene.id}${extname(result.audioPath)}`);
        await copyFile(result.audioPath, audioPath);
        source = "synthesized";
        srt = result.srtPath ? await loadSrt(result.srtPath) : undefined;
      }
    }

    const duration = await measureAudioDuration(audioPath);
    byScene[scene.id] = { text, voiceId: effectiveVoiceId, speed, audioPath, duration, source, srt };
    orderedClips.push(audioPath);
  }

  // Concatenate into one track WITH a silent breath gap between clips, then
  // optionally mix BGM. The gap length mirrors the lock's transition overlap.
  let mixedAbs = join(p.audioDir, "narration.mixed.wav");
  await concatAudioWithGaps(orderedClips, BREATH_GAP_SECONDS, mixedAbs);
  if (opts.bgmPath && existsSync(opts.bgmPath)) {
    const withBgm = join(p.audioDir, "narration.bgm.wav");
    try {
      // BGM sits quietly under the voice (~20%) and fades out at the tail.
      await mixBgm(mixedAbs, opts.bgmPath, withBgm, opts.bgmVolume ?? DEFAULT_BGM_VOLUME);
      mixedAbs = withBgm;
    } catch {
      // Fall back to the unmixed narration if BGM mixing fails.
    }
  }

  return {
    updatedAt: new Date().toISOString(),
    provider: opts.provider,
    voiceId: effectiveVoiceId,
    ...(modelId ? { modelId } : {}),
    speed,
    byScene,
    mixedSrc: toProjectRel(opts.projectId, mixedAbs),
  };
}

/** Project-relative path (forward slashes) used as the Remotion staticFile src. */
function toProjectRel(projectId: string, absPath: string): string {
  const rel = relative(projectPaths(projectId).root, absPath);
  return rel.split("\\").join("/");
}

/** Read + parse an SRT sidecar for caption timing; returns undefined if absent/empty. */
async function loadSrt(srtPath: string): Promise<SrtSegment[] | undefined> {
  if (!existsSync(srtPath)) return undefined;
  try {
    const segments = parseSrt(await readFile(srtPath, "utf8"));
    return segments.length > 0 ? segments : undefined;
  } catch {
    return undefined;
  }
}
