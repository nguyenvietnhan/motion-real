import { measureAudioDuration, type ProcessOptions } from "./audio-ops.js";
import { alignmentToSrt, type ElevenLabsAlignment } from "./caption-timing.js";
import {
  ensureAudioExtension,
  decodeBase64Audio,
  fetchWithRetry,
  writeFileAtomically,
} from "./provider-http.js";
import { VoiceProviderError, retryAfterMs, voiceProviderErrorFrom } from "./provider-error.js";
import type { TTSRequest, TTSResult, TTSVoice, TtsCallOptions, TtsClient } from "./types.js";

export const ELEVENLABS_DEFAULT_MODEL_ID = "eleven_multilingual_v2";
export const ELEVENLABS_OUTPUT_FORMAT = "mp3_44100_128";

export function elevenLabsApiKey(): string {
  return process.env.ELEVENLABS_API_KEY ?? "";
}

export function defaultElevenLabsVoiceId(): string | undefined {
  return process.env.ELEVENLABS_VOICE_ID;
}

export function elevenLabsBaseUrl(): string {
  return process.env.ELEVENLABS_BASE_URL ?? "https://api.elevenlabs.io";
}

export type ElevenLabsClientOptions = {
  apiKey?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  measureDuration?: (audioPath: string, options?: ProcessOptions) => Promise<number>;
};

type ElevenLabsTimestampResponse = {
  audio_base64: string;
  alignment?: ElevenLabsAlignment | null;
  normalized_alignment?: ElevenLabsAlignment | null;
};

/** REST adapter for ElevenLabs. Synthesis is deliberately not auto-retried. */
export class ElevenLabsClient implements TtsClient {
  readonly provider = "elevenlabs" as const;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly measureDuration: (audioPath: string, options?: ProcessOptions) => Promise<number>;

  constructor(options: ElevenLabsClientOptions = {}) {
    this.apiKey = options.apiKey ?? elevenLabsApiKey();
    this.baseUrl = (options.baseUrl ?? elevenLabsBaseUrl()).replace(/\/$/, "");
    this.fetchImpl = options.fetch ?? fetch;
    this.measureDuration = options.measureDuration ?? measureAudioDuration;
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async listVoices(): Promise<TTSVoice[]> {
    this.assertConfigured();
    const voices: TTSVoice[] = [];
    let nextPageToken: string | undefined;
    do {
      const url = new URL(`${this.baseUrl}/v2/voices`);
      url.searchParams.set("page_size", "100");
      url.searchParams.set("include_total_count", "false");
      if (nextPageToken) url.searchParams.set("next_page_token", nextPageToken);
      const res = await fetchWithRetry(
        () => this.fetchImpl(url, { headers: { "xi-api-key": this.apiKey } }),
        { attempts: 3, baseDelayMs: 500, label: "ElevenLabs voice list" },
      );
      if (!res.ok) throw await elevenLabsHttpError(res, "list voices");
      const body = (await res.json()) as {
        voices?: Array<{ voice_id?: unknown; name?: unknown; preview_url?: unknown }>;
        has_more?: unknown;
        next_page_token?: unknown;
      };
      for (const voice of body.voices ?? []) {
        const id = typeof voice.voice_id === "string" ? voice.voice_id : "";
        if (!id) continue;
        voices.push({
          id,
          name: typeof voice.name === "string" ? voice.name : "Unnamed voice",
          isActive: true,
          ...(typeof voice.preview_url === "string" ? { previewUrl: voice.preview_url } : {}),
        });
      }
      nextPageToken = body.has_more === true && typeof body.next_page_token === "string"
        ? body.next_page_token
        : undefined;
    } while (nextPageToken);
    return voices;
  }

  async synthesize(input: TTSRequest, options: TtsCallOptions = {}): Promise<TTSResult> {
    this.assertConfigured();
    const modelId = input.modelId ?? ELEVENLABS_DEFAULT_MODEL_ID;
    const languageCode = input.languageCode ?? "vi";
    const url = new URL(`${this.baseUrl}/v1/text-to-speech/${encodeURIComponent(input.voiceId)}/with-timestamps`);
    url.searchParams.set("output_format", ELEVENLABS_OUTPUT_FORMAT);
    const body: Record<string, unknown> = {
      text: input.text,
      model_id: modelId,
      language_code: languageCode,
    };
    if (input.speed !== 1) body.voice_settings = { speed: input.speed };

    // A failed or ambiguous generation can consume quota, so the user controls retries.
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", "xi-api-key": this.apiKey },
      body: JSON.stringify(body),
      signal: options.signal,
    });
    if (!res.ok) throw await elevenLabsHttpError(res, "synthesize speech");
    const json = (await res.json()) as ElevenLabsTimestampResponse;
    if (!json.audio_base64) throw new Error("ElevenLabs response did not contain audio_base64.");

    const audioPath = ensureAudioExtension(input.outputPath, ".mp3");
    await writeFileAtomically(audioPath, decodeBase64Audio(json.audio_base64));
    const alignment = json.alignment ?? json.normalized_alignment;
    let srtPath: string | undefined;
    if (alignment) {
      const srt = alignmentToSrt(alignment);
      if (srt) {
        srtPath = `${audioPath}.srt`;
        await writeFileAtomically(srtPath, srt);
      }
    }
    return {
      audioPath,
      duration: await this.measureDuration(audioPath, { signal: options.signal }),
      raw: { provider: "elevenlabs", modelId, languageCode, hasAlignment: Boolean(alignment) },
      ...(srtPath ? { srtPath } : {}),
    };
  }

  private assertConfigured(): void {
    if (!this.apiKey) {
      throw new VoiceProviderError({ provider: "elevenlabs", code: "not_configured", retryable: false });
    }
  }
}

async function elevenLabsHttpError(res: Response, _operation: string): Promise<VoiceProviderError> {
  let detail: unknown = res.statusText;
  try {
    const body = (await res.json()) as {
      detail?: unknown;
      code?: unknown;
      message?: unknown;
      type?: unknown;
      status?: unknown;
    };
    detail = body.detail ?? body;
  } catch (_error) {}
  const wait = retryAfterMs(res);
  return voiceProviderErrorFrom("elevenlabs", {
    status: res.status,
    details: detail,
    ...(wait !== undefined ? { retryAfterMs: wait } : {}),
  });
}
