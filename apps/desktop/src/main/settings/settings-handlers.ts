import type { InvokeHandlers } from "../ipc-router.js";
import type { DesktopReadinessReport, SettingsModel, SettingsUpdateInput, VoiceProviderChoice, VoiceTestResult } from "../../shared/types.js";
import { normalizeSettingsUpdate } from "../../shared/settings-model.js";

export type SmokeRenderResult =
  | { ok: true; kind: "started"; projectId: string }
  | { ok: true; kind: "queued"; queueId: string; jobId: string }
  | { ok: false; error: string };

export type SettingsHandlers = Required<Pick<
  InvokeHandlers,
  | "settings:get"
  | "settings:update"
  | "settings:readiness"
  | "settings:renderSmoke"
  | "tts:setApiKey"
  | "tts:clearApiKey"
  | "tts:testVoice"
>>;

export type SettingsHandlerDeps = {
  current: () => SettingsModel;
  update: (patch: SettingsUpdateInput) => SettingsModel;
  setApiKey: (provider: VoiceProviderChoice, apiKey: string) => SettingsModel;
  clearApiKey: (provider: VoiceProviderChoice) => SettingsModel;
  testVoice: (provider: VoiceProviderChoice) => Promise<VoiceTestResult>;
  parseVoiceProvider: (value: unknown) => VoiceProviderChoice;
  /** Explicit readiness probe; never auto-run on settings open. */
  readiness: () => Promise<DesktopReadinessReport>;
  /** Dev/test: real project path, ~10s, TTS none; single-flight in the owner. */
  renderSmoke: (input?: unknown) => Promise<SmokeRenderResult>;
};

export function createSettingsHandlers(deps: SettingsHandlerDeps): SettingsHandlers {
  return {
    "settings:get": () => deps.current(),
    "settings:update": (patch) => deps.update(normalizeSettingsUpdate(patch)),
    "settings:readiness": () => deps.readiness(),
    "settings:renderSmoke": (input) => deps.renderSmoke(input),
    "tts:setApiKey": (providerRaw, apiKey) => deps.setApiKey(deps.parseVoiceProvider(providerRaw), String(apiKey)),
    "tts:clearApiKey": (providerRaw) => deps.clearApiKey(deps.parseVoiceProvider(providerRaw)),
    "tts:testVoice": (providerRaw) => deps.testVoice(deps.parseVoiceProvider(providerRaw)),
  };
}
