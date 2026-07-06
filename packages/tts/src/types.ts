export type TTSVoice = {
  id: string;
  name: string;
  isActive: boolean;
  previewUrl?: string;
};

export type TTSRequest = {
  text: string;
  voiceId: string;
  speed: number;
  outputPath: string;
  modelId?: string;
  languageCode?: string;
};

export type TTSResult = {
  audioPath: string;
  duration: number;
  raw: unknown;
  /** Absolute path to the downloaded SRT sidecar, when the provider returns one. */
  srtPath?: string;
};

export type CloudTtsProvider = "vivibe" | "elevenlabs";

export interface TtsClient {
  readonly provider: CloudTtsProvider;
  isConfigured(): boolean;
  listVoices(): Promise<TTSVoice[]>;
  synthesize(input: TTSRequest): Promise<TTSResult>;
}
