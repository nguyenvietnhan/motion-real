import { existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import {
  VivibeClient,
  concatAudio,
  defaultVivibeVoiceId,
  measureAudioDuration,
  mixBgm,
  synthesizeMockAudio,
  ttsCacheKey,
  vivibeApiKey,
} from "@news/tts";
import { DEFAULT_TTS_SPEED, type VideoSpec } from "@news/schema";
import type { TtsManifest, TtsManifestScene, TtsProvider } from "./types.js";
import { projectPaths, ttsCacheDir } from "./store.js";

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
  voiceId?: string;
  speed?: number;
  /** absolute path to a BGM file to mix under the narration, if any */
  bgmPath?: string;
};

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

function prepareTtsText(text: string, isLast: boolean): string {
  let out = text.trim();
  for (const [pattern, replacement] of VIVIBE_TTS_DICTIONARY) {
    out = out.replace(pattern, replacement);
  }
  if (isLast) return out;
  // Replace a trailing period with a comma so the voice keeps a sustained pitch
  // across scene boundaries instead of dropping and re-attacking.
  if (out.endsWith(".")) return `${out.slice(0, -1)},`;
  if (!/[.,!?;]$/.test(out)) return `${out},`;
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

  const speed = opts.speed ?? DEFAULT_TTS_SPEED;
  const p = projectPaths(opts.projectId);
  await mkdir(p.audioDir, { recursive: true });
  const cacheRoot = ttsCacheDir();
  await mkdir(cacheRoot, { recursive: true });

  // Resolve voice + validate config up front (stop-and-report).
  let voiceId = opts.voiceId ?? defaultVivibeVoiceId();
  if (opts.provider === "vivibe") {
    if (!vivibeApiKey()) {
      throw new Error(
        "Vivibe TTS selected but VIVIBE_API_KEY / VIETNAMESE_API_KEY is missing. Set it in .env before rendering.",
      );
    }
    if (!voiceId) {
      throw new Error("Vivibe TTS requires a voice id. Set VIVIBE_VOICE_ID / VIETNAMESE_VOICEID in .env.");
    }
  }
  const effectiveVoiceId = voiceId ?? "mock";

  const client = opts.provider === "vivibe" ? new VivibeClient() : null;
  const byScene: Record<string, TtsManifestScene> = {};
  const orderedClips: string[] = [];

  for (let i = 0; i < spec.scenes.length; i += 1) {
    const scene = spec.scenes[i]!;
    const isLast = i === spec.scenes.length - 1;
    const text = prepareTtsText(scene.narration, isLast);
    const key = ttsCacheKey(text, effectiveVoiceId, speed);
    const cacheBase = join(cacheRoot, key);

    let audioPath: string;
    let source: TtsManifestScene["source"];

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
      } else {
        const result = await client!.synthesize({
          text,
          voiceId: effectiveVoiceId,
          speed,
          outputPath: cacheBase,
        });
        audioPath = join(p.audioDir, `${scene.id}${extname(result.audioPath)}`);
        await copyFile(result.audioPath, audioPath);
        source = "synthesized";
      }
    }

    const duration = await measureAudioDuration(audioPath);
    byScene[scene.id] = { text, voiceId: effectiveVoiceId, speed, audioPath, duration, source };
    orderedClips.push(audioPath);
  }

  // Concatenate into one track, then optionally mix BGM.
  let mixedAbs = join(p.audioDir, "narration.mixed.wav");
  await concatAudio(orderedClips, mixedAbs);
  if (opts.bgmPath && existsSync(opts.bgmPath)) {
    const withBgm = join(p.audioDir, "narration.bgm.wav");
    try {
      await mixBgm(mixedAbs, opts.bgmPath, withBgm, 0.1);
      mixedAbs = withBgm;
    } catch {
      // Fall back to the unmixed narration if BGM mixing fails.
    }
  }

  return {
    updatedAt: new Date().toISOString(),
    voiceId: effectiveVoiceId,
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
