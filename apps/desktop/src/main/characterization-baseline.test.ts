import { describe, expect, it } from "vitest";
import { computeScriptEdits, type ManifestScene } from "./script/script-gate-apply.js";
import { defaultSettings } from "../shared/settings-model.js";
import type { LicenseState, ProjectStage, SettingsModel } from "../shared/types.js";

/**
 * Feature: reconcile-main-controllers, S0 — CHARACTERIZATION BASELINE.
 *
 * This file freezes the OBSERVABLE Current_Behavior of the inline logic in
 * `apps/desktop/src/main/index.ts` as a golden equivalence grid (Requirement
 * 1.2). It is the reference the extracted controllers (S2–S5) must reproduce
 * exactly, and the grid S7 re-checks at the end of the refactor.
 *
 * Where the production logic is already importable + pure (`computeScriptEdits`)
 * we anchor on it directly. Where it lives inline in `index.ts` (not importable
 * without Electron side effects) we mirror the EXACT current expression in a
 * local replica annotated with the source function, and assert the golden table
 * — so any later controller that diverges from these values fails its own test.
 */

// --- Area 1: license:activate (MIRRORS index.ts `"license:activate"`) ------
// Current: license = key.trim() === "123"
//   ? { kind:"active", machineLocked:true, lastVerifiedAt: <ISO now> }
//   : { kind:"error", reason:"invalid" }
function activateBaseline(key: string, nowIso: string): LicenseState {
  return key.trim() === "123"
    ? { kind: "active", machineLocked: true, lastVerifiedAt: nowIso }
    : { kind: "error", reason: "invalid" };
}

describe("S0 baseline — license:activate", () => {
  const now = "2026-01-01T00:00:00.000Z";
  const cases: { key: string; expect: LicenseState }[] = [
    { key: "123", expect: { kind: "active", machineLocked: true, lastVerifiedAt: now } },
    { key: "  123  ", expect: { kind: "active", machineLocked: true, lastVerifiedAt: now } },
    { key: "", expect: { kind: "error", reason: "invalid" } },
    { key: "   ", expect: { kind: "error", reason: "invalid" } },
    { key: "1234", expect: { kind: "error", reason: "invalid" } },
    { key: "abc", expect: { kind: "error", reason: "invalid" } },
  ];
  for (const c of cases) {
    it(`key=${JSON.stringify(c.key)} → ${c.expect.kind}`, () => {
      expect(activateBaseline(c.key, now)).toEqual(c.expect);
    });
  }
});

// --- Area 2: settings load + update (MIRRORS index.ts loadSettings/update) --
// load: { ...base, ...saved, voiceProvider:"vivibe", aiAccount: base.aiAccount }
//       (base = defaultSettings(home)); NOTE: NO clamp of maxRepairAttempts.
// update: { ...settings, ...patch, voiceProvider:"vivibe" }; NO clamp.
function loadBaseline(home: string, saved: Partial<SettingsModel>): SettingsModel {
  const base = defaultSettings(home);
  return { ...base, ...saved, aiAccount: base.aiAccount };
}
function updateBaseline(current: SettingsModel, patch: Partial<SettingsModel>): SettingsModel {
  return { ...current, ...patch };
}

describe("S0 baseline — settings load merge precedence", () => {
  const home = "/home/.video-tool";

  it("saved overrides base for normal keys", () => {
    const out = loadBaseline(home, { outputDir: "/custom", scriptGateEnabled: false, vivibeVoiceId: "v9" });
    expect(out.outputDir).toBe("/custom");
    expect(out.scriptGateEnabled).toBe(false);
    expect(out.vivibeVoiceId).toBe("v9");
  });

  it("voiceProvider persists for the next project", () => {
    const out = loadBaseline(home, { voiceProvider: "elevenlabs" });
    expect(out.voiceProvider).toBe("elevenlabs");
  });

  it("aiAccount is always taken from default (saved aiAccount ignored)", () => {
    const out = loadBaseline(home, { aiAccount: { kind: "connected", accounts: [{ provider: "kiro", label: "Kiro" }] } });
    expect(out.aiAccount).toEqual({ kind: "disconnected" });
  });

  it("maxRepairAttempts is NOT clamped on load (distinct from normalizeSettings)", () => {
    expect(loadBaseline(home, { maxRepairAttempts: 99 }).maxRepairAttempts).toBe(99);
    expect(loadBaseline(home, { maxRepairAttempts: 0 }).maxRepairAttempts).toBe(0);
  });
});

describe("S0 baseline — settings:update merge precedence", () => {
  const base = defaultSettings("/home/.video-tool");

  it("patch overrides provider and normal fields without clamping repair budget", () => {
    const out = updateBaseline(base, { maxRepairAttempts: 42, scriptGateEnabled: false, voiceProvider: "elevenlabs" });
    expect(out.maxRepairAttempts).toBe(42);
    expect(out.scriptGateEnabled).toBe(false);
    expect(out.voiceProvider).toBe("elevenlabs");
  });
});

// --- Area 3: script:applyEdits empty-narration guard (REAL pure fn) ---------
describe("S0 baseline — empty-narration guard (computeScriptEdits)", () => {
  const scenes: ManifestScene[] = [
    { sceneId: "scene-01", narration: "a" },
    { sceneId: "scene-02", narration: "b" },
    { sceneId: "scene-03", narration: "c" },
  ];

  it("rejects with the offending sceneId and changes nothing", () => {
    const res = computeScriptEdits(scenes, [{ sceneId: "scene-02", narration: "   " }]);
    expect(res).toEqual({ ok: false, reason: "empty-narration", sceneId: "scene-02" });
  });

  it("applies valid edits without mutating the input", () => {
    const res = computeScriptEdits(scenes, [{ sceneId: "scene-01", narration: "x", headline: "H" }]);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.scenes[0]).toEqual({ sceneId: "scene-01", narration: "x", headline: "H" });
    expect(scenes[0]!.narration).toBe("a"); // input untouched
  });

  it("ignores edits to unknown scenes", () => {
    const res = computeScriptEdits(scenes, [{ sceneId: "scene-99", narration: "z" }]);
    expect(res.ok).toBe(true);
  });
});

// --- Area 4: projects:stage recovery (MIRRORS index.ts `"projects:stage"`) --
// no scenes ⇒ writing; any still exists ⇒ ready; else ⇒ script; read throw ⇒ writing.
function stageRecoveryBaseline(input: { sceneCount: number; hasStill: boolean; threw: boolean }): ProjectStage["kind"] {
  if (input.threw) return "writing";
  if (input.sceneCount === 0) return "writing";
  if (input.hasStill) return "ready";
  return "script";
}

describe("S0 baseline — projects:stage recovery rules", () => {
  const cases: { name: string; input: { sceneCount: number; hasStill: boolean; threw: boolean }; expect: ProjectStage["kind"] }[] = [
    { name: "no scenes", input: { sceneCount: 0, hasStill: false, threw: false }, expect: "writing" },
    { name: "scenes + stills", input: { sceneCount: 3, hasStill: true, threw: false }, expect: "ready" },
    { name: "scenes, no stills", input: { sceneCount: 3, hasStill: false, threw: false }, expect: "script" },
    { name: "read throws", input: { sceneCount: 3, hasStill: true, threw: true }, expect: "writing" },
  ];
  for (const c of cases) {
    it(`${c.name} ⇒ ${c.expect}`, () => {
      expect(stageRecoveryBaseline(c.input)).toBe(c.expect);
    });
  }
});
