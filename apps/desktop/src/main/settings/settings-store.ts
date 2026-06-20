import type { SettingsModel, VoiceProviderChoice } from "../../shared/types.js";
import {
  DEFAULT_REFINE_PASSES,
  ELEVENLABS_DEFAULT_MODEL_ID,
  clampRefinePasses,
  clampWordsPerSecond,
  voiceCalibrationKey,
} from "../../shared/settings-model.js";
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";

export type SecretCipher = {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
};

export type ResolvedVoiceConfig = {
  provider: VoiceProviderChoice;
  apiKey: string;
  voiceId: string;
  modelId?: string;
  speed: number;
};

export type SettingsStoreDeps = {
  filePath: string;
  defaults: () => SettingsModel;
  envApiKey: () => string | undefined;
  envVoiceId: () => string | undefined;
  envElevenLabsApiKey?: () => string | undefined;
  envElevenLabsVoiceId?: () => string | undefined;
  cipher?: SecretCipher;
  exists?: (path: string) => boolean;
  readText?: (path: string) => string;
  writeText?: (path: string, text: string) => void;
};

type PersistedSettings = Partial<SettingsModel> & {
  visualQaEnabled?: boolean;
  encryptedVoiceApiKeys?: Partial<Record<VoiceProviderChoice, string>>;
  // Legacy plaintext fields. They are read only for one-time migration.
  voiceId?: string;
  voiceApiKey?: string;
  voiceWordsPerSecond?: number;
  voiceWpsCalibratedFor?: string;
};

export class SettingsStore {
  private settings: SettingsModel;
  private encryptedKeys: Partial<Record<VoiceProviderChoice, string>> = {};
  private legacyVivibeApiKey: string | undefined;

  constructor(private readonly deps: SettingsStoreDeps) {
    this.settings = this.load();
  }

  private load(): SettingsModel {
    const base = this.deps.defaults();
    try {
      const exists = this.deps.exists ?? defaultExists;
      if (!exists(this.deps.filePath)) return this.withCredentialStates(base);
      const read = this.deps.readText ?? defaultReadText;
      const saved = JSON.parse(read(this.deps.filePath)) as PersistedSettings;
      this.encryptedKeys = { ...(saved.encryptedVoiceApiKeys ?? {}) };
      this.legacyVivibeApiKey = saved.voiceApiKey?.trim() || undefined;
      const provider: VoiceProviderChoice = saved.voiceProvider === "elevenlabs" ? "elevenlabs" : "vivibe";
      const merged: SettingsModel = {
        ...base,
        ...saved,
        voiceProvider: provider,
        vivibeVoiceId: saved.vivibeVoiceId ?? saved.voiceId ?? base.vivibeVoiceId,
        elevenLabsVoiceId: saved.elevenLabsVoiceId ?? base.elevenLabsVoiceId,
        elevenLabsModelId: saved.elevenLabsModelId || ELEVENLABS_DEFAULT_MODEL_ID,
        voiceCalibrations: { ...(saved.voiceCalibrations ?? {}) },
        voiceCredentials: base.voiceCredentials,
        aiAccount: base.aiAccount,
      };
      const legacyCarrier = merged as unknown as Record<string, unknown>;
      for (const key of [
        "voiceApiKey",
        "voiceId",
        "voiceWordsPerSecond",
        "voiceWpsCalibratedFor",
        "encryptedVoiceApiKeys",
        "visualQaEnabled",
      ]) delete legacyCarrier[key];
      if (saved.voiceWordsPerSecond !== undefined && saved.voiceWpsCalibratedFor) {
        const key = voiceCalibrationKey({ provider: "vivibe", voiceId: saved.voiceWpsCalibratedFor, speed: 1 });
        if (merged.voiceCalibrations[key] === undefined) merged.voiceCalibrations[key] = saved.voiceWordsPerSecond;
      }
      if (saved.refinePasses === undefined && saved.visualQaEnabled !== undefined) {
        merged.refinePasses = saved.visualQaEnabled ? DEFAULT_REFINE_PASSES : 0;
      }
      merged.refinePasses = clampRefinePasses(merged.refinePasses);
      return this.withCredentialStates(merged);
    } catch (error) {
      console.warn("[settings] failed to read settings file, using defaults:", error);
      return this.withCredentialStates(base);
    }
  }

  /** Encrypt and remove a legacy plaintext Vivibe key after Electron is ready. */
  migrateLegacySecret(): boolean {
    if (!this.legacyVivibeApiKey) return true;
    if (!this.deps.cipher?.isEncryptionAvailable()) return false;
    try {
      const previous = this.encryptedKeys.vivibe;
      const encrypted = this.deps.cipher.encryptString(this.legacyVivibeApiKey);
      this.encryptedKeys.vivibe = `v1:${encrypted.toString("base64")}`;
      this.settings = this.withCredentialStates(this.settings);
      if (!this.save()) {
        if (previous) this.encryptedKeys.vivibe = previous;
        else delete this.encryptedKeys.vivibe;
        this.settings = this.withCredentialStates(this.settings);
        return false;
      }
      this.legacyVivibeApiKey = undefined;
      return true;
    } catch (error) {
      console.warn("[settings] failed to encrypt legacy Vivibe API key; re-entry required:", error);
      return false;
    }
  }

  private save(): boolean {
    try {
      const { aiAccount: _omitAccount, voiceCredentials: _omitCredentials, ...publicSettings } = this.settings;
      const persisted = { ...publicSettings, encryptedVoiceApiKeys: this.encryptedKeys };
      const write = this.deps.writeText ?? defaultWriteText;
      write(this.deps.filePath, `${JSON.stringify(persisted, null, 2)}\n`);
      return true;
    } catch (error) {
      console.warn("[settings] failed to persist settings file:", error);
      return false;
    }
  }

  private envKey(provider: VoiceProviderChoice): string {
    return provider === "vivibe"
      ? this.deps.envApiKey()?.trim() ?? ""
      : this.deps.envElevenLabsApiKey?.()?.trim() ?? "";
  }

  private credentialState(provider: VoiceProviderChoice): SettingsModel["voiceCredentials"][VoiceProviderChoice] {
    if (this.encryptedKeys[provider]) return "saved";
    if (this.envKey(provider)) return "environment";
    return "missing";
  }

  private withCredentialStates(settings: SettingsModel): SettingsModel {
    return {
      ...settings,
      voiceCredentials: {
        vivibe: this.credentialState("vivibe"),
        elevenlabs: this.credentialState("elevenlabs"),
      },
    };
  }

  current(): SettingsModel {
    this.settings = this.withCredentialStates(this.settings);
    return this.settings;
  }

  get scriptGateEnabled(): boolean { return this.settings.scriptGateEnabled; }
  get maxRepairAttempts(): number { return this.settings.maxRepairAttempts; }
  get refinePasses(): number { return this.settings.refinePasses; }
  get refineEarlyStop(): boolean { return this.settings.refineEarlyStop; }
  get imageCrawlAiFilter(): boolean { return this.settings.imageCrawlAiFilter; }
  get imageCrawlHumanReview(): boolean { return this.settings.imageCrawlHumanReview; }

  update(patch: Partial<SettingsModel>): SettingsModel {
    const provider = patch.voiceProvider === "elevenlabs" ? "elevenlabs"
      : patch.voiceProvider === "vivibe" ? "vivibe"
        : this.settings.voiceProvider;
    this.settings = {
      ...this.settings,
      ...patch,
      voiceProvider: provider,
      voiceCredentials: this.settings.voiceCredentials,
      voiceCalibrations: patch.voiceCalibrations ?? this.settings.voiceCalibrations,
    };
    this.settings.refinePasses = clampRefinePasses(this.settings.refinePasses);
    this.settings = this.withCredentialStates(this.settings);
    this.save();
    return this.settings;
  }

  setScriptGateEnabled(enabled: unknown): void {
    this.settings = { ...this.settings, scriptGateEnabled: Boolean(enabled) };
    this.save();
  }

  setApiKey(provider: VoiceProviderChoice, apiKey: string): SettingsModel {
    const trimmed = apiKey.trim();
    if (!trimmed) return this.clearApiKey(provider);
    if (!this.deps.cipher?.isEncryptionAvailable()) {
      throw new Error("Không thể mã hóa API key trên máy này. Hãy mở lại ứng dụng rồi thử lại.");
    }
    const previous = this.encryptedKeys[provider];
    const encrypted = this.deps.cipher.encryptString(trimmed);
    this.encryptedKeys[provider] = `v1:${encrypted.toString("base64")}`;
    this.settings = this.withCredentialStates(this.settings);
    if (!this.save()) {
      if (previous) this.encryptedKeys[provider] = previous;
      else delete this.encryptedKeys[provider];
      this.settings = this.withCredentialStates(this.settings);
      throw new Error("Không lưu được API key đã mã hóa. Hãy kiểm tra quyền ghi rồi thử lại.");
    }
    return this.settings;
  }

  clearApiKey(provider: VoiceProviderChoice): SettingsModel {
    const previous = this.encryptedKeys[provider];
    delete this.encryptedKeys[provider];
    this.settings = this.withCredentialStates(this.settings);
    if (!this.save()) {
      if (previous) this.encryptedKeys[provider] = previous;
      this.settings = this.withCredentialStates(this.settings);
      throw new Error("Không xóa được API key đã lưu. Hãy thử lại.");
    }
    if (provider === "vivibe") this.legacyVivibeApiKey = undefined;
    return this.settings;
  }

  private savedApiKey(provider: VoiceProviderChoice): string {
    const encoded = this.encryptedKeys[provider];
    if (!encoded) return "";
    if (!encoded.startsWith("v1:") || !this.deps.cipher?.isEncryptionAvailable()) return "";
    try {
      return this.deps.cipher.decryptString(Buffer.from(encoded.slice(3), "base64")).trim();
    } catch (error) {
      console.warn(`[settings] failed to decrypt ${provider} API key; re-entry required:`, error);
      delete this.encryptedKeys[provider];
      this.settings = this.withCredentialStates(this.settings);
      return "";
    }
  }

  voiceConfig(provider: VoiceProviderChoice = this.settings.voiceProvider, selection: { voiceId?: string; modelId?: string } = {}): ResolvedVoiceConfig {
    const savedKey = this.savedApiKey(provider);
    const apiKey = savedKey || this.envKey(provider);
    if (provider === "elevenlabs") {
      return {
        provider,
        apiKey,
        voiceId: selection.voiceId?.trim() || this.settings.elevenLabsVoiceId?.trim() || this.deps.envElevenLabsVoiceId?.()?.trim() || "",
        modelId: selection.modelId?.trim() || this.settings.elevenLabsModelId || ELEVENLABS_DEFAULT_MODEL_ID,
        speed: 1,
      };
    }
    return {
      provider,
      apiKey,
      voiceId: selection.voiceId?.trim() || this.settings.vivibeVoiceId?.trim() || this.deps.envVoiceId()?.trim() || "",
      speed: 1,
    };
  }

  calibratedWordsPerSecond(selection?: { provider: VoiceProviderChoice; voiceId?: string; modelId?: string; speed?: number }): number | undefined {
    const config = selection
      ? this.voiceConfig(selection.provider, selection)
      : this.voiceConfig(this.settings.voiceProvider);
    if (!config.voiceId) return undefined;
    const key = voiceCalibrationKey(config);
    const rate = this.settings.voiceCalibrations[key];
    return typeof rate === "number" && Number.isFinite(rate) ? clampWordsPerSecond(rate) : undefined;
  }
}

function defaultExists(path: string): boolean { return existsSync(path); }
function defaultReadText(path: string): string { return readFileSync(path, "utf8"); }
function defaultWriteText(path: string, text: string): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, path);
}
