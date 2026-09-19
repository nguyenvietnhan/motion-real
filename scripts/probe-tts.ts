import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ELEVENLABS_DEFAULT_MODEL_ID,
  defaultElevenLabsVoiceId,
  defaultVivibeVoiceId,
  elevenLabsApiKey,
  vivibeApiKey,
  type CloudTtsProvider,
  type TtsClient,
} from "../packages/tts/src/index.js";
import { createTtsClient } from "../packages/pipeline/src/index.js";

async function main(): Promise<void> {
  const raw = process.argv.find((arg) => arg.startsWith("--provider="))?.split("=")[1]
    ?? (process.argv.includes("--provider") ? process.argv[process.argv.indexOf("--provider") + 1] : undefined);
  const provider: CloudTtsProvider = raw === "elevenlabs" ? "elevenlabs" : "vivibe";
  const apiKey = provider === "vivibe" ? vivibeApiKey() : elevenLabsApiKey();
  const configuredVoice = provider === "vivibe" ? defaultVivibeVoiceId() : defaultElevenLabsVoiceId();
  if (!apiKey) throw new Error(`Missing ${provider === "vivibe" ? "VIVIBE_API_KEY" : "ELEVENLABS_API_KEY"}.`);
  const client: TtsClient = createTtsClient(provider, apiKey);
  const voices = await client.listVoices();
  const voiceId = configuredVoice ?? voices[0]?.id;
  if (!voiceId) throw new Error(`No ${provider} voice is available.`);
  console.log(`[probe-tts] ${provider}: ${voices.length} voice(s); testing ${voiceId}`);
  const dir = await mkdtemp(join(tmpdir(), `${provider}-probe-`));
  try {
    const result = await client.synthesize({
      text: "Xin chào, đây là kiểm tra giọng đọc tiếng Việt.",
      voiceId,
      speed: 1,
      outputPath: join(dir, "sample.mp3"),
      ...(provider === "elevenlabs" ? { modelId: ELEVENLABS_DEFAULT_MODEL_ID, languageCode: "vi" } : {}),
    });
    console.log(`[probe-tts] OK: ${result.duration.toFixed(2)}s${result.srtPath ? ", timestamps=yes" : ", timestamps=no"}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(`[probe-tts] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
