import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { SettingsStore, type SettingsStoreDeps } from "./settings-store.js";
import { defaultSettings } from "../../shared/settings-model.js";
import type { AiAccountState, SettingsModel } from "../../shared/types.js";

/**
 * Feature: reconcile-main-controllers — SettingsStore property tests (S2).
 * SettingsStore reproduces the inline Current_Behavior of index.ts settings
 * persistence exactly (R3.4–R3.9, R8.4).
 */

const HOME = "/home/.video-tool";
const defaults = (): SettingsModel => defaultSettings(HOME);

/** Build a store over an in-memory file (no disk), optionally pre-seeded. */
function memStore(seed?: string, env?: { apiKey?: string; voiceId?: string }, cipherAvailable = true, decryptFails = false) {
  let file: string | undefined = seed;
  const deps: SettingsStoreDeps = {
    filePath: "settings.json",
    defaults,
    envApiKey: () => env?.apiKey,
    envVoiceId: () => env?.voiceId,
    cipher: {
      isEncryptionAvailable: () => cipherAvailable,
      encryptString: (value) => Buffer.from(`encrypted:${value}`),
      decryptString: (value) => {
        if (decryptFails) throw new Error("wrong user");
        return value.toString().replace(/^encrypted:/, "");
      },
    },
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
    vivibeVoiceId: fc.option(fc.string(), { nil: undefined }),
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
        for (const k of ["vivibeVoiceId", "outputDir", "maxRepairAttempts", "scriptGateEnabled"] as const) {
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
        expect(out.voiceProvider).toBe(before.voiceProvider);
        if ("maxRepairAttempts" in patch) expect(out.maxRepairAttempts).toBe(patch.maxRepairAttempts);
        else expect(out.maxRepairAttempts).toBe(before.maxRepairAttempts);
        // persisted (minus aiAccount) equals the returned settings
        const persisted = JSON.parse(readFile()!) as Partial<SettingsModel>;
        const { aiAccount: _a, voiceCredentials: _c, ...expected } = out;
        expect(persisted).toMatchObject(JSON.parse(JSON.stringify(expected)) as Partial<SettingsModel>);
        expect(persisted).toHaveProperty("encryptedVoiceApiKeys");
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
        expect("voiceCredentials" in persisted).toBe(false);
        for (const k of Object.keys(persisted)) {
          if (k === "encryptedVoiceApiKeys") continue;
          expect(persisted[k]).toEqual((out as Record<string, unknown>)[k]);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// Property 5: Voice config resolution
describe("Property 5: Voice config resolution", () => {
  it("encrypted setting wins over env and never appears in the renderer model", () => {
    const { store, readFile } = memStore(undefined, { apiKey: "env-key", voiceId: "env-voice" });
    store.update({ vivibeVoiceId: "saved-voice" });
    store.setApiKey("vivibe", "saved-key");
    expect(store.voiceConfig("vivibe")).toMatchObject({ apiKey: "saved-key", voiceId: "saved-voice" });
    expect(JSON.stringify(store.current())).not.toContain("saved-key");
    expect(readFile()).not.toContain("saved-key");
  });

  it("migrates the legacy plaintext Vivibe key only after encryption succeeds", () => {
    const { store, readFile } = memStore(JSON.stringify({ voiceApiKey: "legacy", voiceId: "v1" }));
    expect(store.migrateLegacySecret()).toBe(true);
    expect(store.voiceConfig("vivibe").apiKey).toBe("legacy");
    expect(readFile()).not.toContain('"voiceApiKey"');
    expect(readFile()).not.toContain("legacy");
  });

  it("fails closed when OS encryption is unavailable", () => {
    const { store, readFile } = memStore(JSON.stringify({ voiceApiKey: "legacy", voiceId: "v1" }), undefined, false);
    expect(store.migrateLegacySecret()).toBe(false);
    expect(store.voiceConfig("vivibe").apiKey).toBe("");
    expect(readFile()).toContain("legacy");
    expect(() => store.setApiKey("vivibe", "new-key")).toThrow(/Không thể mã hóa/);
  });

  it("drops an undecryptable saved key and requires re-entry", () => {
    const { store } = memStore(JSON.stringify({ encryptedVoiceApiKeys: { elevenlabs: "v1:YmFk" } }), undefined, true, true);
    expect(store.voiceConfig("elevenlabs").apiKey).toBe("");
    expect(store.current().voiceCredentials.elevenlabs).toBe("missing");
  });
});

// freeform-engine F2: refinePasses clamp + legacy visualQaEnabled migration
describe("freeform-engine F2: refinePasses clamp + legacy migration", () => {
  it("clamps a saved refinePasses into [0,5] on load", () => {
    for (const [saved, want] of [[-3, 0], [0, 0], [2, 2], [5, 5], [9, 5]] as const) {
      const { store } = memStore(JSON.stringify({ refinePasses: saved }));
      expect(store.refinePasses).toBe(want);
    }
  });

  it("a non-finite saved refinePasses falls back to the default", () => {
    const { store } = memStore(JSON.stringify({ refinePasses: "lots" }));
    expect(store.refinePasses).toBe(defaults().refinePasses); // 2
  });

  it("migrates a legacy visualQaEnabled boolean to a pass count (only when refinePasses absent)", () => {
    // ON ⇒ the default count; OFF ⇒ 0.
    expect(memStore(JSON.stringify({ visualQaEnabled: true })).store.refinePasses).toBe(defaults().refinePasses);
    expect(memStore(JSON.stringify({ visualQaEnabled: false })).store.refinePasses).toBe(0);
    // An explicit refinePasses wins over the legacy boolean.
    expect(memStore(JSON.stringify({ visualQaEnabled: false, refinePasses: 3 })).store.refinePasses).toBe(3);
  });

  it("defaults refinePasses to 2 when neither key is saved", () => {
    expect(memStore(JSON.stringify({ scriptGateEnabled: true })).store.refinePasses).toBe(2);
  });

  it("clamps refinePasses on update before persisting", () => {
    const { store, readFile } = memStore(JSON.stringify({ refinePasses: 2 }));
    expect(store.update({ refinePasses: 99 }).refinePasses).toBe(5);
    expect(JSON.parse(readFile()!).refinePasses).toBe(5);
    expect(store.update({ refinePasses: -10 }).refinePasses).toBe(0);
    expect(JSON.parse(readFile()!).refinePasses).toBe(0);
  });
});

// freeform-engine K1/R5.4/D13: per-voice calibrated narration rate
describe("freeform-engine K1: calibratedWordsPerSecond (per-voice, clamped)", () => {
  it("returns the saved rate when it was measured for the CURRENTLY configured voice", () => {
    const { store } = memStore(
      JSON.stringify({ voiceId: "v-abc", voiceWordsPerSecond: 5.1, voiceWpsCalibratedFor: "v-abc" }),
    );
    expect(store.calibratedWordsPerSecond()).toBe(5.1);
  });

  it("ignores a rate measured for a DIFFERENT voice (stale → undefined → prompt falls back to default)", () => {
    const { store } = memStore(
      JSON.stringify({ voiceId: "v-new", voiceWordsPerSecond: 5.1, voiceWpsCalibratedFor: "v-old" }),
    );
    expect(store.calibratedWordsPerSecond()).toBeUndefined();
  });

  it("resolves the configured voice via env fallback (a rate calibrated for the env voice still counts)", () => {
    const { store } = memStore(
      JSON.stringify({ voiceWordsPerSecond: 4.2, voiceWpsCalibratedFor: "v-env" }),
      { voiceId: "v-env" },
    );
    expect(store.calibratedWordsPerSecond()).toBe(4.2);
  });

  it("returns undefined when never calibrated (no rate or no recorded voice)", () => {
    expect(memStore(JSON.stringify({ voiceId: "v-abc" })).store.calibratedWordsPerSecond()).toBeUndefined();
    expect(
      memStore(JSON.stringify({ voiceId: "v-abc", voiceWordsPerSecond: 5.0 })).store.calibratedWordsPerSecond(),
    ).toBeUndefined();
  });

  it("clamps a hand-edited out-of-band rate before use (a bad file can't poison the budget)", () => {
    const { store } = memStore(
      JSON.stringify({ voiceId: "v-abc", voiceWordsPerSecond: 99, voiceWpsCalibratedFor: "v-abc" }),
    );
    expect(store.calibratedWordsPerSecond()).toBe(8.0); // MAX_WORDS_PER_SECOND
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
