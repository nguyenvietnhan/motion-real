import React, { useState } from "react";
import type {
  AiAccountState,
  GatewayState,
  LicenseState,
  ModelInfo,
  ProjectCardVM,
  ProviderInfo,
  SettingsModel,
  StoryboardModel,
} from "../shared/types.js";
import { FRIENDLY_LABELS } from "./gallery/friendly-status.js";
import { validateCreateInput } from "../main/create/create-controller.js";

/**
 * React views (web-dashboard Task 11.1/11.2). Thin surfaces over the typed
 * `window.dashboard` IPC client and the pure controllers/maps; they render ONLY
 * already-translated view-models (no L0 internals). Logic lives in the tested
 * pure modules — these compose them.
 */

const ink = "#1A1714";
const cream = "#FBF7EF";
const accent = "#2B6CB0";

const box: React.CSSProperties = {
  border: `2px solid ${ink}`,
  background: cream,
  padding: 16,
  borderRadius: 0,
};

// --- Onboarding: license + AI connect (Req 1, 2) ---------------------------

export const OnboardingView: React.FC<{
  license: LicenseState;
  gateway: GatewayState;
  account: AiAccountState;
  providers: ProviderInfo[];
  models: ModelInfo[];
  onActivate: (key: string) => void;
  onConnect: (providerId: string) => void;
  onSelectModel: (modelId: string) => void;
}> = ({ license, gateway, account, providers, models, onActivate, onConnect, onSelectModel }) => {
  const [key, setKey] = useState("");
  const licenseMsg: Record<LicenseState["kind"], string> = {
    unactivated: "Nhập mã kích hoạt để bắt đầu.",
    activating: "Đang kích hoạt…",
    active: "Đã kích hoạt.",
    lapsed: "Giấy phép đã hết hiệu lực — các video cũ vẫn xem được.",
    error: "Kích hoạt chưa hoàn tất. Hãy thử lại với cùng mã.",
  };
  const loginHint: Record<ProviderInfo["loginType"], string> = {
    browser: "đăng nhập mở ở trình duyệt ngoài",
    device: "đăng nhập bằng mã thiết bị",
    "api-key": "dán API key",
    custom: "nhà cung cấp tự thêm",
  };
  const connectedLabels =
    account.kind === "connected" ? account.accounts.map((a) => a.label).join(", ") : "";

  return (
    <section style={{ ...box, maxWidth: 620 }}>
      <h2 style={{ marginTop: 0, color: ink }}>Chào mừng</h2>
      <p style={{ color: ink }}>{licenseMsg[license.kind]}</p>
      {license.kind !== "active" && (
        <div style={{ display: "flex", gap: 8 }}>
          <input
            aria-label="license-key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Mã kích hoạt"
            style={{ flex: 1, padding: 8, border: `2px solid ${ink}` }}
          />
          <button onClick={() => onActivate(key)} disabled={license.kind === "activating"} style={{ padding: "8px 16px" }}>
            Kích hoạt
          </button>
        </div>
      )}

      {license.kind === "active" && (
        <div style={{ marginTop: 16 }}>
          <h3 style={{ color: ink, marginBottom: 4 }}>Kết nối tài khoản AI</h3>
          {gateway.kind === "unavailable" && <p style={{ color: "#9B2C2C" }}>Dịch vụ nội bộ chưa khởi động được.</p>}
          {gateway.kind !== "ready" && gateway.kind !== "unavailable" && (
            <p style={{ color: "#6E6757" }}>Đang khởi động dịch vụ AI…</p>
          )}

          {gateway.kind === "ready" && (
            <>
              {connectedLabels && <p style={{ color: ink }}>Đã kết nối: {connectedLabels}</p>}
              <p style={{ color: "#6E6757", margin: "8px 0 4px" }}>Chọn nhà cung cấp để kết nối:</p>
              <div style={{ display: "grid", gap: 6 }}>
                {providers.map((p) => (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between", border: `1px solid ${ink}`, padding: 8 }}>
                    <span style={{ color: ink }}>
                      <strong>{p.name}</strong>{" "}
                      <span style={{ color: "#9B958A", fontSize: 12 }}>
                        ({loginHint[p.loginType]}{p.connectedCount > 0 ? ` · đã nối ${p.connectedCount}` : ""})
                      </span>
                    </span>
                    <button onClick={() => onConnect(p.id)} style={{ padding: "6px 12px" }}>
                      Kết nối
                    </button>
                  </div>
                ))}
              </div>

              {account.kind === "connected" && account.accounts.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <label style={{ color: ink, display: "block", marginBottom: 4 }}>Chọn model để dựng:</label>
                  <select
                    aria-label="model-select"
                    value={account.selectedModel?.id ?? ""}
                    onChange={(e) => onSelectModel(e.target.value)}
                    style={{ padding: 8, border: `2px solid ${ink}`, minWidth: 260 }}
                  >
                    <option value="" disabled>
                      — chọn model —
                    </option>
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.id}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
};

// --- Create (Req 3) --------------------------------------------------------

export const CreateView: React.FC<{ canCreate: boolean; onCreate: (raw: string) => void }> = ({ canCreate, onCreate }) => {
  const [raw, setRaw] = useState("");
  const validation = validateCreateInput({ raw });
  const hint =
    raw.trim() === ""
      ? ""
      : validation.ok
        ? validation.classified.kind === "url"
          ? "Sẽ lấy nội dung từ đường dẫn này."
          : "Sẽ tạo video từ chủ đề này."
        : "Nội dung chưa hợp lệ.";

  return (
    <section style={{ ...box, maxWidth: 640 }}>
      <h2 style={{ marginTop: 0, color: ink }}>Tạo video mới</h2>
      <textarea
        aria-label="topic-input"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        placeholder="Dán đường dẫn bài báo hoặc mô tả chủ đề…"
        rows={3}
        style={{ width: "100%", padding: 8, border: `2px solid ${ink}` }}
      />
      <p style={{ color: "#6E6757", minHeight: 20 }}>{hint}</p>
      <button
        onClick={() => onCreate(raw)}
        disabled={!canCreate || !validation.ok}
        style={{ padding: "10px 20px", background: accent, color: cream }}
      >
        Tạo bản nháp
      </button>
      {!canCreate && <p style={{ color: "#9B2C2C" }}>Hãy kích hoạt và kết nối tài khoản AI trước.</p>}
    </section>
  );
};

// --- Gallery (Req 10) ------------------------------------------------------

export const GalleryView: React.FC<{
  load: "loading" | "empty" | "populated";
  cards: ProjectCardVM[];
  onOpen: (projectId: string) => void;
}> = ({ load, cards, onOpen }) => {
  if (load === "loading") return <p style={{ color: ink }}>Đang tải dự án…</p>;
  if (load === "empty") return <p style={{ color: ink }}>Chưa có video nào. Hãy tạo video đầu tiên.</p>;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
      {cards.map((c) => (
        <button key={c.projectId} onClick={() => onOpen(c.projectId)} style={{ ...box, textAlign: "left", cursor: "pointer" }}>
          <div style={{ height: 120, background: c.thumbnailPath ? `center/cover url(${c.thumbnailPath})` : "#E7E0D2" }} />
          <strong style={{ color: ink, display: "block", marginTop: 8 }}>{c.title}</strong>
          <span style={{ color: "#6E6757" }}>{FRIENDLY_LABELS[c.status]}</span>
          <div style={{ color: "#9B958A", fontSize: 12 }}>{c.createdAtLabel}</div>
        </button>
      ))}
    </div>
  );
};

// --- Storyboard (Req 8, 9) -------------------------------------------------

export const StoryboardView: React.FC<{
  model: StoryboardModel;
  percent: number | null;
  canApprove: boolean;
  onSubmit: (perScene: { sceneId: string; text: string }[], globalNotes: string) => void;
  onApprove: () => void;
}> = ({ model, percent, canApprove, onSubmit, onApprove }) => {
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");

  return (
    <section>
      {percent !== null && <p style={{ color: ink }}>Đang dựng… {percent}%</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
        {model.scenes.map((s) => (
          <div key={s.sceneId} style={box}>
            <div style={{ height: 140, background: `center/cover url(${s.stillPath})`, border: `1px solid ${ink}` }} />
            <textarea
              aria-label={`edit-${s.sceneId}`}
              value={edits[s.sceneId] ?? ""}
              maxLength={2000}
              onChange={(e) => setEdits((m) => ({ ...m, [s.sceneId]: e.target.value }))}
              placeholder="Muốn sửa gì ở cảnh này?"
              rows={2}
              style={{ width: "100%", marginTop: 8, border: `2px solid ${ink}` }}
            />
          </div>
        ))}
      </div>
      <textarea
        aria-label="global-notes"
        value={notes}
        maxLength={4000}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Ghi chú chung cho cả video…"
        rows={2}
        style={{ width: "100%", marginTop: 12, border: `2px solid ${ink}` }}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button
          onClick={() =>
            onSubmit(
              Object.entries(edits).map(([sceneId, text]) => ({ sceneId, text })),
              notes,
            )
          }
          style={{ padding: "10px 20px" }}
        >
          Gửi chỉnh sửa
        </button>
        <button onClick={onApprove} disabled={!canApprove} style={{ padding: "10px 20px", background: accent, color: cream }}>
          Duyệt &amp; xuất bản
        </button>
      </div>
    </section>
  );
};

// --- Settings (Req 11) -----------------------------------------------------

export const SettingsView: React.FC<{ settings: SettingsModel; onUpdate: (patch: Partial<SettingsModel>) => void }> = ({
  settings,
  onUpdate,
}) => (
  <section style={{ ...box, maxWidth: 520 }}>
    <h2 style={{ marginTop: 0, color: ink }}>Cài đặt</h2>
    <label style={{ display: "block", color: ink }}>
      Giọng đọc: {settings.voiceProvider}
    </label>
    <label style={{ display: "block", color: ink, marginTop: 8 }}>
      Số lần tự sửa tối đa
      <input
        type="number"
        min={1}
        max={10}
        value={settings.maxRepairAttempts}
        onChange={(e) => onUpdate({ maxRepairAttempts: Number(e.target.value) })}
        style={{ marginLeft: 8, width: 64, border: `2px solid ${ink}` }}
      />
    </label>
    <label style={{ display: "block", color: ink, marginTop: 8 }}>
      <input
        type="checkbox"
        checked={settings.scriptGateEnabled}
        onChange={(e) => onUpdate({ scriptGateEnabled: e.target.checked })}
      />{" "}
      Duyệt kịch bản trước khi dựng
    </label>
    <p style={{ color: "#9B958A", marginTop: 8 }}>Thư mục lưu: {settings.outputDir}</p>
  </section>
);
