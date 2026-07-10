import React, { useRef, useState } from "react";
import type {
  AiAccountState,
  DesktopReadinessReport,
  GatewayState,
  ModelInfo,
  ReviewMode,
  SettingsModel,
  VoiceProviderChoice,
} from "../../shared/types.js";
import { DEFAULT_REFINE_PASSES } from "../../shared/settings-model.js";
import { activeAccount } from "../../shared/active-account.js";
import { Icon } from "../icons.js";
import { ChoiceGroup, ExpandableToggle, Field, InfoHint, InfoRow, NumberRow, PageHeader, SettingsCard, Toggle } from "../primitives.js";
import { compactNotificationMessage, errorDetails, useNotifications } from "../notifications.js";

type SettingsTab = "ai" | "voice" | "build" | "about";

interface CustomSelectOption {
  value: string;
  label: string;
}

interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: CustomSelectOption[];
  placeholder?: string;
  style?: React.CSSProperties;
}

const CustomSelect: React.FC<CustomSelectProps> = ({ value, onChange, options, placeholder, style }) => {
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const selectedOption = options.find((opt) => opt.value === value);

  return (
    <div ref={containerRef} className="ns-custom-select-container" style={{ position: "relative", ...style }}>
      <button
        type="button"
        className={`ns-input ns-custom-select-trigger${open ? " is-open" : ""}`}
        onClick={() => setOpen(!open)}
        style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", justifyContent: "space-between" }}
      >
        <span>{selectedOption ? selectedOption.label : placeholder || "Chọn..."}</span>
      </button>

      {open && (
        <div
          className="ns-custom-select-dropdown"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            width: "100%",
            zIndex: 100,
            maxHeight: "260px",
            overflowY: "auto"
          }}
        >
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`ns-custom-select-option${opt.value === value ? " is-active" : ""}`}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              style={{ width: "100%", textAlign: "left", display: "block" }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/** Enterprise tabbed settings: AI account / voice / video build / about. */
export const SettingsView: React.FC<{
  gateway: GatewayState;
  account: AiAccountState;
  models: ModelInfo[];
  settings: SettingsModel;
  /** Saved preference is no longer in the gateway list — ask the user to pick a replacement. */
  preferredModelUnavailable?: string;
  onManageAccounts: () => void;
  onSelectModel: (modelId: string) => void;
  onUpdate: (patch: Partial<SettingsModel>) => void | Promise<unknown>;
  onSetApiKey: (provider: VoiceProviderChoice, apiKey: string) => Promise<SettingsModel>;
  onClearApiKey: (provider: VoiceProviderChoice) => Promise<SettingsModel>;
  onCheckReadiness?: () => Promise<DesktopReadinessReport>;
}> = ({ gateway, account, models, settings, preferredModelUnavailable, onManageAccounts, onSelectModel, onUpdate, onSetApiKey, onClearApiKey, onCheckReadiness }) => {
  const [tab, setTab] = useState<SettingsTab>("ai");
  const [refineExpanded, setRefineExpanded] = useState(settings.refinePasses > 0);
  const [reviewModeExpanded, setReviewModeExpanded] = useState(false);
  const [showVoiceKey, setShowVoiceKey] = useState(false);
  const [voiceKeyInput, setVoiceKeyInput] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "error">("idle");
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [readiness, setReadiness] = useState<DesktopReadinessReport | null>(null);
  const saveSeq = useRef(0);
  const notify = useNotifications();
  const connected = account.kind === "connected" ? account.accounts : [];
  const currentAccount = activeAccount(account);
  const selectedModelId = account.kind === "connected" ? account.selectedModel?.id ?? "" : "";
  const accountInitial = (currentAccount?.label ?? "?").trim().charAt(0).toUpperCase() || "?";
  // The avatar's presence dot mirrors the sidebar's AI-status dot: while the
  // gateway is ready and an account is connected, 9router is routing → green.
  // (Same signal `aiStatus` uses for the sidebar, so the two never disagree.)
  const accountLive = gateway.kind === "ready" && connected.length > 0;
  const voiceProvider = settings.voiceProvider;
  const voiceId = voiceProvider === "vivibe" ? settings.vivibeVoiceId ?? "" : settings.elevenLabsVoiceId ?? "";
  const credentialState = settings.voiceCredentials[voiceProvider];

  const TABS: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: "ai", label: "Tài khoản AI", icon: Icon.spark({ size: 16 }) },
    { id: "voice", label: "Giọng đọc", icon: Icon.film({ size: 16 }) },
    { id: "build", label: "Dựng video", icon: Icon.settings({ size: 16 }) },
    { id: "about", label: "Giới thiệu", icon: Icon.home({ size: 16 }) },
  ];

  const update = (patch: Partial<SettingsModel>): void => {
    const seq = saveSeq.current + 1;
    saveSeq.current = seq;
    setSaveState("saving");
    void Promise.resolve(onUpdate(patch))
      .then(() => { if (saveSeq.current === seq) setSaveState("idle"); })
      .catch((error: unknown) => {
        if (saveSeq.current !== seq) return;
        const details = errorDetails(error);
        setSaveState("error");
        notify.error({
          title: "Không lưu được cài đặt",
          message: compactNotificationMessage(details, "Thay đổi chưa được lưu."),
          details,
        });
      });
  };

  const saveVoiceKey = (): void => {
    const provider = voiceProvider;
    const apiKey = voiceKeyInput;
    void onSetApiKey(provider, apiKey)
      .then(() => setVoiceKeyInput(""))
      .catch((error: unknown) => {
        const details = errorDetails(error);
        notify.error({
          title: "Không lưu được API key",
          message: compactNotificationMessage(details, "Kiểm tra key rồi thử lại."),
          details,
        });
      });
  };

  const clearVoiceKey = (): void => {
    const provider = voiceProvider;
    void onClearApiKey(provider).catch((error: unknown) => {
      const details = errorDetails(error);
      notify.error({
        title: "Không xóa được API key",
        message: compactNotificationMessage(details, "Thử lại sau."),
        details,
      });
    });
  };

  const saveStatus = saveState === "saving" ? "Đang lưu…" : "";

  return (
    <div className="ns-content">
      <PageHeader
        title="Cài đặt"
        action={saveStatus && <span className={`ns-settings-save is-${saveState}`} role="status">{saveStatus}</span>}
      />
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
            <SettingsCard title="Tài khoản AI">
              {gateway.kind === "starting" && <p style={{ color: "var(--muted-foreground)", margin: 0 }}>Đang khởi động dịch vụ AI…</p>}
              {gateway.kind === "unavailable" && (
                <p style={{ color: "var(--danger)", margin: 0 }}>Không khởi động được 9Router. Kiểm tra cài đặt rồi mở lại app.</p>
              )}
              {gateway.kind === "ready" && connected.length === 0 && (
                <>
                  <p style={{ margin: "0 0 16px", fontSize: 14, color: "var(--muted-foreground)" }}>
                    Chưa có tài khoản nào. Đăng nhập để 9Router định tuyến yêu cầu tới nhà cung cấp AI.
                  </p>
                  <button className="ns-btn ns-btn-primary" onClick={onManageAccounts}>
                    {Icon.spark({ size: 15 })} Đăng nhập
                  </button>
                </>
              )}
              {gateway.kind === "ready" && connected.length > 0 && (
                <>
                  <div className="ns-acct">
                    <span className="ns-acct-avatar">
                      <span className="ns-avatar-initial">{accountInitial}</span>
                      <span className={`ns-acct-status${accountLive ? " is-live" : ""}`} title={accountLive ? "Đang hoạt động" : "Không hoạt động"} />
                    </span>
                    <span className="ns-acct-main">
                      <span className="ns-acct-label" title={currentAccount?.label}>{currentAccount?.label ?? "Đã kết nối"}</span>
                    </span>
                    <button className="ns-btn ns-acct-manage" onClick={onManageAccounts}>Quản lý</button>
                  </div>
                  <div style={{ marginTop: 20 }}>
                    <Field label="Model" hint="Model nhìn ảnh sẽ tinh chỉnh bố cục tốt hơn.">
                      <CustomSelect
                        value={selectedModelId}
                        onChange={onSelectModel}
                        options={models.map((m) => ({ value: m.id, label: m.id }))}
                        placeholder="Chọn model"
                        style={{ width: "100%", maxWidth: 460 }}
                      />
                    </Field>
                    {preferredModelUnavailable && (
                      <p style={{ color: "var(--danger)", margin: "12px 0 0", fontSize: 13 }} role="status">
                        Model đã lưu <strong>{preferredModelUnavailable}</strong> không còn trong danh sách hiện tại.
                        Chọn model khác — app sẽ không tự đổi sang model đầu danh sách.
                      </p>
                    )}
                  </div>
                </>
              )}
              <div style={{ marginTop: connected.length > 0 || gateway.kind !== "ready" ? 20 : 0, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="ns-btn ns-btn-primary"
                    disabled={readinessLoading || !onCheckReadiness}
                    onClick={() => {
                      if (!onCheckReadiness) return;
                      setReadinessLoading(true);
                      void onCheckReadiness()
                        .then((report) => setReadiness(report))
                        .catch((error: unknown) => {
                          const details = errorDetails(error);
                          notify.error({
                            title: "Không kiểm tra được",
                            message: compactNotificationMessage(details, "Thử lại sau."),
                            details,
                          });
                        })
                        .finally(() => setReadinessLoading(false));
                    }}
                  >
                    {readinessLoading ? "Đang kiểm tra…" : "Kiểm tra"}
                  </button>
                  <InfoHint text="Kiểm tra cổng AI, giọng đọc và công cụ render trên máy. Không gọi model hay TTS." />
                </div>
                {readiness && (
                  <ul
                    className="ns-readiness-list"
                    style={{
                      margin: "12px 0 0",
                      padding: 0,
                      listStyle: "none",
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                      gap: "6px 12px",
                    }}
                    role="list"
                    aria-label="Kết quả kiểm tra sẵn sàng"
                  >
                    {readiness.checks.map((c) => {
                      const tone =
                        c.state === "ready"
                          ? "var(--good, #16a34a)"
                          : c.state === "warning"
                            ? "var(--warn, #ca8a04)"
                            : "var(--danger)";
                      const statusWord =
                        c.state === "ready" ? "sẵn sàng" : c.state === "warning" ? "cảnh báo" : "chặn";
                      const tip = [c.detail, c.remediation].filter(Boolean).join(" — ");
                      return (
                        <li
                          key={c.id}
                          title={tip || undefined}
                          aria-label={`${c.label}: ${statusWord}${tip ? `. ${tip}` : ""}`}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            minWidth: 0,
                            fontSize: 13,
                          }}
                        >
                          <span style={{ color: tone, display: "inline-flex", flexShrink: 0 }} aria-hidden>
                            {c.state === "ready"
                              ? Icon.check({ size: 14 })
                              : c.state === "warning"
                                ? Icon.warn({ size: 14 })
                                : Icon.close({ size: 14 })}
                          </span>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {c.label}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </SettingsCard>
          )}

          {tab === "voice" && (
            <SettingsCard title="Giọng đọc">
              <Field label="Nhà cung cấp giọng">
                <CustomSelect
                  value={voiceProvider}
                  onChange={(val) => update({ voiceProvider: val as VoiceProviderChoice })}
                  options={[
                    { value: "vivibe", label: "Vivibe" },
                    { value: "elevenlabs", label: "ElevenLabs" }
                  ]}
                  style={{ width: "100%", maxWidth: 180 }}
                />
              </Field>
              <Field label={`API key ${voiceProvider === "vivibe" ? "Vivibe" : "ElevenLabs"}`} hint={`Trạng thái: ${credentialState === "saved" ? "đã lưu an toàn" : credentialState === "environment" ? "đang dùng từ .env" : "chưa cấu hình"}.`}>
                <div className="ns-secret-field">
                  <input className="ns-input" type={showVoiceKey ? "text" : "password"} placeholder={credentialState === "missing" ? "dán API key…" : "nhập key mới để thay thế…"} value={voiceKeyInput}
                    onChange={(e) => setVoiceKeyInput(e.target.value)} />
                  <button type="button" className="ns-secret-toggle" onClick={() => setShowVoiceKey((v) => !v)}>
                    {showVoiceKey ? "Ẩn" : "Hiện"}
                  </button>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button className="ns-btn" disabled={!voiceKeyInput.trim()} onClick={saveVoiceKey}>Lưu API key</button>
                  {credentialState === "saved" && <button className="ns-btn" onClick={clearVoiceKey}>Xóa key đã lưu</button>}
                </div>
              </Field>
              <Field
                label="Voice ID"
                hint={voiceProvider === "vivibe"
                  ? "Nghe thử và lấy Voice ID trên trang Vivibe, sau đó dán vào đây."
                  : "Nghe thử và lấy Voice ID trên trang ElevenLabs. Một số library voice yêu cầu gói trả phí để dùng qua API."}
              >
                <input className="ns-input" placeholder="voice id…" value={voiceId}
                  onChange={(e) => update(voiceProvider === "vivibe" ? { vivibeVoiceId: e.target.value } : { elevenLabsVoiceId: e.target.value })} style={{ width: "100%", maxWidth: 480 }} />
              </Field>
              {voiceProvider === "elevenlabs" && <Field label="Model ElevenLabs" hint="Model mặc định của phiên bản này."><input className="ns-input" value={settings.elevenLabsModelId} disabled style={{ width: "100%", maxWidth: 480, opacity: 0.7 }} /></Field>}
            </SettingsCard>
          )}

          {tab === "build" && (
            <SettingsCard title="Dựng video">
              <div className="ns-settings-group">
                <div className="ns-settings-group-label">Trước dựng</div>
                <Toggle checked={settings.scriptGateEnabled} onChange={(v) => update({ scriptGateEnabled: v })}
                  title="Duyệt kịch bản"
                  desc="Xem và sửa lời trước khi dựng." />
              </div>
              <div className="ns-settings-group">
                <div className="ns-settings-group-label">Sau dựng</div>
                <ChoiceGroup
                  name="reviewMode"
                  title="Mức duyệt"
                  desc="Dừng lại trước khi xuất bản full."
                  value={settings.reviewMode}
                  onChange={(v) => update({ reviewMode: v as ReviewMode })}
                  expanded={reviewModeExpanded}
                  onToggleExpanded={() => setReviewModeExpanded((e) => !e)}
                  options={[
                    {
                      value: "full",
                      title: "Video nháp rồi chỉnh",
                      desc: "Có nháp và form chỉnh cảnh. Mặc định.",
                    },
                    {
                      value: "stills_edit",
                      title: "Ảnh cảnh rồi chỉnh",
                      desc: "Chỉ ảnh từng cảnh. Vẫn chỉnh được.",
                    },
                    {
                      value: "skip_edit",
                      title: "Bỏ qua chỉnh",
                      desc: "Tinh chỉnh ngầm nếu bật, rồi xuất full.",
                    },
                  ]}
                />
              </div>
              <div className="ns-settings-group">
                <div className="ns-settings-group-label">Tinh chỉnh</div>
                <ExpandableToggle
                  checked={settings.refinePasses > 0}
                  onChange={(v) => { update({ refinePasses: v ? DEFAULT_REFINE_PASSES : 0 }); if (v) setRefineExpanded(true); }}
                  expanded={refineExpanded}
                  onToggleExpanded={() => setRefineExpanded((e) => !e)}
                  title="Tinh chỉnh ảnh AI"
                  desc="AI xem ảnh cảnh và sửa bố cục. Cần model nhìn ảnh.">
                  {settings.refinePasses > 0 && (
                    <>
                      <NumberRow value={settings.refinePasses} min={1} max={5} indent
                        onChange={(v) => update({ refinePasses: v })}
                        title="Số lần"
                        desc="Số lượt tối đa." />
                      <Toggle checked={settings.refineEarlyStop} onChange={(v) => update({ refineEarlyStop: v })} indent
                        title="Dừng sớm"
                        desc="Dừng khi hai lượt liên tiếp ổn." />
                    </>
                  )}
                </ExpandableToggle>
              </div>
              <div className="ns-settings-group">
                <div className="ns-settings-group-label">Ảnh</div>
                <Toggle checked={settings.imageCrawlAiFilter} onChange={(v) => update({ imageCrawlAiFilter: v })}
                  title="AI chọn ảnh link"
                  desc="Chọn ảnh phù hợp từ bài báo. Cần model nhìn ảnh." />
                <Toggle checked={settings.imageCrawlHumanReview} onChange={(v) => update({ imageCrawlHumanReview: v })}
                  title="Duyệt ảnh trước"
                  desc="Bạn xác nhận ảnh trước khi viết kịch bản." />
              </div>
            </SettingsCard>
          )}

          {tab === "about" && (
            <SettingsCard title="Giới thiệu">
              <InfoRow label="Phiên bản" value="Motion Real 0.1.0" />
              <InfoRow label="Dịch vụ AI" value="9Router · localhost:20128"
                hint="Đăng nhập qua 9Router. App không lưu mật khẩu." />
              <InfoRow label="Mã kích hoạt (dev)" value="123" />
              <InfoRow label="Thư mục dự án" value={settings.outputDir || "(mặc định)"} mono />
            </SettingsCard>
          )}
        </div>
      </div>
    </div>
  );
};
