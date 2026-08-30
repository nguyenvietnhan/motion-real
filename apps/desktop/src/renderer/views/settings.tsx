import React, { useEffect, useRef, useState } from "react";
import type {
  AiAccountState,
  DesktopReadinessReport,
  GatewayState,
  ModelInfo,
  ReviewMode,
  SettingsModel,
  SettingsUpdateInput,
  VoiceProviderChoice,
  VoiceTestResult,
} from "../../shared/types.js";
import { DEFAULT_REFINE_PASSES, FULL_AUTO_SETTINGS_PATCH } from "../../shared/settings-model.js";
import { activeAccount } from "../../shared/active-account.js";
import { Icon } from "../icons.js";
import { ChoiceGroup, CustomSelect, ExpandableToggle, Field, InfoHint, InfoRow, NumberRow, PageHeader, SettingsCard, StableButtonLabel, Toggle } from "../primitives.js";
import { compactNotificationMessage, errorDetails, useNotifications } from "../notifications.js";
import { VIENEU_VOICES } from "@motionreal/tts/vieneu-presets";

export type SettingsTab = "ai" | "voice" | "build" | "about";

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
  onUpdate: (patch: SettingsUpdateInput) => void | Promise<unknown>;
  onSetApiKey: (provider: VoiceProviderChoice, apiKey: string) => Promise<SettingsModel>;
  onClearApiKey: (provider: VoiceProviderChoice) => Promise<SettingsModel>;
  onTestVoice: (provider: VoiceProviderChoice) => Promise<VoiceTestResult>;
  onCheckReadiness?: () => Promise<DesktopReadinessReport>;
  /** Controlled tab (App owns deep-links from Home create-path checklist). */
  tab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
}> = ({
  gateway,
  account,
  models,
  settings,
  preferredModelUnavailable,
  onManageAccounts,
  onSelectModel,
  onUpdate,
  onSetApiKey,
  onClearApiKey,
  onTestVoice,
  onCheckReadiness,
  tab,
  onTabChange,
}) => {
  // Sub-settings start collapsed (same as Mức duyệt); user opens the chevron.
  const [refineExpanded, setRefineExpanded] = useState(false);
  const [reviewModeExpanded, setReviewModeExpanded] = useState(false);
  const [showVoiceKey, setShowVoiceKey] = useState(false);
  const [voiceKeyInput, setVoiceKeyInput] = useState("");
  const [voiceTesting, setVoiceTesting] = useState(false);
  const [voiceSample, setVoiceSample] = useState<string | null>(null);
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
  const voiceId = voiceProvider === "vivibe"
    ? settings.vivibeVoiceId ?? ""
    : voiceProvider === "vieneu" ? settings.vieneuVoiceId ?? "Trúc Ly" : settings.elevenLabsVoiceId ?? "";
  const credentialState = voiceProvider === "vieneu" ? "not-required" : settings.voiceCredentials[voiceProvider];

  useEffect(() => {
    setVoiceSample(null);
  }, [voiceProvider, voiceId]);

  const TABS: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: "ai", label: "Tài khoản AI", icon: Icon.spark({ size: 16 }) },
    { id: "voice", label: "Giọng đọc", icon: Icon.film({ size: 16 }) },
    { id: "build", label: "Dựng video", icon: Icon.settings({ size: 16 }) },
    { id: "about", label: "Giới thiệu", icon: Icon.home({ size: 16 }) },
  ];

  const update = (patch: SettingsUpdateInput): void => {
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

  const testVoice = (): void => {
    if (voiceTesting) return;
    setVoiceTesting(true);
    setVoiceSample(null);
    void onTestVoice(voiceProvider)
      .then((result) => {
        if (!result.ok) {
          notify.error({ title: "Kiểm tra giọng thất bại", message: result.error, details: result.error });
          return;
        }
        setVoiceSample(result.audioDataUrl);
      })
      .catch((error: unknown) => {
        const details = errorDetails(error);
        notify.error({
          title: "Không kiểm tra được giọng",
          message: compactNotificationMessage(details, "Thử lại sau."),
          details,
        });
      })
      .finally(() => setVoiceTesting(false));
  };

  const saveStatus = saveState === "saving" ? "Đang lưu…" : "";

  return (
    <div className="ns-content">
      <PageHeader
        title="Cài đặt"
        action={
          <span className={`ns-settings-save is-${saveState}`} role="status">
            <StableButtonLabel reserve="Đang lưu…">{saveStatus}</StableButtonLabel>
          </span>
        }
      />
      <div className="ns-settings">
        <nav className="ns-settings-nav">
          {TABS.map((t) => (
            <button key={t.id} className={`ns-settings-tab${tab === t.id ? " active" : ""}`} onClick={() => onTabChange(t.id)}>
              {t.icon}
              {t.label}
            </button>
          ))}
        </nav>

        <div className="ns-settings-main">
          {tab === "ai" && (
            <SettingsCard title="Tài khoản AI">
              {gateway.kind === "starting" && <p style={{ color: "var(--muted-foreground)", margin: 0 }}>Đang khởi động dịch vụ AI…</p>}
              {gateway.kind === "unavailable" && (
                <p style={{ color: "var(--danger)", margin: 0 }}>Không khởi động được 9Router. Kiểm tra rồi mở lại app.</p>
              )}
              {gateway.kind === "ready" && connected.length === 0 && (
                <>
                  <p style={{ margin: "0 0 16px", fontSize: 14, color: "var(--muted-foreground)" }}>
                    Chưa có tài khoản. Đăng nhập qua 9Router để kết nối AI.
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
                    <Field htmlFor="ai-model" label="Model" hint="Model nhìn ảnh sẽ tinh chỉnh bố cục tốt hơn.">
                      <CustomSelect
                        id="ai-model"
                        value={selectedModelId}
                        onChange={onSelectModel}
                        options={models.map((m) => ({ value: m.id, label: m.id }))}
                        placeholder="Chọn model"
                        style={{ width: "100%", maxWidth: 280 }}
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
                    <StableButtonLabel reserve={["Đang kiểm tra…", "Kiểm tra"]}>
                      {readinessLoading ? "Đang kiểm tra…" : "Kiểm tra"}
                    </StableButtonLabel>
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
              <Field htmlFor="voice-provider" label="Nhà cung cấp giọng">
                <CustomSelect
                  id="voice-provider"
                  value={voiceProvider}
                  onChange={(val) => update({ voiceProvider: val as VoiceProviderChoice })}
                  options={[
                    { value: "vivibe", label: "Vivibe" },
                    { value: "elevenlabs", label: "ElevenLabs" },
                    { value: "vieneu", label: "VieNeu Local" },
                  ]}
                  style={{ width: "100%", maxWidth: 180 }}
                />
              </Field>
              {voiceProvider !== "vieneu" && <Field htmlFor="voice-api-key" label={`API key ${voiceProvider === "vivibe" ? "Vivibe" : "ElevenLabs"}`} hint={`Trạng thái: ${credentialState === "saved" ? "đã lưu an toàn" : credentialState === "environment" ? "đang dùng từ .env" : "chưa cấu hình"}.`}>
                <div className="ns-secret-field">
                  <input id="voice-api-key" className="ns-input" type={showVoiceKey ? "text" : "password"} placeholder={credentialState === "missing" ? "dán API key…" : "nhập key mới để thay thế…"} value={voiceKeyInput}
                    onChange={(e) => setVoiceKeyInput(e.target.value)} />
                  <button type="button" className="ns-secret-toggle" onClick={() => setShowVoiceKey((v) => !v)}>
                    <StableButtonLabel reserve={["Ẩn", "Hiện"]}>{showVoiceKey ? "Ẩn" : "Hiện"}</StableButtonLabel>
                  </button>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button className="ns-btn" disabled={!voiceKeyInput.trim()} onClick={saveVoiceKey}>Lưu API key</button>
                  {credentialState === "saved" && <button className="ns-btn" onClick={clearVoiceKey}>Xóa key đã lưu</button>}
                </div>
              </Field>}
              <Field
                htmlFor="voice-id"
                label={voiceProvider === "vieneu" ? "Giọng VieNeu" : "Voice ID"}
                hint={voiceProvider === "vieneu"
                  ? "Chạy local bằng VieNeu 3.3.0 ONNX; lần đầu có thể mất thời gian chuẩn bị model."
                  : voiceProvider === "vivibe"
                  ? "Nghe thử và lấy Voice ID trên trang Vivibe, sau đó dán vào đây."
                  : "Nghe thử và lấy Voice ID trên trang ElevenLabs. Một số library voice yêu cầu gói trả phí để dùng qua API."}
              >
                {voiceProvider === "vieneu" ? (
                  <CustomSelect id="voice-id" value={voiceId} onChange={(value) => update({ vieneuVoiceId: value })}
                    options={VIENEU_VOICES.map(([value, description]) => ({ value, label: `${value} — ${description}` }))}
                    style={{ width: "100%", maxWidth: 480 }} />
                ) : (
                  <input id="voice-id" className="ns-input" placeholder="voice id…" value={voiceId}
                    onChange={(e) => update(voiceProvider === "vivibe" ? { vivibeVoiceId: e.target.value } : { elevenLabsVoiceId: e.target.value })} style={{ width: "100%", maxWidth: 480 }} />
                )}
              </Field>
              {voiceProvider === "elevenlabs" && <Field htmlFor="elevenlabs-model" label="Model ElevenLabs" hint="Model mặc định của phiên bản này."><input id="elevenlabs-model" className="ns-input" value={settings.elevenLabsModelId} disabled style={{ width: "100%", maxWidth: 480, opacity: 0.7 }} /></Field>}
              <div style={{ display: "grid", gap: 8, justifyItems: "start" }}>
                <button
                  type="button"
                  className="ns-btn ns-btn-primary"
                  disabled={voiceTesting || credentialState === "missing" || !voiceId.trim()}
                  onClick={testVoice}
                >
                  <StableButtonLabel reserve={["Đang kiểm tra…", "Kiểm tra giọng đọc"]}>
                    {voiceTesting ? "Đang kiểm tra…" : "Kiểm tra giọng đọc"}
                  </StableButtonLabel>
                </button>
                <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
                  {voiceProvider === "vieneu"
                    ? "Tạo một câu ngắn trên máy để kiểm tra runtime, preset và âm thanh; không tốn API credit."
                    : "Tạo một câu rất ngắn để kiểm tra key, Voice ID, credit và âm thanh; có thể tốn một lượng credit nhỏ."}
                </span>
                {voiceSample ? (
                  <audio
                    controls
                    src={voiceSample}
                    aria-label="Bản nghe thử giọng đọc"
                    onError={() => {
                      setVoiceSample(null);
                      notify.error({ title: "Không phát được bản thử", message: "Nhà cung cấp đã trả về tệp âm thanh không đọc được." });
                    }}
                  />
                ) : null}
              </div>
            </SettingsCard>
          )}

          {tab === "build" && (
            <SettingsCard title="Dựng video">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, paddingBottom: 12 }}>
                <span style={{ fontSize: 13, color: "var(--muted-foreground)" }}>Preset cho hàng đợi chạy không cần duyệt tay.</span>
                <button type="button" className="ns-btn" onClick={() => update(FULL_AUTO_SETTINGS_PATCH)}>Áp dụng Full auto</button>
              </div>
              <div className="ns-settings-group">
                <div className="ns-settings-group-label">Trước dựng</div>
                <Toggle checked={settings.scriptGateEnabled} onChange={(v) => update({ scriptGateEnabled: v })}
                  title="Duyệt kịch bản"
                  desc="Xem và sửa lời trước khi dựng." />
                <Toggle
                  checked={settings.imageCrawlHumanReview}
                  onChange={(v) => update({ imageCrawlHumanReview: v })}
                  title="Duyệt ảnh từ link"
                  desc="Xác nhận ảnh cào từ link trước khi viết. Tắt để bỏ qua bước này."
                />
              </div>
              <div className="ns-settings-group">
                <div className="ns-settings-group-label">Sau dựng</div>
                <ChoiceGroup
                  name="reviewMode"
                  title="Mức duyệt"
                  desc="Chọn điểm dừng duyệt, hoặc xuất full tự động."
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
                      desc: "Tinh chỉnh ngầm nếu bật, rồi xuất full. Chọn nhạc trên màn tạo.",
                    },
                  ]}
                />
              </div>
              <div className="ns-settings-group">
                <div className="ns-settings-group-label">Tinh chỉnh</div>
                <NumberRow
                  value={settings.maxRepairAttempts}
                  min={1}
                  max={10}
                  onChange={(v) => update({ maxRepairAttempts: v })}
                  title="Số lần sửa lỗi"
                  desc="Giới hạn số lượt AI sửa lỗi nội dung/render."
                />
                <ExpandableToggle
                  checked={settings.refinePasses > 0}
                  onChange={(v) => {
                    update({ refinePasses: v ? DEFAULT_REFINE_PASSES : 0 });
                    // Keep sub-rows collapsed unless the user opens the chevron.
                    if (!v) setRefineExpanded(false);
                  }}
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
                  desc="Chọn ảnh phù hợp từ bài báo trước. Cần model nhìn ảnh." />
              </div>
              <div className="ns-settings-group">
                <div className="ns-settings-group-label">Kiểm tra</div>
                <Toggle
                  checked={settings.smokeRenderEnabled}
                  onChange={(v) => update({ smokeRenderEnabled: v })}
                  title="Render smoke"
                  desc="Hiện nút smoke cạnh prompt (Home: chạy ngay; Hàng đợi: chỉ thêm vào list)."
                />
              </div>
            </SettingsCard>
          )}

          {tab === "about" && (
            <SettingsCard title="Giới thiệu">
              <InfoRow label="Phiên bản" value="Motion Real 0.1.0" />
              <InfoRow label="Dịch vụ AI" value="9Router · localhost:20128"
                hint="Đăng nhập qua 9Router. App không lưu mật khẩu." />
              <InfoRow label="Thư mục dự án" value={settings.outputDir || "(mặc định)"} mono />
            </SettingsCard>
          )}
        </div>
      </div>
    </div>
  );
};
