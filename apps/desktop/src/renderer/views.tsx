import React, { useState } from "react";
import type {
  AiAccountState,
  FriendlyStatus,
  GatewayState,
  ModelInfo,
  ProjectCardVM,
  ProjectStage,
  ScriptLine,
  SettingsModel,
  StoryboardModel,
} from "../shared/types.js";
import { FRIENDLY_LABELS } from "./gallery/friendly-status.js";
import { validateCreateInput } from "../shared/create-validation.js";

/**
 * React views (web-dashboard) — enterprise SaaS shell: a left Sidebar for
 * navigation, a Home with a create hero + recent-projects grid, Settings, and
 * Storyboard. Dark product theme via CSS tokens (theme.css); the cream/squared
 * design-language is ONLY for rendered video, never the app chrome.
 */

export type Screen = "home" | "projects" | "settings" | "workspace";

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
  trash: (p: { size?: number }) => (
    <svg width={p.size ?? 16} height={p.size ?? 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6" /></svg>
  ),
  folder: (p: { size?: number }) => (
    <svg width={p.size ?? 16} height={p.size ?? 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" /></svg>
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

// --- License activation (first run) ---------------------------------------

export const LicenseView: React.FC<{
  state: import("../shared/types.js").LicenseState;
  onActivate: (key: string) => void;
}> = ({ state, onActivate }) => {
  const [key, setKey] = useState("");
  const msg: Record<string, { text: string; color: string }> = {
    unactivated: { text: "Nhập mã kích hoạt để bắt đầu dùng News Studio.", color: "var(--muted-foreground)" },
    activating: { text: "Đang kích hoạt…", color: "var(--muted-foreground)" },
    error: { text: "Mã không hợp lệ. Hãy kiểm tra lại và thử lại.", color: "var(--danger)" },
    lapsed: { text: "Giấy phép đã hết hiệu lực.", color: "var(--warn)" },
    active: { text: "Đã kích hoạt.", color: "var(--good)" },
  };
  const m = msg[state.kind] ?? msg.unactivated!;
  return (
    <div style={{ height: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div className="ns-card" style={{ padding: 32, width: 420, maxWidth: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <span className="ns-brand-dot" style={{ width: 32, height: 32 }}>{Icon.spark({ size: 18 })}</span>
          <h1 style={{ margin: 0, fontSize: 20 }}>News Studio</h1>
        </div>
        <p style={{ color: m.color, marginTop: 0 }}>{m.text}</p>
        <input
          aria-label="license-key"
          className="ns-input"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onActivate(key); }}
          placeholder="Mã kích hoạt"
          style={{ width: "100%", marginBottom: 12 }}
        />
        <button className="ns-btn ns-btn-primary" onClick={() => onActivate(key)} disabled={state.kind === "activating"} style={{ width: "100%", justifyContent: "center" }}>
          Kích hoạt
        </button>
        <p style={{ color: "var(--muted-foreground)", fontSize: 12, marginBottom: 0, marginTop: 14, textAlign: "center" }}>
          Bản dev: dùng mã <strong style={{ color: "var(--foreground)" }}>123</strong>.
        </p>
      </div>
    </div>
  );
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
  <span className="ns-pill" style={{ alignSelf: "flex-start", background: "color-mix(in srgb, transparent 84%, " + STATUS_COLOR[status] + ")", color: STATUS_COLOR[status] }}>
    <span style={{ width: 6, height: 6, borderRadius: 999, background: STATUS_COLOR[status], flexShrink: 0 }} />
    {FRIENDLY_LABELS[status]}
  </span>
);

const ProjectGrid: React.FC<{
  cards: ProjectCardVM[];
  onOpen: (id: string) => void;
  onDelete?: (id: string) => void;
  onReveal?: (id: string) => void;
}> = ({ cards, onOpen, onDelete, onReveal }) => (
  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 16 }}>
    {cards.map((c) => (
      <div key={c.projectId} className="ns-card ns-project" role="button" tabIndex={0} onClick={() => onOpen(c.projectId)}
        onKeyDown={(e) => { if (e.key === "Enter") onOpen(c.projectId); }}>
        <div style={{ height: 140, background: c.thumbnailPath ? `center/cover #14161b url(${c.thumbnailPath})` : "linear-gradient(135deg, #1a1d24, #14161b)", display: "grid", placeItems: "center", color: "#3a3f49" }}>
          {!c.thumbnailPath && Icon.film({ size: 30 })}
        </div>
        <div style={{ padding: 14 }}>
          <strong className="ns-project-title" title={c.title} style={{ marginBottom: 10, fontSize: 14 }}>{c.title}</strong>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <StatusPill status={c.status} />
            <span style={{ color: "var(--muted-foreground)", fontSize: 12 }}>{c.createdAtLabel}</span>
          </div>
          {(onReveal || onDelete) && (
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              {onReveal && (
                <button className="ns-btn" title="Mở thư mục dự án" style={{ padding: "6px 10px" }}
                  onClick={(e) => { e.stopPropagation(); onReveal(c.projectId); }}>{Icon.folder({ size: 15 })}</button>
              )}
              {onDelete && (
                <button className="ns-btn" title="Xoá dự án" style={{ padding: "6px 10px", color: "var(--danger)" }}
                  onClick={(e) => { e.stopPropagation(); onDelete(c.projectId); }}>{Icon.trash({ size: 15 })}</button>
              )}
            </div>
          )}
        </div>
      </div>
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
  onDelete?: (id: string) => void;
  onReveal?: (id: string) => void;
  createError?: string;
}> = ({ aiReady, load, cards, onCreate, onOpen, onConnectPrompt, onDelete, onReveal, createError }) => {
  const [raw, setRaw] = useState("");
  const valid = validateCreateInput({ raw });
  const inputValid = valid.ok;
  const recent = cards.slice(0, 8);
  const reason =
    raw.trim() === ""
      ? ""
      : valid.ok
        ? ""
        : valid.reason === "too-long"
          ? "Nội dung quá dài (tối đa 20.000 ký tự)."
          : "Nội dung chưa hợp lệ.";

  return (
    <div className="ns-content">
      <PageHeader title="Trang chủ" subtitle="Mô tả video bạn muốn — như đang nhắn tin. Dán kèm link nếu có, hệ thống tự đọc." />

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
          placeholder="Ví dụ: “Làm video 1p30s, giọng nữ, từ link này https://vnexpress.net/… tập trung vào nguyên nhân” — hoặc chỉ một chủ đề."
          rows={3}
          style={{ width: "100%", resize: "vertical" }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14 }}>
          <button className="ns-btn ns-btn-primary" onClick={() => (aiReady ? onCreate(raw) : onConnectPrompt())} disabled={!inputValid}>
            {Icon.plus({ size: 16 })} Tạo bản nháp
          </button>
          {!aiReady && <span style={{ color: "var(--muted-foreground)", fontSize: 13 }}>Chưa sẵn sàng AI — bấm để mở Cài đặt.</span>}
          {aiReady && reason && <span style={{ color: "var(--warn)", fontSize: 13 }}>{reason}</span>}
        </div>
        {createError && <p style={{ color: "var(--danger)", fontSize: 13, margin: "10px 0 0" }}>{createError}</p>}
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
      {load === "populated" && <ProjectGrid cards={recent} onOpen={onOpen} onDelete={onDelete} onReveal={onReveal} />}
    </div>
  );
};

// --- Projects (full gallery) ----------------------------------------------

export const ProjectsView: React.FC<{
  load: "loading" | "empty" | "populated";
  cards: ProjectCardVM[];
  onOpen: (id: string) => void;
  onNew: () => void;
  onDelete?: (id: string) => void;
  onReveal?: (id: string) => void;
}> = ({ load, cards, onOpen, onNew, onDelete, onReveal }) => (
  <div className="ns-content">
    <PageHeader
      title="Dự án"
      subtitle="Tất cả video của bạn."
      action={<button className="ns-btn ns-btn-primary" onClick={onNew}>{Icon.plus({ size: 16 })} Tạo video</button>}
    />
    {load === "loading" && <p style={{ color: "var(--muted-foreground)" }}>Đang tải…</p>}
    {load === "empty" && <EmptyState icon={Icon.film({ size: 34 })} title="Chưa có dự án" hint="Bấm “Tạo video” để bắt đầu." />}
    {load === "populated" && <ProjectGrid cards={cards} onOpen={onOpen} onDelete={onDelete} onReveal={onReveal} />}
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
      <PageHeader title="Cài đặt" subtitle="Tài khoản AI, giọng đọc và tuỳ chọn dựng video." />

      <Section title="Tài khoản AI & model">
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
            {connected.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <label style={{ display: "block", color: "var(--muted-foreground)", fontSize: 13, marginBottom: 6 }}>Model dùng để dựng</label>
                <select className="ns-input" aria-label="model-select" value={selectedModelId} onChange={(e) => onSelectModel(e.target.value)} style={{ minWidth: 360 }}>
                  <option value="" disabled>— chọn model —</option>
                  {models.map((m) => (<option key={m.id} value={m.id}>{m.id}</option>))}
                </select>
              </div>
            )}
          </>
        )}
      </Section>

      <Section title="Giọng đọc">
        <label style={{ display: "block", color: "var(--muted-foreground)", fontSize: 13, marginBottom: 6 }}>Nhà cung cấp giọng</label>
        <input className="ns-input" value={settings.voiceProvider} disabled style={{ minWidth: 220, marginBottom: 12, opacity: 0.7 }} />
        <label style={{ display: "block", color: "var(--muted-foreground)", fontSize: 13, marginBottom: 6 }}>API key giọng đọc (Vivibe)</label>
        <input className="ns-input" type="password" placeholder="dán API key…" value={settings.voiceApiKey ?? ""}
          onChange={(e) => onUpdate({ voiceApiKey: e.target.value })} style={{ width: "100%", marginBottom: 12 }} />
        <label style={{ display: "block", color: "var(--muted-foreground)", fontSize: 13, marginBottom: 6 }}>Voice ID</label>
        <input className="ns-input" placeholder="voice id…" value={settings.voiceId ?? ""}
          onChange={(e) => onUpdate({ voiceId: e.target.value })} style={{ width: "100%" }} />
        <p style={{ color: "var(--muted-foreground)", fontSize: 12, marginBottom: 0 }}>Bỏ trống sẽ dùng cấu hình trong file .env (nếu có).</p>
      </Section>

      <Section title="Dựng video">
        <label style={{ display: "block", marginBottom: 12 }}>
          Số lần tự sửa tối đa{" "}
          <input className="ns-input" type="number" min={1} max={10} value={settings.maxRepairAttempts}
            onChange={(e) => onUpdate({ maxRepairAttempts: Math.min(10, Math.max(1, Number(e.target.value) || 1)) })} style={{ width: 80, marginLeft: 8, padding: "6px 10px" }} />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={settings.scriptGateEnabled} onChange={(e) => onUpdate({ scriptGateEnabled: e.target.checked })} />
          Duyệt kịch bản trước khi dựng
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
          <input type="checkbox" checked={settings.visualQaEnabled} onChange={(e) => onUpdate({ visualQaEnabled: e.target.checked })} />
          AI tự soát &amp; sửa lỗi hình ảnh trước khi duyệt
        </label>
        <p style={{ color: "var(--muted-foreground)", fontSize: 12, margin: "4px 0 0" }}>
          AI xem ảnh từng cảnh để bắt lỗi bố cục (đè chữ, tràn, lệch) và tự sửa — cần model có khả năng nhìn ảnh; nếu không sẽ tự bỏ qua.
        </p>
        <p style={{ color: "var(--muted-foreground)", fontSize: 12, marginBottom: 0 }}>Thư mục lưu: {settings.outputDir || "(mặc định)"}</p>
      </Section>
    </div>
  );
};

// --- Project workspace: staged flow (write script → review → render → scenes) ---

const Spinner: React.FC = () => (
  <span style={{ display: "inline-block", width: 16, height: 16, border: "2px solid var(--muted)", borderTopColor: "var(--brand)", borderRadius: 999, animation: "ns-spin 0.8s linear infinite" }} />
);

const ScriptReview: React.FC<{
  lines: ScriptLine[];
  onApply: (edits: { sceneId: string; narration?: string; headline?: string }[]) => void;
  onApprove: () => void;
}> = ({ lines, onApply, onApprove }) => {
  const [draft, setDraft] = useState<Record<string, { headline: string; narration: string }>>(
    Object.fromEntries(lines.map((l) => [l.sceneId, { headline: l.headline, narration: l.narration }])),
  );
  const edits = lines.map((l) => ({ sceneId: l.sceneId, headline: draft[l.sceneId]?.headline, narration: draft[l.sceneId]?.narration }));
  return (
    <>
      <div className="ns-card" style={{ padding: 16, marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <span style={{ color: "var(--muted-foreground)" }}>AI đã soạn kịch bản. Sửa lời đọc nếu cần, rồi duyệt để dựng video.</span>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button className="ns-btn" onClick={() => onApply(edits)}>Lưu</button>
          <button className="ns-btn ns-btn-primary" onClick={() => { onApply(edits); onApprove(); }}>Duyệt &amp; dựng video →</button>
        </div>
      </div>
      <div style={{ display: "grid", gap: 12 }}>
        {lines.map((l, i) => (
          <div key={l.sceneId} className="ns-card" style={{ padding: 16 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "baseline", marginBottom: 8 }}>
              <span style={{ color: "var(--brand)", fontWeight: 800 }}>{i + 1}</span>
              <input className="ns-input" value={draft[l.sceneId]?.headline ?? ""} placeholder="Tiêu đề cảnh"
                onChange={(e) => setDraft((d) => ({ ...d, [l.sceneId]: { ...d[l.sceneId]!, headline: e.target.value } }))}
                style={{ flex: 1, padding: "8px 10px" }} />
            </div>
            <textarea className="ns-input" value={draft[l.sceneId]?.narration ?? ""} rows={2} placeholder="Lời đọc"
              onChange={(e) => setDraft((d) => ({ ...d, [l.sceneId]: { ...d[l.sceneId]!, narration: e.target.value } }))}
              style={{ width: "100%" }} />
          </div>
        ))}
      </div>
    </>
  );
};

export const ProjectWorkspaceView: React.FC<{
  stage: ProjectStage;
  onBack: () => void;
  onRetry: () => void;
  onFixWithAi: () => void;
  onApplyScript: (edits: { sceneId: string; narration?: string; headline?: string }[]) => void;
  onApproveScript: () => void;
  onSubmitEdits: (perScene: { sceneId: string; text: string }[], globalNotes: string) => void;
  onApproveDraft: () => void;
}> = ({ stage, onBack, onRetry, onFixWithAi, onApplyScript, onApproveScript, onSubmitEdits, onApproveDraft }) => {
  const title: Record<ProjectStage["kind"], string> = {
    writing: "Đang viết kịch bản",
    script: "Duyệt kịch bản",
    rendering: "Đang dựng video",
    ready: "Duyệt cảnh",
    published: "Đã xuất bản",
    error: "Gặp lỗi",
  };
  if (stage.kind === "ready") {
    return (
      <StoryboardView
        model={{ projectId: "", scenes: stage.scenes, globalNotes: "" }}
        canApprove
        notice={stage.notice}
        onBack={onBack}
        onSubmit={onSubmitEdits}
        onApprove={onApproveDraft}
      />
    );
  }

  return (
    <div className="ns-content">
      <PageHeader title={title[stage.kind]} action={<button className="ns-btn" onClick={onBack}>← Quay lại</button>} />
      {stage.kind === "writing" && (
        <div className="ns-card" style={{ padding: 48, display: "grid", placeItems: "center", gap: 12 }}>
          <Spinner />
          <p style={{ color: "var(--muted-foreground)", margin: 0 }}>AI đang viết kịch bản từ nội dung của bạn…</p>
        </div>
      )}
      {stage.kind === "script" && <ScriptReview lines={stage.lines} onApply={onApplyScript} onApprove={onApproveScript} />}
      {stage.kind === "rendering" && (() => {
        const phase = stage.phase ?? "draft";
        const label =
          phase === "edit" ? "AI đang chỉnh sửa các cảnh theo yêu cầu…"
            : phase === "qa" ? "AI đang tự kiểm tra & sửa lỗi hình ảnh…"
              : phase === "full" ? "Đang dựng video bản đầy đủ (chất lượng cao)…"
                : "Đang dựng giọng đọc + bản nháp…";
        const indeterminate = phase === "edit" || phase === "qa" || stage.percent <= 0;
        return (
          <div className="ns-card" style={{ padding: 32 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <Spinner /> <span>{label}{indeterminate ? "" : ` ${stage.percent}%`}</span>
            </div>
            <div style={{ height: 8, background: "var(--muted)", borderRadius: 999, overflow: "hidden" }}>
              {indeterminate ? (
                <div className="ns-indeterminate" style={{ height: "100%", borderRadius: 999 }} />
              ) : (
                <div style={{ width: `${stage.percent}%`, height: "100%", background: "var(--brand)", borderRadius: 999, transition: "width 0.3s" }} />
              )}
            </div>
          </div>
        );
      })()}
      {stage.kind === "published" && (
        <EmptyState icon={Icon.film({ size: 34 })} title="Đã xuất bản video 🎬"
          hint="Video bản đầy đủ đã được dựng xong. Mở thư mục dự án để lấy file MP4."
          action={
            <div style={{ display: "flex", gap: 10 }}>
              <button className="ns-btn ns-btn-primary" onClick={onBack}>Quay lại Trang chủ</button>
            </div>
          } />
      )}
      {stage.kind === "error" && (
        <EmptyState icon={Icon.film({ size: 34 })} title="Gặp lỗi khi dựng" hint={stage.message}
          action={
            <div style={{ display: "flex", gap: 10 }}>
              {stage.fixable && (
                <button className="ns-btn ns-btn-primary" onClick={onFixWithAi}>Sửa bằng AI</button>
              )}
              <button className={stage.fixable ? "ns-btn" : "ns-btn ns-btn-primary"} onClick={onRetry}>{Icon.plus({ size: 15 })} Thử lại</button>
              <button className="ns-btn" onClick={onBack}>Quay lại Trang chủ</button>
            </div>
          } />
      )}
    </div>
  );
};

// --- Storyboard -----------------------------------------------------------

export const StoryboardView: React.FC<{
  model: StoryboardModel;
  canApprove: boolean;
  notice?: string;
  onBack: () => void;
  onSubmit: (perScene: { sceneId: string; text: string }[], globalNotes: string) => void;
  onApprove: () => void;
}> = ({ model, canApprove, notice, onBack, onSubmit, onApprove }) => {
  const [selected, setSelected] = useState(0);
  // Per-scene edit drafts keyed by sceneId, so switching slides KEEPS what you
  // typed. You gather edits across many scenes and send them in ONE pass.
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [showEdit, setShowEdit] = useState(false);
  const [dismissedNotice, setDismissedNotice] = useState("");

  const scenes = model.scenes;
  const idx = Math.min(selected, Math.max(0, scenes.length - 1));
  const current = scenes[idx];

  const hasEdit = (sceneId: string): boolean => (edits[sceneId] ?? "").trim().length > 0;
  const editedCount = scenes.filter((s) => hasEdit(s.sceneId)).length;
  const batch = scenes.filter((s) => hasEdit(s.sceneId)).map((s) => ({ sceneId: s.sceneId, text: edits[s.sceneId]!.trim() }));
  const canSend = editedCount > 0 || notes.trim() !== "";
  const setCurrentEdit = (text: string): void => {
    if (current) setEdits((m) => ({ ...m, [current.sceneId]: text }));
  };
  const sendAll = (): void => {
    if (!canSend) return;
    onSubmit(batch, notes.trim());
    setEdits({}); // optimistic clear — the edits are being applied + re-rendered
    setNotes("");
    setShowEdit(false);
  };

  // Full-height Canva-style shell: fixed header with actions, then a body that
  // fills the rest WITHOUT page scroll (rail + edit panel scroll internally).
  const Header = (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 18px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
      <button className="ns-btn" onClick={onBack}>← Quay lại</button>
      <div style={{ marginRight: "auto", display: "flex", alignItems: "baseline", gap: 10 }}>
        <strong style={{ fontSize: 16 }}>Duyệt cảnh</strong>
        {scenes.length > 0 && <span style={{ color: "var(--muted-foreground)", fontSize: 13 }}>Cảnh {idx + 1}/{scenes.length}</span>}
        {editedCount > 0 && <span style={{ color: "var(--brand)", fontSize: 13, fontWeight: 700 }}>· đã ghi {editedCount} cảnh</span>}
      </div>
      {scenes.length > 0 && (
        <>
          <button className={`ns-btn${showEdit ? " ns-btn-primary" : ""}`} onClick={() => setShowEdit((v) => !v)}>✎ Sửa cảnh</button>
          <button className="ns-btn ns-btn-primary" disabled={!canSend} onClick={sendAll}>
            {editedCount > 0 ? `Gửi chỉnh sửa (${editedCount})` : "Gửi chỉnh sửa"}
          </button>
          <button className="ns-btn" disabled={!canApprove} onClick={onApprove}>Duyệt &amp; xuất bản</button>
        </>
      )}
    </div>
  );

  if (scenes.length === 0) {
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {Header}
        <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 16 }}>
          <EmptyState icon={Icon.film({ size: 34 })} title="Chưa có cảnh nào" hint="Bản nháp chưa tạo cảnh nào." />
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {Header}

      {notice && notice !== dismissedNotice && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "10px 14px 0", padding: "10px 14px",
          borderRadius: 8, border: "1px solid var(--warn)", background: "color-mix(in srgb, transparent 86%, var(--warn))", flexShrink: 0 }}>
          <span style={{ fontSize: 13, color: "var(--foreground)", marginRight: "auto" }}>{notice}</span>
          <button className="ns-btn" style={{ padding: "4px 10px" }} onClick={() => setDismissedNotice(notice)}>Đã hiểu</button>
        </div>
      )}

      {/* Body fills the viewport; rail + edit panel scroll internally (no page scroll). */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", gap: 14, padding: 14 }}>
        {/* Slide rail */}
        <div style={{ width: 88, flexShrink: 0, display: "flex", flexDirection: "column", gap: 8, overflowY: "auto", paddingRight: 4 }}>
          {scenes.map((s, i) => (
            <button key={s.sceneId} onClick={() => setSelected(i)} title={`Cảnh ${i + 1}`} className="ns-thumb"
              style={{
                position: "relative", flexShrink: 0, padding: 0, cursor: "pointer", borderRadius: 8, overflow: "hidden",
                border: i === idx ? "2px solid var(--brand)" : "1px solid var(--border)",
                background: s.stillPath ? `center/cover no-repeat #0c0e12 url(${s.stillPath})` : "#101216",
                aspectRatio: "9 / 16", width: "100%",
              }}>
              <span style={{ position: "absolute", left: 4, top: 4, fontSize: 10, fontWeight: 800, color: "#fff",
                background: "rgba(0,0,0,0.6)", borderRadius: 5, padding: "0 5px", lineHeight: "15px" }}>{i + 1}</span>
              {hasEdit(s.sceneId) && (
                <span title="Đã ghi yêu cầu chỉnh sửa" style={{ position: "absolute", right: 4, top: 4, width: 15, height: 15,
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#fff",
                  background: "var(--brand)", borderRadius: 999, lineHeight: 1 }}>✎</span>
              )}
            </button>
          ))}
        </div>

        {/* Big preview (always visible; click a slide to enlarge it here) */}
        <div style={{ flex: 1, minWidth: 0, display: "grid", placeItems: "center" }}>
          <div style={{ height: "100%", aspectRatio: "9 / 16", maxWidth: "100%",
            borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden",
            boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
            background: current?.stillPath ? `center/contain no-repeat #0c0e12 url(${current.stillPath})` : "#101216",
            display: "grid", placeItems: "center", color: "#3a3f49" }}>
            {!current?.stillPath && Icon.film({ size: 30 })}
          </div>
        </div>

        {/* Edit panel — shown only on demand (toggle in header) */}
        {showEdit && (
          <div className="ns-card" style={{ width: 320, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10, padding: 14, overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <strong style={{ fontSize: 14 }}>Sửa cảnh {idx + 1}</strong>
              <button className="ns-btn" style={{ padding: "4px 10px" }} onClick={() => setShowEdit(false)}>Đóng</button>
            </div>
            <textarea aria-label={`edit-${current?.sceneId}`} className="ns-input" value={current ? (edits[current.sceneId] ?? "") : ""}
              maxLength={2000} rows={5} onChange={(e) => setCurrentEdit(e.target.value)}
              placeholder="Nói tự nhiên điều muốn đổi cho cảnh này: “to chữ tiêu đề”, “đổi nền sang xanh”, “bỏ bớt chữ, thêm biểu đồ cột”…"
              style={{ width: "100%", resize: "none" }} />
            <label style={{ fontSize: 12, color: "var(--muted-foreground)" }}>Ghi chú chung cho cả video (tùy chọn)</label>
            <textarea aria-label="global-notes" className="ns-input" value={notes} maxLength={2000} rows={3}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="vd “giọng nhanh hơn”, “tông màu ấm hơn”…"
              style={{ width: "100%", resize: "none" }} />
            <p style={{ margin: 0, fontSize: 12, color: "var(--muted-foreground)" }}>
              Chuyển cảnh khác để ghi thêm — yêu cầu được giữ lại tới khi bạn bấm “Gửi chỉnh sửa” trên đầu.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
