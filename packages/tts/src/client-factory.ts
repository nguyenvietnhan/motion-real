import { ElevenLabsClient } from "./elevenlabs-client.js";
import type { TtsClient, VoiceProvider } from "./types.js";
import { VieneuClient } from "./vieneu-client.js";
import { VivibeClient } from "./vivibe-client.js";

export type CloudTtsTransport = {
  apiFetch: typeof fetch;
  audioFetch: typeof fetch;
  textFetch: typeof fetch;
};

export function createTtsClient(
  provider: VoiceProvider,
  apiKey = "",
  transport?: CloudTtsTransport,
): TtsClient {
  if (provider === "vieneu") return new VieneuClient();
  if (!transport) throw new Error("Cloud TTS requires a guarded HTTP transport.");
  return provider === "elevenlabs"
    ? new ElevenLabsClient({ apiKey, fetch: transport.apiFetch })
    : new VivibeClient({ apiKey, apiFetch: transport.apiFetch, audioFetch: transport.audioFetch, textFetch: transport.textFetch });
}
