import React, { useState } from "react";
import type {
  AiAccountState,
  FriendlyStatus,
  GatewayState,
  ModelInfo,
  ProjectCardVM,
  SettingsModel,
  StoryboardModel,
} from "../shared/types.js";
import { FRIENDLY_LABELS } from "./gallery/friendly-status.js";
import { validateCreateInput } from "../main/create/create-controller.js";

/**
 * React views (web-dashboard) — enterprise SaaS shell: a left Sidebar for
 * navigation, a Home with a create hero + recent-projects grid, Settings, and
 * Storyboard. Dark product theme via CSS tokens (theme.css); the cream/squared
 * design-language is ONLY for rendered video, never the app chrome.
 */

export type Screen = "home" | "projects" | "settings" | "storyboard";

// --- icons (inline, currentColor) ------------------------------------------

const Icon = {
  home: (p: { size?: number }) => (
    <svg width={p.size ?? 18} height={p.size ?? 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" />
    </svg>
  ),
  film: (p: { size?: number }) => (
    <svg width={p.size ?? 18} height={p.size ?? 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4" />
    </svg>
  ),
  settings: (p: { size?: number }) => (
    <svg width={p.size ?? 18} height={p.size ?? 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  ),
  plus: (p: { size?: number }) => (
    <svg width={p.size ?? 18} height={p.size ?? 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
  ),
  spark: (p: { size?: number }) => (
    <svg width={p.size ?? 18} height={p.size ?? 18} viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.9 5.6L19.5 9l-5.6 1.4L12 16l-1.9-5.6L4.5 9l5.6-1.4Z" /></svg>
  ),
};

// --- AI status ------------------------------------------------------------

export function aiStatus(gateway: GatewayState, account: AiAccountState): { color: string; text: string; sub?: string } {
  if (gateway.kind === "starting") return { color: "var(--muted-foreground)", text: "Đang khởi động AI…" };
  if (gateway.kind === "unavailable") return { color: "var(--danger)", text: "AI chưa khởi động được" };
  if (account.kind !== "connected" || account.accounts.length === 0)
    return { color: "var(--warn)", text: "Chưa kết nối AI" };
  return {
    color: "var(--good)",
    text: account.accounts[0]?.label ?? "Đã kết nối",
    sub: account.selectedModel?.id,
  };
}

const STATUS_COLOR: Record<FriendlyStatus, string> = {
  building: "var(--warn)",
  "draft-ready": "var(--brand)",
  done: "var(--good)",
  error: "var(--danger)",
};

// --- Sidebar --------------------------------------------------------------

export const Sidebar: React.FC<{
  active: Screen;
  gateway: GatewayState;
  account: AiAccountState;
  onNavigate: (s: Screen) => void;
}> = ({ active, gateway, account, onNavigate }) => {
  const s = aiStatus(gateway, account);
  const NavItem = (id: Screen, label: string, icon: React.ReactNode) => (
    <button className={`ns-nav${active === id ? " active" : ""}`} onClick={() => onNavigate(id)}>
      {icon}
      {label}
    </button>
  );
  return (
    <aside className="ns-sidebar">
      <div className="ns-brand">
        <span className="ns-brand-dot">{Icon.spark({ size: 15 })}</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>News Studio</div>
          <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>Xưởng video tin tức</div>
        </div>
      </div>
      <nav>
        {NavItem("home", "Trang chủ", Icon.home({}))}
        {NavItem("projects", "Dự án", Icon.film({}))}
        {NavItem("settings", "Cài đặt", Icon.settings({}))}
      </nav>
      <button className="ns-statuscard" onClick={() => onNavigate("settings")} title="Trạng thái dịch vụ AI">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: s.color, flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: "var(--foreground)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.text}</span>
        </div>
        {s.sub && <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.sub}</div>}
      </button>
    </aside>
  );
};

// --- page header ----------------------------------------------------------

const PageHeader: React.FC<{ title: string; subtitle?: string; action?: React.ReactNode }> = ({ title, subtitle, action }) => (
  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 }}>
    <div>
      <h1 style={{ margin: 0, fontSize: 24 }}>{title}</h1>
      {subtitle && <p style={{ margin: "6px 0 0", color: "var(--muted-foreground)", fontSize: 14 }}>{subtitle}</p>}
    </div>
    {action}
  </div>
);

const StatusPill: React.FC<{ status: FriendlyStatus }> = ({ status }) => (
  <span className="ns-pill" style={{ background: "color-mix(in srgb, transparent 84%, " + STATUS_COLOR[status] + ")", color: STATUS_COLOR[status] }}>
    <span style={{ width: 6, height: 6, borderRadius: 999, background: STATUS_COLOR[status] }} />
    {FRIENDLY_LABELS[status]}
  </span>
);

const ProjectGrid: React.FC<{ cards: ProjectCardVM[]; onOpen: (id: string) => void }> = ({ cards, onOpen }) => (
  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 16 }}>
    {cards.map((c) => (
      <button key={c.projectId} className="ns-card ns-project" onClick={() => onOpen(c.projectId)}>
        <div style={{ height: 140, background: "linear-gradient(135deg, #1a1d24, #14161b)", display: "grid", placeItems: "center", color: "#3a3f49" }}>
          {Icon.film({ size: 30 })}
        </div>
        <div style={{ padding: 14 }}>
          <strong style={{ display: "block", marginBottom: 8, fontSize: 14 }}>{c.title}</strong>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <StatusPill status={c.status} />
            <span style={{ color: "var(--muted-foreground)", fontSize: 12 }}>{c.createdAtLabel}</span>
          </div>
        </div>
      </button>
    ))}
  </div>
);

const EmptyState: React.FC<{ icon: React.ReactNode; title: string; hint: string; action?: React.ReactNode }> = ({ icon, title, hint, action }) => (
  <div className="ns-card" style={{ padding: 48, textAlign: "center", display: "grid", placeItems: "center", gap: 8 }}>
    <div style={{ color: "var(--muted-foreground)" }}>{icon}</div>
    <h3 style={{ margin: 0 }}>{title}</h3>
    <p style={{ margin: 0, color: "var(--muted-foreground)", maxWidth: 360 }}>{hint}</p>
    {action && <div style={{ marginTop: 8 }}>{action}</div>}
  </div>
);

// --- Home -----------------------------------------------------------------

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
  const recent = cards.slice(0, 8);

  return (
    <div className="ns-content">
      <PageHeader title="Trang chủ" subtitle="Biến một chủ đề hoặc đường dẫn bài báo thành video tin tức 9:16." />

      {!aiReady && (
        <div className="ns-card" style={{ padding: 16, marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between", borderColor: "var(--brand)" }}>
          <span style={{ color: "var(--muted-foreground)" }}>Kết nối tài khoản AI để bắt đầu tạo video.</span>
          <button className="ns-btn ns-btn-primary" onClick={onConnectPrompt}>{Icon.spark({ size: 15 })} Kết nối AI</button>
        </div>
      )}

      {/* Create hero */}
      <div className="ns-card" style={{ padding: 24, marginBottom: 32, background: "linear-gradient(180deg, #17191f, var(--card))" }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>Tạo video mới</h2>
        <p style={{ margin: "0 0 14px", color: "var(--muted-foreground)", fontSize: 13 }}>
          Dán đường dẫn bài báo hoặc mô tả chủ đề bằng tiếng Việt. AI sẽ tự dựng kịch bản, hình ảnh và lời đọc.
        </p>
        <textarea
          aria-label="topic-input"
          className="ns-input"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="Ví dụ: https://vnexpress.net/… hoặc “Giá vàng trong nước tăng mạnh phiên cuối tuần”"
          rows={3}
          style={{ width: "100%", resize: "vertical" }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14 }}>
          <button className="ns-btn ns-btn-primary" onClick={() => onCreate(raw)} disabled={!canCreate}>
            {Icon.plus({ size: 16 })} Tạo bản nháp
          </button>
          {!aiReady && <span style={{ color: "var(--muted-foreground)", fontSize: 13 }}>Cần kết nối AI trước.</span>}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Video gần đây</h2>
        {cards.length > 0 && <span style={{ color: "var(--muted-foreground)", fontSize: 13 }}>{cards.length} dự án</span>}
      </div>

      {load === "loading" && <p style={{ color: "var(--muted-foreground)" }}>Đang tải…</p>}
      {load === "empty" && (
        <EmptyState
          icon={Icon.film({ size: 34 })}
          title="Chưa có video nào"
          hint="Tạo video đầu tiên bằng ô “Tạo video mới” ở trên — chỉ cần một chủ đề hoặc đường dẫn."
        />
      )}
      {load === "populated" && <ProjectGrid cards={recent} onOpen={onOpen} />}
    </div>
  );
};

// --- Projects (full gallery) ----------------------------------------------

export const ProjectsView: React.FC<{
  load: "loading" | "empty" | "populated";
  cards: ProjectCardVM[];
  onOpen: (id: string) => void;
  onNew: () => void;
}> = ({ load, cards, onOpen, onNew }) => (
  <div className="ns-content">
    <PageHeader
      title="Dự án"
      subtitle="Tất cả video của bạn."
      action={<button className="ns-btn ns-btn-primary" onClick={onNew}>{Icon.plus({ size: 16 })} Tạo video</button>}
    />
    {load === "loading" && <p style={{ color: "var(--muted-foreground)" }}>Đang tải…</p>}
    {load === "empty" && <EmptyState icon={Icon.film({ size: 34 })} title="Chưa có dự án" hint="Bấm “Tạo video” để bắt đầu." />}
    {load === "populated" && <ProjectGrid cards={cards} onOpen={onOpen} />}
  </div>
);

// --- Settings -------------------------------------------------------------

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="ns-card" style={{ padding: 20, marginBottom: 16 }}>
    <h3 style={{ marginTop: 0, marginBottom: 14, fontSize: 15 }}>{title}</h3>
    {children}
  </section>
);

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
    <div className="ns-content" style={{ maxWidth: 760 }}>
      <PageHeader title="Cài đặt" subtitle="Tài khoản AI, model, giọng đọc và tuỳ chọn dựng." />

      <Section title="Tài khoản AI">
        {gateway.kind === "starting" && <p style={{ color: "var(--muted-foreground)", margin: 0 }}>Đang khởi động dịch vụ AI…</p>}
        {gateway.kind === "unavailable" && (
          <p style={{ color: "var(--danger)", margin: 0 }}>Không khởi động được 9Router. Hãy kiểm tra 9Router đã cài rồi mở lại app.</p>
        )}
        {gateway.kind === "ready" && (
          <>
            <p style={{ color: connected.length ? "var(--good)" : "var(--muted-foreground)", marginTop: 0 }}>
              {connected.length ? `✓ Đã kết nối: ${connected.map((a) => a.label).join(", ")}` : "Chưa có tài khoản nào."}
            </p>
            <button className="ns-btn ns-btn-primary" onClick={onManageAccounts}>
              {connected.length ? "Thêm / quản lý tài khoản (mở 9Router)" : "Đăng nhập tài khoản AI (mở 9Router)"}
            </button>
            <p style={{ color: "var(--muted-foreground)", fontSize: 12, marginBottom: 0 }}>
              Cửa sổ 9Router sẽ mở để bạn đăng nhập đúng cách của từng nhà cung cấp (Kiro, Codex, Gemini, OpenRouter…).
            </p>
          </>
        )}
      </Section>

      {connected.length > 0 && (
        <Section title="Model dùng để dựng">
          <select className="ns-input" aria-label="model-select" value={selectedModelId} onChange={(e) => onSelectModel(e.target.value)} style={{ minWidth: 360 }}>
            <option value="" disabled>— chọn model —</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>{m.id}</option>
            ))}
          </select>
        </Section>
      )}

      <Section title="Tuỳ chọn dựng">
        <p style={{ color: "var(--foreground)", marginTop: 0 }}>Giọng đọc: <strong>{settings.voiceProvider}</strong></p>
        <label style={{ display: "block", marginBottom: 12 }}>
          Số lần tự sửa tối đa{" "}
          <input className="ns-input" type="number" min={1} max={10} value={settings.maxRepairAttempts}
            onChange={(e) => onUpdate({ maxRepairAttempts: Number(e.target.value) })} style={{ width: 80, marginLeft: 8, padding: "6px 10px" }} />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={settings.scriptGateEnabled} onChange={(e) => onUpdate({ scriptGateEnabled: e.target.checked })} />
          Duyệt kịch bản trước khi dựng
        </label>
        <p style={{ color: "var(--muted-foreground)", fontSize: 12, marginBottom: 0 }}>Thư mục lưu: {settings.outputDir || "(mặc định)"}</p>
      </Section>
    </div>
  );
};

// --- Storyboard -----------------------------------------------------------

export const StoryboardView: React.FC<{
  model: StoryboardModel;
  percent: number | null;
  canApprove: boolean;
  onBack: () => void;
  onSubmit: (perScene: { sceneId: string; text: string }[], globalNotes: string) => void;
  onApprove: () => void;
}> = ({ model, percent, canApprove, onBack, onSubmit, onApprove }) => {
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");

  return (
    <div className="ns-content">
      <PageHeader
        title="Duyệt video"
        subtitle="Xem từng cảnh, ghi điều muốn sửa, rồi duyệt để xuất bản."
        action={<button className="ns-btn" onClick={onBack}>← Quay lại</button>}
      />
      {percent !== null && (
        <div className="ns-card" style={{ padding: 12, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 13 }}>
            <span>Đang dựng…</span><span>{percent}%</span>
          </div>
          <div style={{ height: 6, background: "var(--muted)", borderRadius: 999 }}>
            <div style={{ width: `${percent}%`, height: "100%", background: "var(--brand)", borderRadius: 999 }} />
          </div>
        </div>
      )}
      {model.scenes.length === 0 ? (
        <EmptyState icon={Icon.film({ size: 34 })} title="Chưa có cảnh nào" hint="Bộ máy dựng cảnh sẽ điền storyboard ở đây sau khi tạo bản nháp." />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 16 }}>
          {model.scenes.map((s) => (
            <div key={s.sceneId} className="ns-card" style={{ padding: 12 }}>
              <div style={{ height: 150, background: "#101216", borderRadius: 8, border: "1px solid var(--border)" }} />
              <textarea aria-label={`edit-${s.sceneId}`} className="ns-input" value={edits[s.sceneId] ?? ""} maxLength={2000}
                onChange={(e) => setEdits((m) => ({ ...m, [s.sceneId]: e.target.value }))} placeholder="Muốn sửa gì ở cảnh này?" rows={2}
                style={{ width: "100%", marginTop: 10 }} />
            </div>
          ))}
        </div>
      )}
      <textarea aria-label="global-notes" className="ns-input" value={notes} maxLength={4000}
        onChange={(e) => setNotes(e.target.value)} placeholder="Ghi chú chung cho cả video…" rows={2} style={{ width: "100%", marginTop: 16 }} />
      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <button className="ns-btn" onClick={() => onSubmit(Object.entries(edits).map(([sceneId, text]) => ({ sceneId, text })), notes)}>Gửi chỉnh sửa</button>
        <button className="ns-btn ns-btn-primary" onClick={onApprove} disabled={!canApprove}>Duyệt &amp; xuất bản</button>
      </div>
    </div>
  );
};
