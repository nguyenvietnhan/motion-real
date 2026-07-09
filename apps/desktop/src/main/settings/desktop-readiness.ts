/**
 * Desktop readiness adapter — local/gateway checks only.
 * Never calls an LLM, synthesizes TTS, reveals secrets, or auto-selects a model.
 * Converts doctor/gateway facts through a fixed Vietnamese allow-list.
 */

import type { DoctorCheck, DoctorReport } from "@motionreal/pipeline";
import type {
  AiAccountState,
  DesktopReadinessCheck,
  DesktopReadinessReport,
  GatewayState,
} from "../../shared/types.js";

export type DesktopVoicePresence = {
  hasApiKey: boolean;
  hasVoiceId: boolean;
  providerLabel: string;
};

export type DesktopReadinessInput = {
  gateway: GatewayState;
  account: AiAccountState;
  selectedModelId?: string;
  preferredModelId?: string;
  availableModelIds: readonly string[];
  voice: DesktopVoicePresence;
  /** Doctor report with env slot already overridden for desktop voice. */
  doctor: DoctorReport;
};

function voiceCheck(voice: DesktopVoicePresence): DesktopReadinessCheck {
  if (voice.hasApiKey && voice.hasVoiceId) {
    return {
      id: "voice",
      state: "ready",
      label: "Giọng đọc",
      detail: `${voice.providerLabel}: đã có API key và voice id.`,
    };
  }
  const missing: string[] = [];
  if (!voice.hasApiKey) missing.push("API key");
  if (!voice.hasVoiceId) missing.push("voice id");
  return {
    id: "voice",
    state: "blocked",
    label: "Giọng đọc",
    detail: `${voice.providerLabel}: thiếu ${missing.join(" và ")}.`,
    remediation: "Mở Cài đặt → Giọng đọc, nhập API key và voice id cho nhà cung cấp đã chọn.",
  };
}

function gatewayCheck(gateway: GatewayState): DesktopReadinessCheck {
  if (gateway.kind === "ready") {
    return {
      id: "gateway",
      state: "ready",
      label: "Cổng AI (9Router)",
      detail: "Dịch vụ AI đã sẵn sàng.",
    };
  }
  if (gateway.kind === "starting") {
    return {
      id: "gateway",
      state: "blocked",
      label: "Cổng AI (9Router)",
      detail: "Đang khởi động dịch vụ AI…",
      remediation: "Chờ vài giây rồi chạy lại kiểm tra. Nếu lâu, mở lại ứng dụng.",
    };
  }
  return {
    id: "gateway",
    state: "blocked",
    label: "Cổng AI (9Router)",
    detail: "Không kết nối được 9Router.",
    remediation: "Kiểm tra cài đặt 9Router và mở lại ứng dụng.",
  };
}

function accountCheck(gateway: GatewayState, account: AiAccountState): DesktopReadinessCheck {
  if (gateway.kind !== "ready") {
    return {
      id: "account",
      state: "blocked",
      label: "Tài khoản AI",
      detail: "Cần cổng AI sẵn sàng trước khi kiểm tra tài khoản.",
      remediation: "Khắc phục cổng AI rồi đăng nhập tài khoản trong Cài đặt.",
    };
  }
  if (account.kind === "connected" && account.accounts.length > 0) {
    return {
      id: "account",
      state: "ready",
      label: "Tài khoản AI",
      detail: "Đã kết nối tài khoản.",
    };
  }
  return {
    id: "account",
    state: "blocked",
    label: "Tài khoản AI",
    detail: "Chưa có tài khoản AI nào được kết nối.",
    remediation: "Mở Cài đặt → Tài khoản AI và đăng nhập qua 9Router.",
  };
}

function modelCheck(input: DesktopReadinessInput): DesktopReadinessCheck {
  const { gateway, account, selectedModelId, preferredModelId, availableModelIds } = input;
  if (gateway.kind !== "ready") {
    return {
      id: "model",
      state: "blocked",
      label: "Model dựng video",
      detail: "Cần cổng AI sẵn sàng để kiểm tra model.",
      remediation: "Khắc phục cổng AI trước.",
    };
  }
  if (account.kind !== "connected" || account.accounts.length === 0) {
    return {
      id: "model",
      state: "blocked",
      label: "Model dựng video",
      detail: "Cần tài khoản AI trước khi chọn model.",
      remediation: "Đăng nhập tài khoản AI trong Cài đặt.",
    };
  }
  const preferred = preferredModelId?.trim();
  if (preferred && !availableModelIds.includes(preferred)) {
    return {
      id: "model",
      state: "blocked",
      label: "Model dựng video",
      detail: "Model đã lưu không còn trong danh sách hiện tại.",
      remediation: "Chọn model thay thế trong Cài đặt → Tài khoản AI.",
    };
  }
  const selected = selectedModelId?.trim() || account.selectedModel?.id;
  if (selected && availableModelIds.includes(selected)) {
    return {
      id: "model",
      state: "ready",
      label: "Model dựng video",
      detail: "Đã chọn model dùng để dựng video.",
    };
  }
  if (selected && !availableModelIds.includes(selected)) {
    return {
      id: "model",
      state: "blocked",
      label: "Model dựng video",
      detail: "Model đang chọn không còn trong danh sách.",
      remediation: "Chọn model thay thế trong Cài đặt.",
    };
  }
  return {
    id: "model",
    state: "blocked",
    label: "Model dựng video",
    detail: "Chưa chọn model.",
    remediation: "Chọn model trong Cài đặt → Tài khoản AI.",
  };
}

/** Map doctor slots to fixed Vietnamese labels — never pass through raw detail/paths. */
function mapDoctorSlot(check: DoctorCheck): DesktopReadinessCheck | undefined {
  const name = check.name.toLowerCase();
  if (name.includes("ffmpeg")) {
    return check.ok
      ? { id: "ffmpeg", state: "ready", label: "ffmpeg", detail: "ffmpeg sẵn sàng trên máy." }
      : {
          id: "ffmpeg",
          state: "blocked",
          label: "ffmpeg",
          detail: "Không tìm thấy ffmpeg.",
          remediation: "Cài ffmpeg và thêm vào PATH, rồi chạy lại kiểm tra.",
        };
  }
  if (name.includes("browser") || name.includes("chromium")) {
    return check.ok
      ? { id: "browser", state: "ready", label: "Chromium (render)", detail: "Trình duyệt headless sẵn sàng." }
      : {
          id: "browser",
          state: "blocked",
          label: "Chromium (render)",
          detail: "Chưa có Chromium headless cho Remotion.",
          remediation: "Chạy lại build/render setup để tải Chromium, rồi thử lại.",
        };
  }
  if (name.includes("n10") || name.includes("typecheck") || name.includes("authored")) {
    if (check.ok) {
      return { id: "n10", state: "ready", label: "Bố cục typecheck scene", detail: "Đường dẫn typecheck scene ổn." };
    }
    if (check.severity === "warning") {
      return {
        id: "n10",
        state: "warning",
        label: "Bố cục typecheck scene",
        detail: "Một số đường dẫn typecheck chưa đầy đủ (cảnh báo).",
      };
    }
    return {
      id: "n10",
      state: "blocked",
      label: "Bố cục typecheck scene",
      detail: "Thiếu bố cục typecheck cho scene đã viết.",
      remediation: "Kiểm tra cài đặt workspace/package và chạy typecheck.",
    };
  }
  if (name.includes("theme")) {
    if (check.ok) {
      return { id: "theme", state: "ready", label: "Theme render", detail: "Theme runtime sẵn sàng." };
    }
    if (check.severity === "warning") {
      return { id: "theme", state: "warning", label: "Theme render", detail: "Theme có cảnh báo nhỏ." };
    }
    return {
      id: "theme",
      state: "blocked",
      label: "Theme render",
      detail: "Theme runtime chưa sẵn sàng.",
      remediation: "Kiểm tra package @motionreal/theme.",
    };
  }
  if (name.includes("font")) {
    if (check.ok) {
      return { id: "fonts", state: "ready", label: "Font", detail: "Font render sẵn sàng." };
    }
    if (check.severity === "warning") {
      return { id: "fonts", state: "warning", label: "Font", detail: "Font có cảnh báo nhỏ." };
    }
    return {
      id: "fonts",
      state: "blocked",
      label: "Font",
      detail: "Font render chưa sẵn sàng.",
      remediation: "Chạy vendor-fonts hoặc kiểm tra gói font bundled.",
    };
  }
  // Env/voice is handled by desktop voice presence; registry is informational.
  return undefined;
}

/**
 * Build a renderer-safe readiness report from gateway + desktop voice + doctor.
 * Fixed Vietnamese strings only — no secrets, paths, or raw doctor detail.
 */
export function buildDesktopReadinessReport(input: DesktopReadinessInput): DesktopReadinessReport {
  const checks: DesktopReadinessCheck[] = [
    gatewayCheck(input.gateway),
    accountCheck(input.gateway, input.account),
    modelCheck(input),
    voiceCheck(input.voice),
  ];

  for (const doctorCheck of input.doctor.checks) {
    const mapped = mapDoctorSlot(doctorCheck);
    if (mapped) checks.push(mapped);
  }

  const ok = !checks.some((c) => c.state === "blocked");
  return { ok, checks };
}

/** Desktop voice slot for runDoctor — presence only, never key/voice values. */
export function desktopVoiceDoctorCheck(voice: DesktopVoicePresence): DoctorCheck {
  const missing: string[] = [];
  if (!voice.hasApiKey) missing.push("API key");
  if (!voice.hasVoiceId) missing.push("voice id");
  return {
    name: `${voice.providerLabel} desktop voice`,
    ok: missing.length === 0,
    detail: missing.length === 0 ? "key and voice id present" : `missing: ${missing.join(", ")}`,
  };
}
