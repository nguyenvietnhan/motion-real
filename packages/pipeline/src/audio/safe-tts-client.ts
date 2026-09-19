import {
  createTtsClient as createRawTtsClient,
  VoiceProviderError,
  type CloudTtsProvider,
  type CloudTtsTransport,
  type TtsClient,
  type VoiceProvider,
} from "@motionreal/tts";
import { PipelineError } from "../errors.js";
import { isFetchAbortError, makeSafeResponseFetch } from "../ingest/safe-fetch.js";

const API_BODY_CAP = 2 * 1024 * 1024;
const API_TIMEOUT_MS = 60_000;
const SRT_TIMEOUT_MS = 15_000;

export function createTtsClient(provider: VoiceProvider, apiKey = ""): TtsClient {
  if (provider === "vieneu") return createRawTtsClient(provider, apiKey);
  return createRawTtsClient(provider, apiKey, cloudTransport(provider));
}

function cloudTransport(provider: CloudTtsProvider): CloudTtsTransport {
  return {
    apiFetch: providerFetch(provider, { maxRedirects: 0, maxBodyBytes: API_BODY_CAP, timeoutMs: API_TIMEOUT_MS, rejectRedirects: true }),
    audioFetch: providerFetch(provider, { maxRedirects: 5, maxBodyBytes: 64 * 1024 * 1024, timeoutMs: API_TIMEOUT_MS }),
    textFetch: providerFetch(provider, { maxRedirects: 5, maxBodyBytes: 2 * 1024 * 1024, timeoutMs: SRT_TIMEOUT_MS }),
  };
}

function providerFetch(
  provider: CloudTtsProvider,
  options: { maxRedirects: number; maxBodyBytes: number; timeoutMs: number; rejectRedirects?: boolean },
): typeof fetch {
  const safeFetch = makeSafeResponseFetch({ ...options, allowedProtocols: ["https:"] });
  return async (input, init) => {
    try {
      return await safeFetch(input, init);
    } catch (error) {
      if (isFetchAbortError(error)) throw error;
      if (error instanceof PipelineError) {
        throw new VoiceProviderError({
          provider,
          code: /invalid URL|unsupported URL scheme|private\/loopback\/link-local/i.test(error.cause)
            ? "endpoint_not_allowed"
            : "provider_unavailable",
          retryable: !/invalid URL|unsupported URL scheme|private\/loopback\/link-local/i.test(error.cause),
        });
      }
      throw new VoiceProviderError({ provider, code: "provider_unavailable", retryable: true });
    }
  };
}
