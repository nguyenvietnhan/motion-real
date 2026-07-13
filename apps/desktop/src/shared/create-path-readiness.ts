import type { AiAccountState, GatewayState, CredentialState, VoiceProviderChoice } from "./types.js";
import { aiReady } from "./ai-ready.js";

/**
 * Create-path readiness (Home / first-run): the three user-facing steps that
 * must be green before "Tạo video" should proceed without bouncing to Settings
 * or failing TTS preflight.
 *
 * Distinct from Settings full `buildDesktopReadinessReport` (which also runs
 * doctor: ffmpeg, Chromium, etc.). This helper is pure, renderer-safe, and
 * never reads secrets — only gateway/account/model state + voice *presence*.
 */

export type CreatePathVoicePresence = {
  hasApiKey: boolean;
  hasVoiceId: boolean;
};

export type CreatePathStepId = "ai" | "model" | "voice";

export type CreatePathStep = {
  id: CreatePathStepId;
  ok: boolean;
  label: string;
  /** Short remediation when not ok; omitted when ok. */
  hint?: string;
};

export type CreatePathReadiness = {
  ok: boolean;
  steps: CreatePathStep[];
};

export type CreatePathReadinessInput = {
  gateway: GatewayState;
  account: AiAccountState;
  voice: CreatePathVoicePresence;
};

/** AI account connected (gateway up + at least one account). Model is a separate step. */
export function aiConnected(gw: GatewayState, acc: AiAccountState): boolean {
  return gw.kind === "ready" && acc.kind === "connected" && acc.accounts.length > 0;
}

export function modelSelected(acc: AiAccountState): boolean {
  return acc.kind === "connected" && acc.selectedModel !== undefined;
}

export function voiceReady(voice: CreatePathVoicePresence): boolean {
  return voice.hasApiKey && voice.hasVoiceId;
}

/** Settings tabs that create-path can deep-link into (not build/about). */
export type CreatePathSettingsTab = "ai" | "voice";

/** Map one checklist step to the Settings tab that fixes it. */
export function settingsTabForCreatePathStep(id: CreatePathStepId): CreatePathSettingsTab {
  return id === "voice" ? "voice" : "ai";
}

/** First blocked step → Settings tab; all green → "ai". */
export function settingsTabForCreatePath(readiness: CreatePathReadiness): CreatePathSettingsTab {
  const first = readiness.steps.find((s) => !s.ok);
  return first ? settingsTabForCreatePathStep(first.id) : "ai";
}

/**
 * Three-step create-path checklist. Order is intentional: connect → model → voice.
 */
export function createPathReadiness(input: CreatePathReadinessInput): CreatePathReadiness {
  const { gateway, account, voice } = input;

  const aiOk = aiConnected(gateway, account);
  const modelOk = aiOk && modelSelected(account);
  const voiceOk = voiceReady(voice);

  const steps: CreatePathStep[] = [
    {
      id: "ai",
      ok: aiOk,
      label: "Kết nối AI",
      ...(!aiOk
        ? {
            hint:
              gateway.kind === "starting"
                ? "Đang khởi động dịch vụ AI — chờ vài giây."
                : gateway.kind === "unavailable"
                  ? "Không kết nối được 9Router. Mở Cài đặt hoặc mở lại app."
                  : "Đăng nhập tài khoản AI trong Cài đặt.",
          }
        : {}),
    },
    {
      id: "model",
      ok: modelOk,
      label: "Chọn model",
      ...(!modelOk
        ? {
            hint: aiOk
              ? "Chọn model dựng video trong Cài đặt → Tài khoản AI."
              : "Cần kết nối AI trước khi chọn model.",
          }
        : {}),
    },
    {
      id: "voice",
      ok: voiceOk,
      label: "Giọng đọc",
      ...(!voiceOk
        ? {
            hint: !voice.hasApiKey
              ? "Thêm API key giọng đọc trong Cài đặt → Giọng đọc."
              : "Thêm voice id trong Cài đặt → Giọng đọc.",
          }
        : {}),
    },
  ];

  return {
    // Keep parity with historical aiReady for AI half; voice is additional.
    ok: aiReady(gateway, account) && voiceOk,
    steps,
  };
}

/**
 * Derive voice presence from public settings fields (no secret values).
 * `environment` credentials mean a key is available from env; voice id may also
 * come from env (not mirrored on the model) so treat env as voice-id present
 * only when the UI voice-id field is empty — still require key presence.
 */
export function voicePresenceFromSettings(input: {
  voiceProvider: VoiceProviderChoice;
  voiceCredentials: Record<VoiceProviderChoice, CredentialState>;
  vivibeVoiceId?: string;
  elevenLabsVoiceId?: string;
}): CreatePathVoicePresence {
  const provider = input.voiceProvider;
  const cred = input.voiceCredentials[provider] ?? "missing";
  const hasApiKey = cred !== "missing";
  const uiVoiceId =
    provider === "elevenlabs" ? input.elevenLabsVoiceId?.trim() : input.vivibeVoiceId?.trim();
  // Env-only installs often omit voice id from the public settings file while
  // main still resolves it from env at create preflight. Avoid false-blocking
  // those users when the key is already marked environment-sourced.
  const hasVoiceId = Boolean(uiVoiceId) || cred === "environment";
  return { hasApiKey, hasVoiceId };
}
