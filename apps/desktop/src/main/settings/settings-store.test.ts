import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { SettingsStore, type SettingsStoreDeps } from "./settings-store.js";
import { defaultSettings } from "../../renderer/settings/settings-model.js";
import type { AiAccountState, SettingsModel } from "../../shared/types.js";

/**
 * Feature: reconcile-main-controllers — SettingsStore property tests (S2).
 * SettingsStore reproduces the inline Current_Behavior of index.ts settings
 * persistence exactly (R3.4–R3.9, R8.4).
 */

const HOME = "/home/.video-tool";
const defaults = (): SettingsModel => defaultSettings(HOME);

/** Build a store over an in-memory file (no disk), optionally pre-seeded. */
function memStore(seed?: string, env?: { apiKey?: string; voiceId?: string }) {
  let file: string | undefined = seed;
  const deps: SettingsStoreDeps = {
    filePath: "settings.json",
    defaults,
    envApiKey: () => env?.apiKey,
    envVoiceId: () => env?.voiceId,
    exists: () => file !== undefined,
    readText: () => file ?? "",
    writeText: (_p, text) => {
      file = text;
    },
  };
  return { store: new SettingsStore(deps), readFile: () => file };
}

const aiAccountArb: fc.Arbitrary<AiAccountState> = fc.constantFrom<AiAccountState>(
  { kind: "disconnected" },
  { kind: "connected", accounts: [{ provider: "kiro", label: "Kiro" }] },
);

const savedArb = fc.record(
  {
    voiceId: fc.option(fc.string(), { nil: undefined }),
    voiceApiKey: fc.option(fc.string(), { nil: undefined }),
    outputDir: fc.string(),
    maxRepairAttempts: fc.integer({ min: -5, max: 99 }),
    scriptGateEnabled: fc.boolean(),
    aiAccount: aiAccountArb,
  },
  { requiredKeys: [] },
);

// Property 2: Settings load merge precedence
describe("Property 2: Settings load merge precedence", () => {
  it("saved wins per-key except voiceProvider(=vivibe) and aiAccount(=default)", () => {
    fc.assert(
      fc.property(savedArb, (saved) => {
        const { store } = memStore(JSON.stringify(saved));
        const out = store.current();
        const base = defaults();
        for (const k of ["voiceId", "voiceApiKey", "outputDir", "maxRepairAttempts", "scriptGateEnabled"] as const) {
          const expected = k in saved ? (saved as Record<string, unknown>)[k] : (base as Record<string, unknown>)[k];
          expect((out as Record<string, unknown>)[k]).toEqual(expected);
        }
        expect(out.voiceProvider).toBe("vivibe");
        expect(out.aiAccount).toEqual(base.aiAccount);
      }),
      { numRuns: 100 },
    );
  });
});

// Property 3: Settings update merge precedence (no clamp) + persisted matches return
describe("Property 3: Settings update merge precedence (no clamp)", () => {
  it("patch wins, voiceProvider forced, maxRepairAttempts NOT clamped, disk matches return", () => {
    fc.assert(
      fc.property(savedArb, (patch) => {
        const { store, readFile } = memStore();
        const before = store.current();
        const out = store.update(patch);
        for (const k of Object.keys(patch) as (keyof SettingsModel)[]) {
          expect(out[k]).toEqual((patch as Record<string, unknown>)[k]);
        }
        expect(out.voiceProvider).toBe("vivibe");
        if ("maxRepairAttempts" in patch) expect(out.maxRepairAttempts).toBe(patch.maxRepairAttempts);
        else expect(out.maxRepairAttempts).toBe(before.maxRepairAttempts);
        // persisted (minus aiAccount) equals the returned settings
        const persisted = JSON.parse(readFile()!) as Partial<SettingsModel>;
        const { aiAccount: _a, ...expected } = out;
        expect(persisted).toEqual(expected);
      }),
      { numRuns: 100 },
    );
  });
});

// Property 4: Persistence excludes aiAccount
describe("Property 4: Persistence excludes aiAccount", () => {
  it("written JSON never contains aiAccount; all other keys match", () => {
    fc.assert(
      fc.property(savedArb, (patch) => {
        const { store, readFile } = memStore();
        const out = store.update(patch);
        const persisted = JSON.parse(readFile()!) as Record<string, unknown>;
        expect("aiAccount" in persisted).toBe(false);
        for (const k of Object.keys(persisted)) {
          expect(persisted[k]).toEqual((out as Record<string, unknown>)[k]);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// Property 5: Voice config resolution
describe("Property 5: Voice config resolution", () => {
  it("trimmed setting if non-empty after trim, else env fallback", () => {
    fc.assert(
      fc.property(
        fc.option(fc.string(), { nil: undefined }),
        fc.option(fc.string(), { nil: undefined }),
        fc.string(),
        fc.string(),
        (voiceApiKey, voiceId, envKey, envVoice) => {
          const { store } = memStore(undefined, { apiKey: envKey, voiceId: envVoice });
          store.update({ voiceApiKey, voiceId });
          const cfg = store.voiceConfig();
          const expectKey = voiceApiKey?.trim() || envKey || "";
          const expectVoice = voiceId?.trim() || envVoice || "";
          expect(cfg.apiKey).toBe(expectKey);
          expect(cfg.voiceId).toBe(expectVoice);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Property 6: setScriptGateEnabled is Boolean coercion + persisted
describe("Property 6: setScriptGateEnabled Boolean coercion", () => {
  it("scriptGateEnabled === Boolean(enabled) and is persisted", () => {
    fc.assert(
      fc.property(fc.anything(), (enabled) => {
        const { store, readFile } = memStore();
        store.setScriptGateEnabled(enabled);
        expect(store.scriptGateEnabled).toBe(Boolean(enabled));
        const persisted = JSON.parse(readFile()!) as { scriptGateEnabled: boolean };
        expect(persisted.scriptGateEnabled).toBe(Boolean(enabled));
      }),
      { numRuns: 100 },
    );
  });
});
