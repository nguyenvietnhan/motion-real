import React, { useState } from "react";
import type {
  AiAccountState,
  GatewayState,
  ModelInfo,
  ProjectCardVM,
  SettingsModel,
  StoryboardModel,
} from "../shared/types.js";
import { FRIENDLY_LABELS } from "./gallery/friendly-status.js";
import { validateCreateInput } from "../main/create/create-controller.js";

/**
 * React views (web-dashboard, redesigned). Own DARK theme for the app chrome —
 * the cream/squared `design-language` is ONLY for rendered video, not the app.
 * Standard product flow: a persistent shell (top bar + AI status chip), a
 * Home-first project surface that GUIDES instead of GATES, and a Settings screen
 * that delegates AI-account login to 9router's own UI.
 */

export const theme = {
  bg: "#0F1115",
  panel: "#181B21",
  panel2: "#1F242C",
  border: "#2A2F37",
  text: "#E6E8EB",
  muted: "#9AA0A8",
  accent: "#4F8CFF",
  good: "#3FB950",
  warn: "#D29922",
  danger: "#F85149",
  radius: 10,
};

const card: React.CSSProperties = {
  background: theme.panel,
  border: `1px solid ${theme.border}`,
  borderRadius: theme.radius,
  padding: 20,
};

const btn = (kind: "primary" | "ghost" = "ghost", disabled = false): React.CSSProperties => ({
  padding: "9px 16px",
  borderRadius: 8,
  border: kind === "primary" ? "none" : `1px solid ${theme.border}`,
  background: disabled ? "#2A2F37" : kind === "primary" ? theme.accent : "transparent",
  color: disabled ? theme.muted : kind === "primary" ? "#fff" : theme.text,
  cursor: disabled ? "not-allowed" : "pointer",
  fontSize: 14,
});

const input: React.CSSProperties = {
  background: theme.panel2,
  border: `1px solid ${theme.border}`,
  borderRadius: 8,
  color: theme.text,
  padding: "10px 12px",
  fontSize: 14,
  outline: "none",
};

// --- AI status chip (top bar) ----------------------------------------------

export function aiReadyLabel(gateway: GatewayState, account: AiAccountState): { dot: string; text: string; color: string } {
  if (gateway.kind === "starting") return { dot: "○", text: "Đang khởi động AI…", color: theme.muted };
  if (gateway.kind === "unavailable") return { dot: "⚠", text: "AI chưa khởi động được", color: theme.danger };
  if (account.kind !== "connected" || account.accounts.length === 0)
    return { dot: "○", text: "Chưa kết nối AI", color: theme.warn };
  const who = account.accounts[0]?.label ?? "AI";
  const model = account.selectedModel?.id ? ` · ${account.selectedModel.id}` : "";
  return { dot: "●", text: `${who}${model}`, color: theme.good };
}

export const TopBar: React.FC<{
  gateway: GatewayState;
  account: AiAccountState;
  onHome: () => void;
  onSettings: () => void;
}> = ({ gateway, account, onHome, onSettings }) => {
  const s = aiReadyLabel(gateway, account);
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 20px",
        borderBottom: `1px solid ${theme.border}`,
        background: theme.panel,
      }}
    >
      <button onClick={onHome} style={{ ...btn("ghost"), border: "none", fontWeight: 700, fontSize: 16 }}>
        News Studio
      </button>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ color: s.color, fontSize: 13 }} title="Trạng thái dịch vụ AI">
          {s.dot} {s.text}
        </span>
        <button onClick={onSettings} style={btn("ghost")}>
          ⚙ Cài đặt
        </button>
      </div>
    </header>
  );
};

// --- Home: create bar + project grid (guides, never gates) -----------------

export const HomeView: React.FC<{
  aiReady: boolean;
  load: "loading" | "empty" | "populated";
  cards: ProjectCardVM[];
  onCreate: (raw: string) => void;
  onOpen: (projectId: string) => void;
  onConnectPrompt: () => void;
}> = ({ aiReady, load, cards, onCreate, onOpen, onConnectPrompt }) => {
  const [raw, setRaw] = useState("");
  const valid = validateCreateInput({ raw });
  const canCreate = aiReady && valid.ok;

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      {!aiReady && (
        <div style={{ ...card, marginBottom: 16, borderColor: theme.accent, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: theme.text }}>Kết nối tài khoản AI để bắt đầu tạo video.</span>
          <button onClick={onConnectPrompt} style={btn("primary")}>
            Kết nối AI
          </button>
        </div>
      )}

      <div style={{ ...card, marginBottom: 24 }}>
        <h2 style={{ margin: "0 0 12px", color: theme.text }}>Tạo video mới</h2>
        <textarea
          aria-label="topic-input"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="Dán đường dẫn bài báo hoặc mô tả chủ đề bằng tiếng Việt…"
          rows={3}
          style={{ ...input, width: "100%", resize: "vertical" }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
          <button onClick={() => onCreate(raw)} disabled={!canCreate} style={btn("primary", !canCreate)}>
            Tạo bản nháp
          </button>
          {!aiReady && <span style={{ color: theme.muted, fontSize: 13 }}>Cần kết nối AI trước.</span>}
        </div>
      </div>

      <h3 style={{ color: theme.text }}>Video của tôi</h3>
      {load === "loading" && <p style={{ color: theme.muted }}>Đang tải…</p>}
      {load === "empty" && <p style={{ color: theme.muted }}>Chưa có video nào. Tạo video đầu tiên ở trên.</p>}
      {load === "populated" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
          {cards.map((c) => (
            <button key={c.projectId} onClick={() => onOpen(c.projectId)} style={{ ...card, padding: 0, textAlign: "left", cursor: "pointer", overflow: "hidden" }}>
              <div style={{ height: 124, background: c.thumbnailPath ? `center/cover url(${c.thumbnailPath})` : theme.panel2 }} />
              <div style={{ padding: 12 }}>
                <strong style={{ color: theme.text, display: "block" }}>{c.title}</strong>
                <span style={{ color: theme.muted, fontSize: 13 }}>{FRIENDLY_LABELS[c.status]}</span>
                <div style={{ color: "#6b7280", fontSize: 12 }}>{c.createdAtLabel}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// --- Settings: delegate AI login to 9router + model/voice/output -----------

export const SettingsView: React.FC<{
  gateway: GatewayState;
  account: AiAccountState;
  models: ModelInfo[];
  settings: SettingsModel;
  onManageAccounts: () => void;
  onSelectModel: (modelId: string) => void;
  onUpdate: (patch: Partial<SettingsModel>) => void;
}> = ({ gateway, account, models, settings, onManageAccounts, onSelectModel, onUpdate }) => {
  const connected = account.kind === "connected" ? account.accounts : [];
  const selectedModelId = account.kind === "connected" ? account.selectedModel?.id ?? "" : "";

  return (
    <div style={{ padding: 24, maxWidth: 720, margin: "0 auto", display: "grid", gap: 16 }}>
      <h2 style={{ color: theme.text, margin: 0 }}>Cài đặt</h2>

      <section style={card}>
        <h3 style={{ marginTop: 0, color: theme.text }}>Tài khoản AI</h3>
        {gateway.kind === "starting" && <p style={{ color: theme.muted }}>Đang khởi động dịch vụ AI…</p>}
        {gateway.kind === "unavailable" && (
          <p style={{ color: theme.danger }}>Không khởi động được 9Router. Hãy kiểm tra 9Router đã cài rồi mở lại app.</p>
        )}
        {gateway.kind === "ready" && (
          <>
            <p style={{ color: connected.length ? theme.good : theme.muted }}>
              {connected.length ? `✓ Đã kết nối: ${connected.map((a) => a.label).join(", ")}` : "Chưa có tài khoản nào."}
            </p>
            <button onClick={onManageAccounts} style={btn("primary")}>
              {connected.length ? "Thêm / quản lý tài khoản (mở 9Router)" : "Đăng nhập tài khoản AI (mở 9Router)"}
            </button>
            <p style={{ color: theme.muted, fontSize: 12, marginBottom: 0 }}>
              Cửa sổ 9Router sẽ mở để bạn đăng nhập đúng cách của từng nhà cung cấp.
            </p>
          </>
        )}
      </section>

      {connected.length > 0 && (
        <section style={card}>
          <h3 style={{ marginTop: 0, color: theme.text }}>Model dùng để dựng</h3>
          <select
            aria-label="model-select"
            value={selectedModelId}
            onChange={(e) => onSelectModel(e.target.value)}
            style={{ ...input, minWidth: 340 }}
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
        </section>
      )}

      <section style={card}>
        <h3 style={{ marginTop: 0, color: theme.text }}>Khác</h3>
        <p style={{ color: theme.text }}>Giọng đọc: {settings.voiceProvider}</p>
        <label style={{ color: theme.text, display: "block", marginTop: 8 }}>
          Số lần tự sửa tối đa
          <input
            type="number"
            min={1}
            max={10}
            value={settings.maxRepairAttempts}
            onChange={(e) => onUpdate({ maxRepairAttempts: Number(e.target.value) })}
            style={{ ...input, width: 72, marginLeft: 8 }}
          />
        </label>
        <label style={{ color: theme.text, display: "block", marginTop: 8 }}>
          <input
            type="checkbox"
            checked={settings.scriptGateEnabled}
            onChange={(e) => onUpdate({ scriptGateEnabled: e.target.checked })}
          />{" "}
          Duyệt kịch bản trước khi dựng
        </label>
        <p style={{ color: theme.muted, fontSize: 12 }}>Thư mục lưu: {settings.outputDir || "(mặc định)"}</p>
      </section>
    </div>
  );
};

// --- Storyboard (dark) -----------------------------------------------------

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
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      {percent !== null && <p style={{ color: theme.text }}>Đang dựng… {percent}%</p>}
      {model.scenes.length === 0 && (
        <p style={{ color: theme.muted }}>Chưa có cảnh nào. (Bộ máy dựng cảnh sẽ điền storyboard ở đây.)</p>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 14 }}>
        {model.scenes.map((s) => (
          <div key={s.sceneId} style={card}>
            <div style={{ height: 140, background: `center/cover url(${s.stillPath})`, borderRadius: 6, border: `1px solid ${theme.border}` }} />
            <textarea
              aria-label={`edit-${s.sceneId}`}
              value={edits[s.sceneId] ?? ""}
              maxLength={2000}
              onChange={(e) => setEdits((m) => ({ ...m, [s.sceneId]: e.target.value }))}
              placeholder="Muốn sửa gì ở cảnh này?"
              rows={2}
              style={{ ...input, width: "100%", marginTop: 10 }}
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
        style={{ ...input, width: "100%", marginTop: 16 }}
      />
      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <button
          onClick={() => onSubmit(Object.entries(edits).map(([sceneId, text]) => ({ sceneId, text })), notes)}
          style={btn("ghost")}
        >
          Gửi chỉnh sửa
        </button>
        <button onClick={onApprove} disabled={!canApprove} style={btn("primary", !canApprove)}>
          Duyệt &amp; xuất bản
        </button>
      </div>
    </div>
  );
};
