import React, { useEffect, useRef, useState } from "react";
import type { AiAccountState, GatewayState, ModelInfo, SettingsModel, TtsVoiceVM, VoiceProviderChoice } from "../../shared/types.js";
import { DEFAULT_REFINE_PASSES } from "../../shared/settings-model.js";
import { activeAccount } from "../../shared/active-account.js";
import { Icon } from "../icons.js";
import { ExpandableToggle, Field, InfoRow, NumberRow, PageHeader, SettingsCard, Toggle } from "../primitives.js";

type SettingsTab = "ai" | "voice" | "build" | "about";

/** Enterprise tabbed settings: AI account / voice / video build / about. */
export const SettingsView: React.FC<{
  gateway: GatewayState;
  account: AiAccountState;
  models: ModelInfo[];
  settings: SettingsModel;
  onManageAccounts: () => void;
  onSelectModel: (modelId: string) => void;
  onUpdate: (patch: Partial<SettingsModel>) => void | Promise<unknown>;
  onSetApiKey: (provider: VoiceProviderChoice, apiKey: string) => Promise<SettingsModel>;
  onClearApiKey: (provider: VoiceProviderChoice) => Promise<SettingsModel>;
  onListVoices: (provider: VoiceProviderChoice) => Promise<TtsVoiceVM[]>;
}> = ({ gateway, account, models, settings, onManageAccounts, onSelectModel, onUpdate, onSetApiKey, onClearApiKey, onListVoices }) => {
  const [tab, setTab] = useState<SettingsTab>("ai");
  const [refineExpanded, setRefineExpanded] = useState(settings.refinePasses > 0);
  const [showVoiceKey, setShowVoiceKey] = useState(false);
  const [voiceKeyInput, setVoiceKeyInput] = useState("");
  const [voices, setVoices] = useState<TtsVoiceVM[]>([]);
  const [voiceLoad, setVoiceLoad] = useState<"idle" | "loading" | "error">("idle");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "error">("idle");
  const saveSeq = useRef(0);
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
  useEffect(() => {
    setVoiceKeyInput("");
    setVoices([]);
    setVoiceLoad("idle");
  }, [voiceProvider]);

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
      .catch(() => { if (saveSeq.current === seq) setSaveState("error"); });
  };

  const saveStatus = saveState === "saving" ? "Đang lưu…" : saveState === "error" ? "Không lưu được" : "";

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
            <SettingsCard title="Tài khoản AI & model" desc="Kết nối tài khoản qua 9Router và chọn model dùng để dựng video.">
              {gateway.kind === "starting" && <p style={{ color: "var(--muted-foreground)", margin: 0 }}>Đang khởi động dịch vụ AI…</p>}
              {gateway.kind === "unavailable" && (
                <p style={{ color: "var(--danger)", margin: 0 }}>Không khởi động được 9Router. Hãy kiểm tra 9Router đã cài rồi mở lại app.</p>
              )}
              {gateway.kind === "ready" && connected.length === 0 && (
                <>
                  <p style={{ margin: "0 0 16px", fontSize: 14, color: "var(--muted-foreground)" }}>
                    Chưa có tài khoản nào. Đăng nhập để 9Router định tuyến yêu cầu tới nhà cung cấp AI.
                  </p>
                  <button className="ns-btn ns-btn-primary" onClick={onManageAccounts}>
                    {Icon.spark({ size: 15 })} Đăng nhập tài khoản AI
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
                      {selectedModelId && <span className="ns-acct-model">{selectedModelId}</span>}
                    </span>
                    <button className="ns-btn ns-acct-manage" onClick={onManageAccounts}>Quản lý</button>
                  </div>
                  <div style={{ marginTop: 20 }}>
                    <Field label="Model dùng để dựng" hint="Model nhìn được ảnh sẽ tự soát và sửa lỗi bố cục tốt hơn.">
                      <select className="ns-input" aria-label="Chọn model dựng video" value={selectedModelId} onChange={(e) => onSelectModel(e.target.value)} style={{ width: "100%", maxWidth: 460 }}>
                        <option value="" disabled>— chọn model —</option>
                        {models.map((m) => (<option key={m.id} value={m.id}>{m.id}</option>))}
                      </select>
                    </Field>
                  </div>
                </>
              )}
            </SettingsCard>
          )}

          {tab === "voice" && (
            <SettingsCard title="Giọng đọc" desc="Cấu hình riêng từng nhà cung cấp. Lựa chọn này là mặc định cho dự án mới.">
              <Field label="Nhà cung cấp giọng">
                <select className="ns-input" value={voiceProvider} onChange={(e) => update({ voiceProvider: e.target.value as VoiceProviderChoice })} style={{ width: "100%", maxWidth: 320 }}>
                  <option value="vivibe">Vivibe - chỉ hỗ trợ tiếng Việt</option>
                  <option value="elevenlabs">ElevenLabs</option>
                </select>
              </Field>
              <p style={{ margin: 0, color: "var(--muted-foreground)", fontSize: 13 }}>
                {voiceProvider === "vivibe"
                  ? "Vivibe chỉ hỗ trợ tiếng Việt."
                  : "ElevenLabs hỗ trợ đa ngôn ngữ; News Studio hiện vẫn tạo lời đọc tiếng Việt."}
              </p>
              <Field label={`API key ${voiceProvider === "vivibe" ? "Vivibe" : "ElevenLabs"}`} hint={`Trạng thái: ${credentialState === "saved" ? "đã lưu an toàn" : credentialState === "environment" ? "đang dùng từ .env" : "chưa cấu hình"}.`}>
                <div className="ns-secret-field">
                  <input className="ns-input" type={showVoiceKey ? "text" : "password"} placeholder={credentialState === "missing" ? "dán API key…" : "nhập key mới để thay thế…"} value={voiceKeyInput}
                    onChange={(e) => setVoiceKeyInput(e.target.value)} />
                  <button type="button" className="ns-secret-toggle" onClick={() => setShowVoiceKey((v) => !v)}>
                    {showVoiceKey ? "Ẩn" : "Hiện"}
                  </button>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button className="ns-btn" disabled={!voiceKeyInput.trim()} onClick={() => {
                    void onSetApiKey(voiceProvider, voiceKeyInput).then(() => setVoiceKeyInput(""));
                  }}>Lưu API key</button>
                  {credentialState === "saved" && <button className="ns-btn" onClick={() => void onClearApiKey(voiceProvider)}>Xóa key đã lưu</button>}
                </div>
              </Field>
              <Field label="Danh sách giọng" hint="Tải từ tài khoản provider; vẫn có thể nhập Voice ID thủ công bên dưới.">
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button className="ns-btn" disabled={credentialState === "missing" || voiceLoad === "loading"} onClick={() => {
                    setVoiceLoad("loading");
                    void onListVoices(voiceProvider).then((next) => { setVoices(next); setVoiceLoad("idle"); }).catch(() => setVoiceLoad("error"));
                  }}>{voiceLoad === "loading" ? "Đang tải…" : "Tải danh sách giọng"}</button>
                  {voiceLoad === "error" && <span style={{ color: "var(--danger)", fontSize: 13 }}>Không tải được danh sách giọng.</span>}
                </div>
                {voices.length > 0 && (
                  <select className="ns-input" value={voices.some((v) => v.id === voiceId) ? voiceId : ""} onChange={(e) => update(voiceProvider === "vivibe" ? { vivibeVoiceId: e.target.value } : { elevenLabsVoiceId: e.target.value })} style={{ width: "100%", maxWidth: 480, marginTop: 8 }}>
                    <option value="">— chọn giọng —</option>
                    {voices.map((voice) => <option key={voice.id} value={voice.id}>{voice.name}</option>)}
                  </select>
                )}
              </Field>
              <Field label="Voice ID" hint={`Mã giọng đọc cụ thể trên ${voiceProvider === "vivibe" ? "Vivibe" : "ElevenLabs"}.`}>
                <input className="ns-input" placeholder="voice id…" value={voiceId}
                  onChange={(e) => update(voiceProvider === "vivibe" ? { vivibeVoiceId: e.target.value } : { elevenLabsVoiceId: e.target.value })} style={{ width: "100%", maxWidth: 480 }} />
              </Field>
              {voiceProvider === "elevenlabs" && <Field label="Model ElevenLabs" hint="Model mặc định của phiên bản này."><input className="ns-input" value={settings.elevenLabsModelId} disabled style={{ width: "100%", maxWidth: 480, opacity: 0.7 }} /></Field>}
            </SettingsCard>
          )}

          {tab === "build" && (
            <SettingsCard title="Dựng video" desc="Tuỳ chọn quy trình tự dựng và chọn ảnh.">
              <Toggle checked={settings.scriptGateEnabled} onChange={(v) => update({ scriptGateEnabled: v })}
                title="Duyệt kịch bản trước khi dựng"
                desc="Tạm dừng để bạn xem và sửa lời đọc trước khi AI dựng video." />
              <ExpandableToggle
                checked={settings.refinePasses > 0}
                onChange={(v) => { update({ refinePasses: v ? DEFAULT_REFINE_PASSES : 0 }); if (v) setRefineExpanded(true); }}
                expanded={refineExpanded}
                onToggleExpanded={() => setRefineExpanded((e) => !e)}
                title="Tự tinh chỉnh hình ảnh bằng AI"
                desc="Trước bản nháp đầu, AI xem ảnh từng cảnh và tự sửa lỗi bố cục. Cần model nhìn được ảnh.">
                {settings.refinePasses > 0 && (
                  <>
                    <NumberRow value={settings.refinePasses} min={1} max={5} indent
                      onChange={(v) => update({ refinePasses: v })}
                      title="Số lần tinh chỉnh"
                      desc="Số lượt AI nhìn ảnh và sửa lại tối đa." />
                    <Toggle checked={settings.refineEarlyStop} onChange={(v) => update({ refineEarlyStop: v })} indent
                      title="Dừng sớm khi đã ổn định"
                      desc="Dừng khi hai lượt liên tiếp không còn lỗi, thay vì luôn chạy đủ số lần." />
                  </>
                )}
              </ExpandableToggle>
              <Toggle checked={settings.imageCrawlAiFilter} onChange={(v) => update({ imageCrawlAiFilter: v })}
                title="AI tự chọn ảnh từ bài báo"
                desc="Khi yêu cầu có đường dẫn bài báo, AI chọn sẵn ảnh phù hợp nội dung. Cần model nhìn được ảnh." />
              <Toggle checked={settings.imageCrawlHumanReview} onChange={(v) => update({ imageCrawlHumanReview: v })}
                title="Cho tôi duyệt ảnh trước khi dựng"
                desc="Hiện màn chọn ảnh cào từ bài báo để bạn xác nhận trước khi AI viết kịch bản." />
            </SettingsCard>
          )}

          {tab === "about" && (
            <SettingsCard title="Giới thiệu" desc="News Studio dựng video tin tức ngắn 9:16 bằng AI.">
              <InfoRow label="Phiên bản" value="News Studio 0.1.0" />
              <InfoRow label="Dịch vụ AI" value="9Router · localhost:20128"
                hint="Đăng nhập tài khoản nhà cung cấp được uỷ quyền cho 9Router. News Studio không lưu mật khẩu của bạn." />
              <InfoRow label="Mã kích hoạt (bản dev)" value="123" />
              <InfoRow label="Thư mục lưu dự án" value={settings.outputDir || "(mặc định)"} mono />
            </SettingsCard>
          )}
        </div>
      </div>
    </div>
  );
};
