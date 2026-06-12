import React, { useState } from "react";
import type { AiAccountState, GatewayState, ModelInfo, SettingsModel } from "../../shared/types.js";
import { activeAccount } from "../../shared/active-account.js";
import { Icon } from "../icons.js";
import { Field, PageHeader, SettingsCard, Toggle } from "../primitives.js";

type SettingsTab = "ai" | "voice" | "build" | "about";

/** Enterprise tabbed settings: AI account / voice / video build / about. */
export const SettingsView: React.FC<{
  gateway: GatewayState;
  account: AiAccountState;
  models: ModelInfo[];
  settings: SettingsModel;
  onManageAccounts: () => void;
  onSelectModel: (modelId: string) => void;
  onUpdate: (patch: Partial<SettingsModel>) => void;
}> = ({ gateway, account, models, settings, onManageAccounts, onSelectModel, onUpdate }) => {
  const [tab, setTab] = useState<SettingsTab>("ai");
  const connected = account.kind === "connected" ? account.accounts : [];
  const currentAccount = activeAccount(account);
  const selectedModelId = account.kind === "connected" ? account.selectedModel?.id ?? "" : "";

  const TABS: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: "ai", label: "Tài khoản AI", icon: Icon.spark({ size: 16 }) },
    { id: "voice", label: "Giọng đọc", icon: Icon.film({ size: 16 }) },
    { id: "build", label: "Dựng video", icon: Icon.settings({ size: 16 }) },
    { id: "about", label: "Giới thiệu", icon: Icon.home({ size: 16 }) },
  ];

  return (
    <div className="ns-content">
      <PageHeader title="Cài đặt" subtitle="Tài khoản AI, giọng đọc và tuỳ chọn dựng video." />
      <div className="ns-settings">
        <nav className="ns-settings-nav">
          {TABS.map((t) => (
            <button key={t.id} className={`ns-settings-tab${tab === t.id ? " active" : ""}`} onClick={() => setTab(t.id)}>
              {t.icon}
              {t.label}
            </button>
          ))}
        </nav>

        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          {tab === "ai" && (
            <SettingsCard title="Tài khoản AI & model" desc="Kết nối tài khoản qua 9Router và chọn model dùng để dựng video.">
              {gateway.kind === "starting" && <p style={{ color: "var(--muted-foreground)", margin: 0 }}>Đang khởi động dịch vụ AI…</p>}
              {gateway.kind === "unavailable" && (
                <p style={{ color: "var(--danger)", margin: 0 }}>Không khởi động được 9Router. Hãy kiểm tra 9Router đã cài rồi mở lại app.</p>
              )}
              {gateway.kind === "ready" && (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: connected.length ? "var(--good)" : "var(--warn)", flexShrink: 0 }} />
                    <span style={{ fontSize: 14, color: "var(--foreground)" }}>
                      {connected.length ? `Đang dùng: ${currentAccount?.label ?? "Đã kết nối"}` : "Chưa có tài khoản nào."}
                    </span>
                  </div>
                  <button className="ns-btn ns-btn-primary" onClick={onManageAccounts}>
                    {Icon.spark({ size: 15 })} {connected.length ? "Thêm / quản lý tài khoản" : "Đăng nhập tài khoản AI"}
                  </button>
                  {connected.length > 0 && (
                    <div style={{ marginTop: 20 }}>
                      <Field label="Model dùng để dựng" hint="Model có khả năng nhìn ảnh sẽ tự soát & sửa lỗi bố cục tốt hơn.">
                        <select className="ns-input" aria-label="Chọn model dựng video" value={selectedModelId} onChange={(e) => onSelectModel(e.target.value)} style={{ width: "100%", maxWidth: 420 }}>
                          <option value="" disabled>— chọn model —</option>
                          {models.map((m) => (<option key={m.id} value={m.id}>{m.id}</option>))}
                        </select>
                      </Field>
                    </div>
                  )}
                </>
              )}
            </SettingsCard>
          )}

          {tab === "voice" && (
            <SettingsCard title="Giọng đọc" desc="Cấu hình giọng đọc Vivibe. Bỏ trống sẽ dùng cấu hình trong file .env (nếu có).">
              <Field label="Nhà cung cấp giọng">
                <input className="ns-input" value={settings.voiceProvider} disabled style={{ width: "100%", maxWidth: 260, opacity: 0.7 }} />
              </Field>
              <Field label="API key giọng đọc (Vivibe)">
                <input className="ns-input" type="password" placeholder="dán API key…" value={settings.voiceApiKey ?? ""}
                  onChange={(e) => onUpdate({ voiceApiKey: e.target.value })} style={{ width: "100%", maxWidth: 480 }} />
              </Field>
              <Field label="Voice ID" hint="Mã giọng đọc cụ thể trên Vivibe.">
                <input className="ns-input" placeholder="voice id…" value={settings.voiceId ?? ""}
                  onChange={(e) => onUpdate({ voiceId: e.target.value })} style={{ width: "100%", maxWidth: 480 }} />
              </Field>
            </SettingsCard>
          )}

          {tab === "build" && (
            <SettingsCard title="Dựng video" desc="Kiểm soát quy trình tự dựng và tự sửa lỗi.">
              <Field label="Số lần tự sửa tối đa" hint="Số lần AI được thử dựng lại để khắc phục lỗi trước khi báo cần can thiệp (1–10).">
                <input className="ns-input" type="number" min={1} max={10} value={settings.maxRepairAttempts}
                  onChange={(e) => onUpdate({ maxRepairAttempts: Math.min(10, Math.max(1, Number(e.target.value) || 1)) })} style={{ width: 100 }} />
              </Field>
              <Toggle checked={settings.scriptGateEnabled} onChange={(v) => onUpdate({ scriptGateEnabled: v })}
                title="Duyệt kịch bản trước khi dựng" desc="Tạm dừng để bạn xem & sửa lời đọc trước khi tốn công dựng video." />
              <Toggle checked={settings.visualQaEnabled} onChange={(v) => onUpdate({ visualQaEnabled: v })}
                title="AI tự soát & sửa lỗi hình ảnh trước khi duyệt"
                desc="AI xem ảnh từng cảnh để bắt lỗi bố cục (đè chữ, tràn, lệch) và tự sửa — cần model nhìn được ảnh; nếu không sẽ tự bỏ qua." />
              <Toggle checked={settings.imageCrawlAiFilter} onChange={(v) => onUpdate({ imageCrawlAiFilter: v })}
                title="AI tự chọn ảnh từ bài báo"
                desc="Khi yêu cầu có đường dẫn, AI xem các ảnh cào được từ bài và chọn sẵn ảnh phù hợp nội dung — cần model nhìn được ảnh." />
              <Toggle checked={settings.imageCrawlHumanReview} onChange={(v) => onUpdate({ imageCrawlHumanReview: v })}
                title="Cho tôi duyệt ảnh trước khi dựng"
                desc="Hiện màn chọn ảnh cào từ bài báo để bạn xác nhận trước khi AI viết kịch bản. Tắt thì dùng luôn lựa chọn của AI." />
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14, marginTop: 4 }}>
                <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>Thư mục lưu dự án</span>
                <p style={{ margin: "4px 0 0", fontSize: 13, fontFamily: "var(--font-mono, monospace)", color: "var(--foreground)", wordBreak: "break-all" }}>{settings.outputDir || "(mặc định)"}</p>
              </div>
            </SettingsCard>
          )}

          {tab === "about" && (
            <SettingsCard title="Giới thiệu" desc="News Studio — xưởng dựng video tin tức ngắn 9:16 bằng AI.">
              <Field label="Phiên bản">
                <span style={{ fontSize: 14 }}>News Studio 0.1.0</span>
              </Field>
              <Field label="Dịch vụ AI" hint="Đăng nhập tài khoản nhà cung cấp được uỷ quyền cho 9Router; News Studio không lưu mật khẩu của bạn.">
                <span style={{ fontSize: 14 }}>9Router · localhost:20128</span>
              </Field>
              <p style={{ margin: 0, fontSize: 12, color: "var(--muted-foreground)", lineHeight: 1.6 }}>
                Bản dev dùng mã kích hoạt <strong style={{ color: "var(--foreground)" }}>123</strong>. Mọi dự án &amp; bản dựng lưu cục bộ trong thư mục dự án.
              </p>
            </SettingsCard>
          )}
        </div>
      </div>
    </div>
  );
};
