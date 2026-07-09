import { describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../../shared/settings-model.js";
import type { SettingsModel, VoiceProviderChoice } from "../../shared/types.js";
import { createSettingsHandlers } from "./settings-handlers.js";

const baseSettings = (): SettingsModel => defaultSettings("/tmp/video-tool");

describe("settings IPC handlers", () => {
  it("delegates settings get/update to the settings store seam", () => {
    const currentSettings = baseSettings();
    const updatedSettings = { ...currentSettings, maxRepairAttempts: 5 };
    const current = vi.fn(() => currentSettings);
    const update = vi.fn((_patch: Partial<SettingsModel>) => updatedSettings);
    const readiness = vi.fn(async () => ({ ok: true, checks: [] }));
    const handlers = createSettingsHandlers({
      current,
      update,
      setApiKey: vi.fn(),
      clearApiKey: vi.fn(),
      parseVoiceProvider: (value) => value as VoiceProviderChoice,
      readiness,
    });

    expect(handlers["settings:get"]()).toBe(currentSettings);
    expect(handlers["settings:update"]({ maxRepairAttempts: 5 })).toBe(updatedSettings);
    expect(update).toHaveBeenCalledWith({ maxRepairAttempts: 5 });
  });

  it("delegates readiness to the injected probe", async () => {
    const report = { ok: false, checks: [{ id: "voice" as const, state: "blocked" as const, label: "Giọng đọc", detail: "thiếu" }] };
    const readiness = vi.fn(async () => report);
    const handlers = createSettingsHandlers({
      current: () => baseSettings(),
      update: (patch) => ({ ...baseSettings(), ...patch }),
      setApiKey: vi.fn(),
      clearApiKey: vi.fn(),
      parseVoiceProvider: (value) => value as VoiceProviderChoice,
      readiness,
    });
    await expect(handlers["settings:readiness"]()).resolves.toBe(report);
    expect(readiness).toHaveBeenCalledTimes(1);
  });

  it("parses TTS providers and stringifies API keys before mutating secrets", () => {
    const settings = baseSettings();
    const parseVoiceProvider = vi.fn((value: unknown): VoiceProviderChoice => {
      if (value === "vivibe" || value === "elevenlabs") return value;
      throw new Error("bad provider");
    });
    const setApiKey = vi.fn((_provider: VoiceProviderChoice, _apiKey: string) => settings);
    const clearApiKey = vi.fn((_provider: VoiceProviderChoice) => settings);
    const handlers = createSettingsHandlers({
      current: () => settings,
      update: (patch) => ({ ...settings, ...patch }),
      setApiKey,
      clearApiKey,
      parseVoiceProvider,
      readiness: async () => ({ ok: true, checks: [] }),
    });

    expect(handlers["tts:setApiKey"]("elevenlabs", 123)).toBe(settings);
    expect(setApiKey).toHaveBeenCalledWith("elevenlabs", "123");

    expect(handlers["tts:clearApiKey"]("vivibe")).toBe(settings);
    expect(clearApiKey).toHaveBeenCalledWith("vivibe");
    expect(parseVoiceProvider).toHaveBeenCalledTimes(2);
  });
});
