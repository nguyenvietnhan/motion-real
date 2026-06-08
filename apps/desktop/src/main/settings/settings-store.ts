import type { SettingsModel } from "../../shared/types.js";
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";

/**
 * SettingsStore (reconcile-main-controllers S2) — the tested home for the
 * settings persistence that was inline in `index.ts` (`loadSettings`/
 * `saveSettings`/`settings:update`/`script:setEnabled`/`ttsConfig`).
 *
 * It reproduces the EXACT Current_Behavior (the authoritative reference, R4.4):
 *  - load: merge saved OVER `defaults` (saved wins), force `voiceProvider:"vivibe"`,
 *    force `aiAccount` from defaults; any read/parse error → defaults, never throws
 *    (R3.4/R3.5).
 *  - update: `{ ...current, ...patch, voiceProvider:"vivibe" }`, persist, return —
 *    NO clamping of `maxRepairAttempts` (this is the divergence from
 *    `normalizeSettings`, kept per Current_Behavior, R3.8).
 *  - save: write JSON with `aiAccount` EXCLUDED (R3.6).
 *  - voiceConfig: `setting.trim()` if non-empty after trim, else env fallback (R3.7).
 *
 * All filesystem + env access is injected so the store is testable without disk.
 */

export type SettingsStoreDeps = {
  /** Absolute path to the settings JSON file. */
  filePath: string;
  /** `defaultSettings(videoToolHome())` — the base layer. */
  defaults: () => SettingsModel;
  /** Env voice key fallback (`vivibeApiKey()`). */
  envApiKey: () => string | undefined;
  /** Env voice id fallback (`defaultVivibeVoiceId()`). */
  envVoiceId: () => string | undefined;
  /** FS seams (default to node fs). */
  exists?: (path: string) => boolean;
  readText?: (path: string) => string;
  writeText?: (path: string, text: string) => void;
};

export class SettingsStore {
  private settings: SettingsModel;

  constructor(private readonly deps: SettingsStoreDeps) {
    this.settings = this.load();
  }

  /** Load from disk merged over defaults; never throws (R3.4/R3.5). */
  private load(): SettingsModel {
    const base = this.deps.defaults();
    try {
      const exists = this.deps.exists ?? defaultExists;
      if (exists(this.deps.filePath)) {
        const read = this.deps.readText ?? defaultReadText;
        const saved = JSON.parse(read(this.deps.filePath)) as Partial<SettingsModel>;
        return { ...base, ...saved, voiceProvider: "vivibe", aiAccount: base.aiAccount };
      }
    } catch (e) {
      console.warn("[settings] failed to read settings file, using defaults:", e);
    }
    return base;
  }

  /** Persist current settings, EXCLUDING `aiAccount` (R3.6); never throws. */
  private save(): void {
    try {
      const { aiAccount: _omit, ...persisted } = this.settings;
      const write = this.deps.writeText ?? defaultWriteText;
      write(this.deps.filePath, `${JSON.stringify(persisted, null, 2)}\n`);
    } catch (e) {
      console.warn("[settings] failed to persist settings file:", e);
    }
  }

  current(): SettingsModel {
    return this.settings;
  }

  get scriptGateEnabled(): boolean {
    return this.settings.scriptGateEnabled;
  }

  get maxRepairAttempts(): number {
    return this.settings.maxRepairAttempts;
  }

  /** Merge patch (patch wins), force voiceProvider, persist, return (R3.8). */
  update(patch: Partial<SettingsModel>): SettingsModel {
    this.settings = { ...this.settings, ...patch, voiceProvider: "vivibe" };
    this.save();
    return this.settings;
  }

  /** Set the script gate via Boolean coercion + persist (R3.9). */
  setScriptGateEnabled(enabled: unknown): void {
    this.settings = { ...this.settings, scriptGateEnabled: Boolean(enabled) };
    this.save();
  }

  /** Resolve TTS config: trimmed setting if non-empty, else env fallback (R3.7). */
  voiceConfig(): { apiKey: string; voiceId: string } {
    return {
      apiKey: this.settings.voiceApiKey?.trim() || this.deps.envApiKey() || "",
      voiceId: this.settings.voiceId?.trim() || this.deps.envVoiceId() || "",
    };
  }
}

// --- default fs seams (kept out of the class so tests can inject pure ones) --

function defaultExists(path: string): boolean {
  return existsSync(path);
}
function defaultReadText(path: string): string {
  return readFileSync(path, "utf8");
}
function defaultWriteText(path: string, text: string): void {
  // Atomic write: a crash/power-loss mid-write must not truncate the real file
  // (which would silently reset all settings to defaults on next load).
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, path);
}
