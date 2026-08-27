import { ElevenLabsClient } from "./elevenlabs-client.js";
import type { TtsClient, VoiceProvider } from "./types.js";
import { VieneuClient } from "./vieneu-client.js";
import { VivibeClient } from "./vivibe-client.js";

export function createTtsClient(provider: VoiceProvider, apiKey = ""): TtsClient {
  if (provider === "vieneu") return new VieneuClient();
  return provider === "elevenlabs"
    ? new ElevenLabsClient({ apiKey })
    : new VivibeClient({ apiKey });
}
