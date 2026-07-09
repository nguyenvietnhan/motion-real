import { describe, expect, it } from "vitest";
import type { DoctorReport } from "@motionreal/pipeline";
import {
  buildDesktopReadinessReport,
  desktopVoiceDoctorCheck,
  type DesktopReadinessInput,
} from "./desktop-readiness.js";

const doctorAllReady: DoctorReport = {
  ok: true,
  checks: [
    { name: "ffmpeg", ok: true, detail: "ffmpeg is on PATH at /usr/bin/ffmpeg" },
    { name: "browser", ok: true, detail: "headless Chromium at /home/user/.cache/chromium" },
    { name: "N10 authored typecheck layout", ok: true, detail: "required source/type paths resolved" },
    { name: "theme", ok: true, detail: "theme package ok" },
    { name: "fonts", ok: true, detail: "fonts ok" },
  ],
};

function base(over: Partial<DesktopReadinessInput> = {}): DesktopReadinessInput {
  return {
    gateway: { kind: "ready", baseUrl: "http://127.0.0.1:20128" },
    account: { kind: "connected", accounts: [{ provider: "kiro", label: "me" }], selectedModel: { id: "gpt-5.6", label: "gpt-5.6" } },
    selectedModelId: "gpt-5.6",
    preferredModelId: "gpt-5.6",
    availableModelIds: ["gpt-5.6", "other"],
    voice: { hasApiKey: true, hasVoiceId: true, providerLabel: "Vivibe" },
    doctor: doctorAllReady,
    ...over,
  };
}

function serialized(report: ReturnType<typeof buildDesktopReadinessReport>): string {
  return JSON.stringify(report);
}

describe("buildDesktopReadinessReport", () => {
  it("encrypted/saved desktop key plus voice id is ready even if .env is empty", () => {
    const report = buildDesktopReadinessReport(base());
    expect(report.ok).toBe(true);
    expect(report.checks.find((c) => c.id === "voice")?.state).toBe("ready");
  });

  it("missing key or voice id blocks only the voice check and reveals no value", () => {
    const report = buildDesktopReadinessReport(
      base({ voice: { hasApiKey: false, hasVoiceId: false, providerLabel: "Vivibe" } }),
    );
    const voice = report.checks.find((c) => c.id === "voice")!;
    expect(voice.state).toBe("blocked");
    expect(report.ok).toBe(false);
    const blob = serialized(report);
    expect(blob).not.toMatch(/sk-|api[_-]?key\s*[:=]/i);
    expect(blob).not.toContain("secret");
  });

  it("gateway unavailable blocks gateway/account/model without model selection", () => {
    const report = buildDesktopReadinessReport(
      base({
        gateway: { kind: "unavailable" },
        account: { kind: "disconnected" },
        selectedModelId: undefined,
        availableModelIds: [],
      }),
    );
    expect(report.checks.find((c) => c.id === "gateway")?.state).toBe("blocked");
    expect(report.checks.find((c) => c.id === "account")?.state).toBe("blocked");
    expect(report.checks.find((c) => c.id === "model")?.state).toBe("blocked");
    expect(report.ok).toBe(false);
  });

  it("ready gateway with no account blocks account/model", () => {
    const report = buildDesktopReadinessReport(
      base({
        account: { kind: "disconnected" },
        selectedModelId: undefined,
      }),
    );
    expect(report.checks.find((c) => c.id === "gateway")?.state).toBe("ready");
    expect(report.checks.find((c) => c.id === "account")?.state).toBe("blocked");
    expect(report.checks.find((c) => c.id === "model")?.state).toBe("blocked");
  });

  it("selected/preferred model missing from current list blocks model with replacement remediation", () => {
    const report = buildDesktopReadinessReport(
      base({
        preferredModelId: "gpt-5.6",
        selectedModelId: "gpt-5.6",
        availableModelIds: ["other-only"],
      }),
    );
    const model = report.checks.find((c) => c.id === "model")!;
    expect(model.state).toBe("blocked");
    expect(model.remediation).toMatch(/thay thế|Chọn model/i);
  });

  it("all critical checks ready plus a doctor warning yields report ok: true", () => {
    const report = buildDesktopReadinessReport(
      base({
        doctor: {
          ok: true,
          checks: [
            ...doctorAllReady.checks.filter((c) => !c.name.includes("N10")),
            {
              name: "N10 authored typecheck layout",
              ok: false,
              severity: "warning",
              detail: "some path missing under /Users/secret/project",
            },
          ],
        },
      }),
    );
    expect(report.ok).toBe(true);
    expect(report.checks.find((c) => c.id === "n10")?.state).toBe("warning");
  });

  it("arbitrary doctor error detail/path never appears in the returned report", () => {
    const report = buildDesktopReadinessReport(
      base({
        doctor: {
          ok: false,
          checks: [
            {
              name: "ffmpeg",
              ok: false,
              detail: "ffmpeg not found at C:\\Users\\secret\\bin\\ffmpeg.exe with env KEY=sk-live-xyz",
            },
            { name: "browser", ok: true, detail: "ok" },
            { name: "N10 authored typecheck layout", ok: true, detail: "ok" },
            { name: "theme", ok: true, detail: "ok" },
            { name: "fonts", ok: true, detail: "ok" },
          ],
        },
      }),
    );
    const blob = serialized(report);
    expect(blob).not.toContain("C:\\Users\\secret");
    expect(blob).not.toContain("sk-live-xyz");
    expect(blob).not.toContain("KEY=");
    expect(report.checks.find((c) => c.id === "ffmpeg")?.state).toBe("blocked");
  });
});

describe("desktopVoiceDoctorCheck", () => {
  it("reports presence only without embedding secret values", () => {
    const check = desktopVoiceDoctorCheck({
      hasApiKey: true,
      hasVoiceId: true,
      providerLabel: "ElevenLabs",
    });
    expect(check.ok).toBe(true);
    expect(check.detail).not.toMatch(/sk-|voice-/);
  });
});
