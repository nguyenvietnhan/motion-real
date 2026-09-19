import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import {
  ELEVENLABS_DEFAULT_MODEL_ID,
  ELEVENLABS_OUTPUT_FORMAT,
  TTS_NORMALIZER_VERSION,
  VIENEU_DEFAULT_VOICE_ID,
  VIENEU_RUNTIME_ID,
  VoiceProviderError,
  asVoiceProviderError,
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
} from "@motionreal/tts";
import { createTtsClient } from "./safe-tts-client.js";
import { BREATH_GAP_SECONDS, DEFAULT_TTS_SPEED, type VideoSpec } from "@motionreal/schema";
import type { TtsManifest, TtsManifestScene, TtsProvider } from "../types.js";
import { projectPaths, ttsCacheDir } from "../store/store.js";
import { parseSrt, type SrtSegment } from "./captions.js";
import { normalizeVietnameseNumbers } from "./vi-number.js";
import { PipelineError } from "../errors.js";

/**
 * TTS synthesis + audio assembly. Per-scene narration is synthesized via
 * @motionreal/tts, cached by text+voiceId+speed, measured, concatenated into one
 * track, and optionally BGM-mixed. Locked timing is derived from MEASURED
 * durations (see lock.ts).
 *
 * Provider contract:
 * - "vivibe" / "elevenlabs": real voice; STOP AND REPORT if key/voice missing —
 * never silently downgrade to mock.
 * - "mock": offline silent clips sized from text length (smoke/visual draft).
 * - "none": no audio (visual-draft path); returns null.
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
  /** BGM gain relative to the voice (0–1); defaults to DEFAULT_BGM_VOLUME (~28%). */
  bgmVolume?: number;
  /** Stops provider I/O, ffmpeg/ffprobe, and the remaining scene loop. */
  signal?: AbortSignal;
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
/** BGM sits under voice — slightly above the old 0.2 so default tracks read on phone speakers. */
export const DEFAULT_BGM_VOLUME = 0.28;

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
  // Preserve sentence-final intonation: do NOT convert a
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
  if (opts.provider === "vieneu" && spec.language === "en") {
    throw new Error("VieNeu Local currently supports Vietnamese only. Select ElevenLabs for English video narration.");
  }

  const speed = opts.speed ?? DEFAULT_TTS_SPEED;
  throwIfAborted(opts.signal);

  // Resolve voice + validate config up front (stop-and-report).
  const credentials = opts.provider === "elevenlabs"
    ? resolveElevenLabsCredentials(opts)
    : opts.provider === "vieneu"
      ? { apiKey: "", voiceId: opts.voiceId?.trim() || VIENEU_DEFAULT_VOICE_ID }
      : resolveVivibeCredentials(opts);
  const voiceId = credentials.voiceId;
  if (opts.provider === "vivibe") {
    if (!credentials.apiKey) {
      throw voicePipelineError(new VoiceProviderError({ provider: "vivibe", code: "not_configured", retryable: false }));
    }
    if (!voiceId) {
      throw voicePipelineError(new VoiceProviderError({ provider: "vivibe", code: "voice_not_found", retryable: false }));
    }
  }
  if (opts.provider === "elevenlabs") {
    if (!credentials.apiKey) {
      throw voicePipelineError(new VoiceProviderError({ provider: "elevenlabs", code: "not_configured", retryable: false }));
    }
    if (!voiceId) {
      throw voicePipelineError(new VoiceProviderError({ provider: "elevenlabs", code: "voice_not_found", retryable: false }));
    }
  }
  if (opts.provider === "vieneu" && !voiceId) {
    throw voicePipelineError(new VoiceProviderError({ provider: "vieneu", code: "voice_not_found", retryable: false }));
  }
  const effectiveVoiceId = voiceId ?? "mock";
  const modelId = opts.provider === "elevenlabs"
    ? (credentials as ElevenLabsCredentials).modelId
    : opts.provider === "vieneu" ? VIENEU_RUNTIME_ID : undefined;

  const client: TtsClient | null = opts.provider === "mock"
    ? null
    : createTtsClient(opts.provider, credentials.apiKey);
  const p = projectPaths(opts.projectId);
  const cacheRoot = ttsCacheDir();
  await mkdir(p.audioDir, { recursive: true });
  await mkdir(cacheRoot, { recursive: true });
  const byScene: Record<string, TtsManifestScene> = {};
  const orderedClips: string[] = [];

  try {
    for (let i = 0; i < spec.scenes.length; i += 1) {
      throwIfAborted(opts.signal);
      const scene = spec.scenes[i]!;
      const text = prepareTtsText(scene.narration, opts.provider, spec.language);
      const key = ttsCacheKey({
        provider: opts.provider === "mock" ? "mock" : opts.provider,
        text,
        voiceId: effectiveVoiceId,
        speed,
        ...(modelId ? { modelId } : {}),
        languageCode: spec.language,
        outputFormat: opts.provider === "elevenlabs" ? ELEVENLABS_OUTPUT_FORMAT : opts.provider === "vieneu" ? "wav-48k-mono-pcm16" : "provider-default",
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
          throwIfAborted(opts.signal);
          source = "cached";
          srt = await loadSrt(`${cached}.srt`);
        } else {
          let result;
          try {
            result = await client!.synthesize({
              text,
              voiceId: effectiveVoiceId,
              speed,
              outputPath: cacheBase,
              ...(modelId ? { modelId } : {}),
              ...(opts.provider === "elevenlabs" ? { languageCode: spec.language } : {}),
            }, { signal: opts.signal });
          } catch (error) {
            if (opts.signal?.aborted) throw error;
            throw voicePipelineError(asVoiceProviderError(opts.provider, error));
          }
          audioPath = join(p.audioDir, `${scene.id}${extname(result.audioPath)}`);
          await copyFile(result.audioPath, audioPath);
          source = "synthesized";
          srt = result.srtPath ? await loadSrt(result.srtPath) : undefined;
        }
      }

      const duration = await measureAudioDuration(audioPath, { signal: opts.signal });
      byScene[scene.id] = { text, voiceId: effectiveVoiceId, speed, audioPath, duration, source, srt };
      orderedClips.push(audioPath);
    }
  } finally {
    await client?.dispose?.();
  }

  // Concatenate into one track WITH a silent breath gap between clips, then
  // optionally mix BGM. The gap length mirrors the lock's transition overlap.
  let mixedAbs = join(p.audioDir, "narration.mixed.wav");
  await concatAudioWithGaps(orderedClips, BREATH_GAP_SECONDS, mixedAbs, { signal: opts.signal });
  if (opts.bgmPath) {
    if (!existsSync(opts.bgmPath)) {
      throw new PipelineError({ stage: "tts", cause: "Selected background music is missing. Choose another track or select no music." });
    }
    const withBgm = join(p.audioDir, "narration.bgm.wav");
    // BGM sits under the voice (DEFAULT_BGM_VOLUME) and fades out at the tail.
    // A selected track is an explicit user choice: never publish a silent
    // fallback when its import or mix fails.
    await mixBgm(mixedAbs, opts.bgmPath, withBgm, opts.bgmVolume ?? DEFAULT_BGM_VOLUME, undefined, { signal: opts.signal });
    mixedAbs = withBgm;
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

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("TTS synthesis was cancelled.");
  error.name = "AbortError";
  throw error;
}

function voicePipelineError(error: VoiceProviderError): PipelineError {
  return new PipelineError({
    stage: "tts",
    cause: `voice provider ${error.failure.code}`,
    voiceFailure: error.failure,
  });
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
