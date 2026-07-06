import type { InvokeHandlers } from "../ipc-router.js";
import type { SettingsModel, VoiceProviderChoice } from "../../shared/types.js";

export type SettingsHandlers = Required<Pick<
  InvokeHandlers,
  "settings:get" | "settings:update" | "tts:setApiKey" | "tts:clearApiKey"
>>;

export type SettingsHandlerDeps = {
  current: () => SettingsModel;
  update: (patch: Partial<SettingsModel>) => SettingsModel;
  setApiKey: (provider: VoiceProviderChoice, apiKey: string) => SettingsModel;
  clearApiKey: (provider: VoiceProviderChoice) => SettingsModel;
  parseVoiceProvider: (value: unknown) => VoiceProviderChoice;
};

export function createSettingsHandlers(deps: SettingsHandlerDeps): SettingsHandlers {
  return {
    "settings:get": () => deps.current(),
    "settings:update": (patch) => deps.update(patch as Partial<SettingsModel>),
    "tts:setApiKey": (providerRaw, apiKey) => deps.setApiKey(deps.parseVoiceProvider(providerRaw), String(apiKey)),
    "tts:clearApiKey": (providerRaw) => deps.clearApiKey(deps.parseVoiceProvider(providerRaw)),
  };
}
