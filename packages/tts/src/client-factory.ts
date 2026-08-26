import { ElevenLabsClient } from "./elevenlabs-client.js";
import type { CloudTtsProvider, TtsClient } from "./types.js";
import { VivibeClient } from "./vivibe-client.js";

export function createTtsClient(provider: CloudTtsProvider, apiKey: string): TtsClient {
  return provider === "elevenlabs"
    ? new ElevenLabsClient({ apiKey })
    : new VivibeClient({ apiKey });
}
