import React, { useCallback, useEffect, useMemo, useState } from "react";
import { agentProjectProgress } from "../../shared/agent-project-progress.js";
import type { AgentBriefInput, AgentDraftVM, AgentProductionState, AgentSearchProvider, AgentSettingsVM, DurationTierChoice, ProjectStage, ReviewMode, VideoLanguageChoice, VoiceProviderChoice } from "../../shared/types.js";
import { Icon } from "../icons.js";
import { ConfirmDialog, EmptyState, LoadingLine, PageHeader } from "../primitives.js";
import { ImageReviewView } from "./image-review.js";

const PRODUCTION_LABELS: Record<AgentProductionState, string> = {
  discovery: "Đang trao đổi ý tưởng",
  collecting_assets: "Đang thu thập asset",
  asset_review: "Chờ duyệt asset",
  preparing_brief: "Đang chuẩn bị brief",
  brief_review: "Chờ duyệt brief",
  queued_create: "Đang chờ tạo video",
  authoring: "Agent đang viết và kiểm tra cảnh",
  still_review: "Chờ bạn duyệt từng cảnh",
  draft_render: "Đang render draft",
  draft_review: "Chờ duyệt draft",
  final_render: "Đang render final",
  paused: "Đã dừng",
  completed: "Đã hoàn tất",
  error: "Cần xử lý lỗi",
};

const ASSET_ROLE_LABEL = { hero: "ảnh chính", support: "ảnh bổ trợ", logo: "logo", icon: "icon" } as const;
type Run = (work: () => Promise<void>) => Promise<void>;

export const AgentView: React.FC<{ onOpenProject: (projectId: string) => void; reviewMode: ReviewMode }> = ({ onOpenProject, reviewMode }) => {
  const [drafts, setDrafts] = useState<AgentDraftVM[]>([]);
  const [active, setActive] = useState<AgentDraftVM | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setDrafts(await window.dashboard.agent.list());
      setNotice(null);
    } catch (_error) {
      setNotice("Không đọc được danh sách Video Agent.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const run = useCallback<Run>(async (work) => {
    setBusy(true);
    setNotice(null);
    try {
      await work();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Video Agent gặp lỗi trước khi thay đổi video.");
      throw error;
    } finally {
      setBusy(false);
    }
  }, []);

  const createDraft = async (title: string): Promise<void> => {
    await run(async () => {
      try {
        setActive(await window.dashboard.agent.createDraft(title));
      } finally {
        // Creation persists the draft before Harness starts. Keep a failed
        // workspace visible in the library so it can be retried or removed.
        await refresh();
      }
    });
  };
  const openDraft = async (draft: AgentDraftVM): Promise<void> => {
    await run(async () => { setActive(await window.dashboard.agent.openDraft(draft.id)); await refresh(); });
  };
  const renameDraft = async (draft: AgentDraftVM, title: string): Promise<void> => {
    await run(async () => {
      const renamed = await window.dashboard.agent.renameDraft(draft.id, title);
      setDrafts((current) => current.map((item) => item.id === renamed.id ? renamed : item));
      setActive((current) => current?.id === renamed.id ? renamed : current);
      await refresh();
    });
  };
  const deleteDraft = async (draft: AgentDraftVM): Promise<void> => {
    await run(async () => {
      await window.dashboard.agent.deleteDraft(draft.id);
      setDrafts((current) => current.filter((item) => item.id !== draft.id));
      setActive((current) => current?.id === draft.id ? null : current);
      await refresh();
    });
  };

  if (!active) return <AgentLibrary drafts={drafts} loading={loading} busy={busy} notice={notice} onCreate={createDraft} onOpen={openDraft} onRename={renameDraft} onDelete={deleteDraft} />;
  return <AgentWorkspace draft={active} reviewMode={reviewMode} busy={busy} notice={notice} onBack={() => { setActive(null); setNotice(null); void refresh(); }} onDraftChange={(next) => { setActive(next); setDrafts((current) => current.map((item) => item.id === next.id ? next : item)); }} onOpenProject={onOpenProject} run={run} />;
};

type AgentLibraryProps = {
  drafts: AgentDraftVM[]; loading: boolean; busy: boolean; notice: string | null;
  onCreate: (title: string) => Promise<void> | void;
  onOpen: (draft: AgentDraftVM) => Promise<void> | void;
  onRename: (draft: AgentDraftVM, title: string) => Promise<void> | void;
  onDelete: (draft: AgentDraftVM) => Promise<void> | void;
};

export const AgentLibrary: React.FC<AgentLibraryProps> = ({ drafts, loading, busy, notice, onCreate, onOpen, onRename, onDelete }) => {
  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<AgentDraftVM | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AgentDraftVM | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  return (
    <section className="ns-agent-view ns-agent-library" aria-label="Thư viện Video Agent">
      <div className="ns-content">
        <PageHeader title="Video Agent" action={<button type="button" className="ns-btn ns-btn-primary" onClick={() => setCreateOpen(true)} disabled={busy}>{Icon.plus({ size: 16 })} Tạo video mới</button>} />
        {notice && <p className="ns-agent-notice" role="alert">{notice}</p>}
        {loading && <LoadingLine />}
        {!loading && drafts.length === 0 && <EmptyState icon={Icon.spark({ size: 32 })} title="Chưa có video Agent" hint="Tạo một workspace để bắt đầu nghiên cứu và làm video." action={<button type="button" className="ns-btn ns-btn-primary" onClick={() => setCreateOpen(true)}>Tạo video mới</button>} />}
        {!loading && drafts.length > 0 && (
          <div className="ns-agent-table" role="list" aria-label="Video Agent">
            <div className="ns-agent-table-head" aria-hidden="true"><span>Tên video</span><span>Trạng thái</span><span>Cập nhật</span><span /></div>
            {drafts.map((draft) => (
              <div className="ns-agent-row" role="listitem" key={draft.id}>
                <button type="button" className="ns-agent-row-open" onClick={() => { void Promise.resolve(onOpen(draft)).catch((_error) => undefined); }} disabled={busy}>
                  <span className="ns-agent-row-title">{Icon.film({ size: 17 })}<strong>{draft.title}</strong></span>
                  <span className={`ns-agent-row-state is-${draft.productionState}`}>{PRODUCTION_LABELS[draft.productionState]}</span>
                  <time dateTime={draft.updatedAt}>{formatUpdatedAt(draft.updatedAt)}</time>
                </button>
                <div className="ns-agent-row-menu-wrap">
                  <button type="button" className="ns-btn ns-btn-icon-only ns-agent-row-menu-trigger" aria-label={`Tùy chọn ${draft.title}`} aria-expanded={menuId === draft.id} onClick={(event) => { event.stopPropagation(); setMenuId((current) => current === draft.id ? null : draft.id); }}>{Icon.more({ size: 18 })}</button>
                  {menuId === draft.id && <div className="ns-agent-row-menu" role="menu">
                    <button type="button" role="menuitem" onClick={() => { setMenuId(null); setRenameTarget(draft); }}>{Icon.pencil({ size: 15 })} Đổi tên</button>
                    <button type="button" role="menuitem" className="danger" onClick={() => { setMenuId(null); setDeleteTarget(draft); }}>{Icon.trash({ size: 15 })} Xóa</button>
                  </div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <AgentNameDialog open={createOpen} title="Tạo video mới" confirmLabel="Tạo workspace" initialValue="" busy={busy} onCancel={() => setCreateOpen(false)} onConfirm={async (title) => { await onCreate(title); setCreateOpen(false); }} />
      <AgentNameDialog open={Boolean(renameTarget)} title="Đổi tên video" confirmLabel="Lưu" initialValue={renameTarget?.title ?? ""} busy={busy} onCancel={() => setRenameTarget(null)} onConfirm={async (title) => { if (!renameTarget) return; await onRename(renameTarget, title); setRenameTarget(null); }} />
      <ConfirmDialog open={Boolean(deleteTarget)} title="Xóa toàn bộ video Agent?" message="Project/video MotionReal, workspace Agent, asset, research và lịch sử hội thoại của video này sẽ bị xóa. Hành động không thể hoàn tác." confirmLabel="Xóa toàn bộ" cancelLabel="Huỷ" danger onConfirm={() => { if (deleteTarget) void Promise.resolve(onDelete(deleteTarget)).then(() => setDeleteTarget(null)).catch((_error) => undefined); }} onCancel={() => setDeleteTarget(null)} />
    </section>
  );
};

const AgentNameDialog: React.FC<{ open: boolean; title: string; confirmLabel: string; initialValue: string; busy: boolean; onCancel: () => void; onConfirm: (title: string) => Promise<void> | void }> = ({ open, title, confirmLabel, initialValue, busy, onCancel, onConfirm }) => {
  const [value, setValue] = useState(initialValue);
  useEffect(() => setValue(initialValue), [initialValue, open]);
  if (!open) return null;
  return <div className="ns-modal-backdrop" role="presentation" onMouseDown={onCancel}><form className="ns-modal ns-agent-name-dialog" role="dialog" aria-modal="true" onSubmit={(event) => { event.preventDefault(); if (value.trim()) void Promise.resolve(onConfirm(value.trim())).catch((_error) => undefined); }} onMouseDown={(event) => event.stopPropagation()}>
    <div className="ns-modal-head"><h2 className="ns-modal-title">{title}</h2></div>
    <label htmlFor="agent-name-input">Tên video</label>
    <input id="agent-name-input" className="ns-input" value={value} maxLength={120} autoFocus disabled={busy} onChange={(event) => setValue(event.target.value)} />
    <div className="ns-agent-dialog-actions"><button type="button" className="ns-btn" onClick={onCancel} disabled={busy}>Huỷ</button><button type="submit" className="ns-btn ns-btn-primary" disabled={busy || !value.trim()}>{confirmLabel}</button></div>
  </form></div>;
};

type AgentWorkspaceProps = {
  draft: AgentDraftVM; reviewMode: ReviewMode; busy: boolean; notice: string | null;
  onBack: () => void; onDraftChange: (draft: AgentDraftVM) => void; onOpenProject: (projectId: string) => void; run: Run;
};

export const AgentWorkspace: React.FC<AgentWorkspaceProps> = ({ draft, reviewMode: _reviewMode, busy, notice, onBack, onDraftChange, onOpenProject, run }) => {
  const [briefInput, setBriefInput] = useState<AgentBriefInput | null>(null);
  const [showBriefReview, setShowBriefReview] = useState(true);
  const [projectStage, setProjectStage] = useState<ProjectStage | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<AgentSettingsVM | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [searchApiKey, setSearchApiKey] = useState("");
  const [pendingFullAccess, setPendingFullAccess] = useState(false);
  const [frameKey, setFrameKey] = useState(0);
  const [frameFailed, setFrameFailed] = useState(false);

  useEffect(() => { const timer = window.setInterval(() => { void window.dashboard.agent.status(draft.id).then(onDraftChange).catch((_error) => undefined); }, 1_500); return () => window.clearInterval(timer); }, [draft.id, onDraftChange]);
  useEffect(() => {
    if (!draft.briefReview) { setBriefInput(null); return; }
    setBriefInput({ title: draft.briefReview.title, prompt: draft.briefReview.prompt, durationTier: draft.briefReview.durationTier, videoLanguage: draft.briefReview.videoLanguage, voiceProvider: draft.briefReview.voiceProvider });
    setShowBriefReview(true);
  }, [draft.id, draft.briefReview?.revision]);
  useEffect(() => {
    if (!draft.projectId) { setProjectStage(null); return; }
    let alive = true;
    const refreshStage = async () => { try { const next = await window.dashboard.projects.stage(draft.projectId!); if (alive) setProjectStage(next); } catch (_error) { /* preserve last authoritative stage */ } };
    void refreshStage();
    const interval = window.setInterval(() => void refreshStage(), 1_500);
    const refreshForProject = (event: { projectId?: string }) => { if (event.projectId === draft.projectId) void refreshStage(); };
    const unsubscribe = [window.dashboard.events.onProgress(refreshForProject), window.dashboard.events.onStatus(refreshForProject)];
    return () => { alive = false; window.clearInterval(interval); unsubscribe.forEach((stop) => stop()); };
  }, [draft.projectId]);

  const updateDraft = async (work: () => Promise<AgentDraftVM>): Promise<void> => { await run(async () => onDraftChange(await work())); };
  const liveProgress = projectStage ? agentProjectProgress(projectStage) : null;
  const displayedState = liveProgress?.state ?? draft.productionState;
  const progressLabel = liveProgress?.label ?? PRODUCTION_LABELS[draft.productionState];
  const reviewObscuresChat = Boolean(draft.productionState === "asset_review" && draft.assetReview || draft.productionState === "brief_review" && draft.briefReview && showBriefReview);

  const openSettings = () => {
    setSettingsOpen(true); setSettingsError(null);
    void run(async () => setSettings(await window.dashboard.agent.settings(draft.id))).catch((error) => setSettingsError(error instanceof Error ? error.message : "Không đọc được cài đặt Agent."));
  };
  const contextualAction = useMemo(() => {
    if (draft.productionState === "paused") return {
      label: "Tiếp tục",
      run: () => updateDraft(() => window.dashboard.agent.resumeWorkflow(draft.id, draft.workflowRevision)),
    };
    if (draft.productionState === "collecting_assets" || draft.productionState === "preparing_brief" || draft.productionState === "authoring") return {
      label: "Dừng",
      run: () => updateDraft(() => window.dashboard.agent.pauseWorkflow(draft.id, draft.workflowRevision)),
    };
    if (liveProgress?.canCancel && draft.projectId) return {
      label: "Dừng",
      run: () => run(async () => { await window.dashboard.projects.cancel(draft.projectId!); }),
    };
    if (draft.productionState === "discovery") return { label: "Thu thập asset", run: () => updateDraft(() => window.dashboard.agent.prepareAssets(draft.id, draft.workflowRevision)) };
    if (draft.productionState === "brief_review" && !draft.briefReview) return { label: "Tạo lại brief", run: () => updateDraft(() => window.dashboard.agent.prepareBrief(draft.id, draft.workflowRevision)) };
    if (draft.createReady) return { label: "Bắt đầu dựng", run: () => run(async () => { await window.dashboard.agent.createVideo(draft.id); onDraftChange(await window.dashboard.agent.status(draft.id)); }) };
    if (draft.projectId) return { label: liveProgress?.state === "still_review" ? "Duyệt từng cảnh" : liveProgress?.state === "draft_review" ? "Xem draft" : "Mở dự án", run: () => Promise.resolve(onOpenProject(draft.projectId!)) };
    return null;
  }, [draft, liveProgress?.state, onOpenProject]);

  return <section className="ns-agent-view ns-agent-workspace" aria-label={`Video Agent ${draft.title}`}>
    <header className={`ns-agent-workspace-bar is-${displayedState}`}>
      <button type="button" className="ns-btn ns-btn-icon-only" aria-label="Quay lại danh sách Video Agent" onClick={onBack} disabled={busy}>{Icon.chevronLeft({ size: 18 })}</button>
      <div className="ns-agent-workspace-title"><strong>{draft.title}</strong><span>{progressLabel}</span></div>
      {liveProgress?.percent !== undefined && <progress value={liveProgress.percent} max={100} aria-label={`Tiến trình ${liveProgress.percent}%`} />}
      <div className="ns-agent-workspace-actions">{contextualAction && <button type="button" className="ns-btn ns-btn-primary" onClick={() => { void contextualAction.run().catch((_error) => undefined); }} disabled={busy}>{contextualAction.label}</button>}<button type="button" className="ns-btn ns-btn-icon-only" aria-label="Cài đặt Agent" title="Cài đặt Agent" onClick={openSettings} disabled={busy}>{Icon.settings({ size: 18 })}</button></div>
    </header>
    {notice && <p className="ns-agent-notice" role="status">{notice}</p>}
    {draft.sessionAccess === "legacy-approval" && <p className="ns-agent-notice is-warning" role="status">Phiên cũ có thể yêu cầu duyệt quyền ngay trong chat.</p>}
    {draft.assetCollectionError && <p className="ns-agent-notice" role="alert">{draft.assetCollectionError}</p>}
    {draft.briefReviewError && <p className="ns-agent-notice" role="alert">{draft.briefReviewError}</p>}
    {draft.productionState === "asset_review" && draft.assetReview && <div className="ns-agent-asset-review"><ImageReviewView key={`${draft.id}-${draft.workflowRevision}`} images={draft.assetReview.map((asset) => ({ ref: asset.id, previewUrl: asset.previewUrl, width: asset.width, height: asset.height, sourceUrl: asset.sourceUrl, label: `${asset.label} · ${ASSET_ROLE_LABEL[asset.role]}`, suggested: draft.selectedAssetIds === undefined || draft.selectedAssetIds.includes(asset.id) }))} initialSelectedRefs={draft.selectedAssetIds ?? draft.assetReview.map((asset) => asset.id)} approveLabel="Chấp nhận" onRequestMore={(ids, note) => { void updateDraft(() => window.dashboard.agent.requestMoreAssets(draft.id, draft.workflowRevision, ids, note)).catch((_error) => undefined); }} onSubmit={(ids) => { void updateDraft(() => window.dashboard.agent.approveAssets(draft.id, draft.workflowRevision, ids)).catch((_error) => undefined); }} /></div>}
    {draft.productionState === "brief_review" && draft.briefReview && briefInput && showBriefReview && <BriefReview draft={draft} input={briefInput} busy={busy} onInput={setBriefInput} onContinue={() => setShowBriefReview(false)} onReturn={() => { void updateDraft(() => window.dashboard.agent.returnToAssets(draft.id, draft.workflowRevision)).catch((_error) => undefined); }} onApprove={() => { void updateDraft(() => window.dashboard.agent.approveBrief(draft.id, draft.workflowRevision, briefInput)).catch((_error) => undefined); }} />}
    {draft.productionState === "brief_review" && draft.briefReview && !showBriefReview && <div className="ns-agent-inline-action"><span>Brief đang chờ duyệt.</span><button type="button" className="ns-btn ns-btn-primary" onClick={() => setShowBriefReview(true)}>Mở brief</button></div>}
    {!reviewObscuresChat && draft.harnessUrl && !frameFailed && <iframe key={`${draft.harnessUrl}-${frameKey}`} className="ns-agent-frame" src={motionrealHarnessUrl(draft.harnessUrl)} title={`MotionReal Agent — ${draft.title}`} allow="clipboard-read; clipboard-write" referrerPolicy="no-referrer" onError={() => setFrameFailed(true)} />}
    {!reviewObscuresChat && (!draft.harnessUrl || frameFailed) && <div className="ns-agent-placeholder"><p>{frameFailed ? "Không mở được cuộc trò chuyện Agent." : "Đang khởi động Agent…"}</p>{frameFailed && <button type="button" className="ns-btn ns-btn-primary" onClick={() => { setFrameFailed(false); setFrameKey((value) => value + 1); }}>Thử lại</button>}</div>}
    <AgentSettingsDialog open={settingsOpen} busy={busy} settings={settings} error={settingsError} searchApiKey={searchApiKey} onSearchApiKeyChange={setSearchApiKey} onClose={() => { setSettingsOpen(false); setSearchApiKey(""); setSettingsError(null); }} onSearchProvider={(provider) => void run(async () => { await window.dashboard.agent.setSearchProvider(draft.id, provider); setSettings((current) => current ? { ...current, searchProvider: provider } : current); }).catch((error) => setSettingsError(error instanceof Error ? error.message : "Không lưu được dịch vụ tìm kiếm."))} onSaveSearchKey={() => void run(async () => { const next = await window.dashboard.agent.setSearchApiKey(draft.id, searchApiKey); onDraftChange(next); setSearchApiKey(""); setSettings((current) => current ? { ...current, webSearchConfigured: true } : current); }).catch((error) => setSettingsError(error instanceof Error ? error.message : "Không lưu được API key."))} onModel={(modelId) => void run(async () => setSettings(await window.dashboard.agent.selectModel(draft.id, modelId))).catch((error) => setSettingsError(error instanceof Error ? error.message : "Không đổi được model."))} onAccess={(presetId, confirmation) => { if (confirmation) { setPendingFullAccess(true); return; } void run(async () => setSettings(await window.dashboard.agent.setAccess(draft.id, presetId))).catch((error) => setSettingsError(error instanceof Error ? error.message : "Không đổi được quyền truy cập.")); }} />
    <ConfirmDialog open={pendingFullAccess} title="Cho phép toàn quyền?" message="Agent có thể dùng terminal và thay đổi mọi file mà Harness truy cập được. Chỉ bật khi bạn tin tưởng yêu cầu hiện tại." confirmLabel="Bật toàn quyền" cancelLabel="Huỷ" danger onCancel={() => setPendingFullAccess(false)} onConfirm={() => { setPendingFullAccess(false); void run(async () => setSettings(await window.dashboard.agent.setAccess(draft.id, "danger-full-access"))).catch((error) => setSettingsError(error instanceof Error ? error.message : "Không đổi được quyền truy cập.")); }} />
  </section>;
};

const BriefReview: React.FC<{ draft: AgentDraftVM; input: AgentBriefInput; busy: boolean; onInput: (value: AgentBriefInput) => void; onContinue: () => void; onReturn: () => void; onApprove: () => void }> = ({ draft, input, busy, onInput, onContinue, onReturn, onApprove }) => <section className="ns-agent-brief-review" aria-label="Duyệt brief">
  <div className="ns-agent-brief-head"><div><h2>Duyệt brief</h2><p>Revision {draft.briefReview!.revision} · Video dọc 9:16</p></div><button type="button" className="ns-btn" onClick={onContinue}>Tiếp tục chat</button></div>
  <label>Tiêu đề<input className="ns-input" value={input.title} maxLength={160} onChange={(event) => onInput({ ...input, title: event.target.value })} /></label>
  <label>Brief cuối<textarea className="ns-input ns-agent-brief-prompt" value={input.prompt} maxLength={20_000} onChange={(event) => onInput({ ...input, prompt: event.target.value })} /></label>
  <div className="ns-agent-brief-settings">
    <label>Thời lượng<select className="ns-input" value={input.durationTier} onChange={(event) => onInput({ ...input, durationTier: Number(event.target.value) as DurationTierChoice })}><option value={1}>0:45</option><option value={2}>1:30</option><option value={3}>2:30</option><option value={4}>3:30</option></select></label>
    <label>Ngôn ngữ<select className="ns-input" value={input.videoLanguage} onChange={(event) => { const videoLanguage = event.target.value as VideoLanguageChoice; onInput({ ...input, videoLanguage, ...(videoLanguage === "en" && input.voiceProvider !== "elevenlabs" ? { voiceProvider: "elevenlabs" } : {}) }); }}><option value="vi">Tiếng Việt</option><option value="en">English</option></select></label>
    <label>Giọng đọc<select className="ns-input" value={input.voiceProvider} onChange={(event) => onInput({ ...input, voiceProvider: event.target.value as VoiceProviderChoice })}>{input.videoLanguage === "vi" && <option value="vivibe">Vivibe</option>}{input.videoLanguage === "vi" && <option value="vieneu">VieNeu Local</option>}<option value="elevenlabs">ElevenLabs</option></select></label>
  </div>
  <div className="ns-agent-brief-assets">{(draft.assetReview ?? []).filter((asset) => draft.briefReview?.selectedAssetIds.includes(asset.id)).map((asset) => <img key={asset.id} src={asset.previewUrl} alt={asset.label} title={asset.label} />)}</div>
  <div className="ns-agent-brief-actions"><button type="button" className="ns-btn" onClick={onReturn} disabled={busy}>Quay lại asset</button><button type="button" className="ns-btn ns-btn-primary" onClick={onApprove} disabled={busy || input.prompt.trim().length < 20 || !input.title.trim()}>Chấp nhận brief</button></div>
</section>;

const AgentSettingsDialog: React.FC<{ open: boolean; busy: boolean; settings: AgentSettingsVM | null; error: string | null; searchApiKey: string; onSearchApiKeyChange: (value: string) => void; onClose: () => void; onSearchProvider: (provider: AgentSearchProvider) => void; onSaveSearchKey: () => void; onModel: (modelId: string) => void; onAccess: (presetId: string, requiresConfirmation: boolean) => void }> = ({ open, busy, settings, error, searchApiKey, onSearchApiKeyChange, onClose, onSearchProvider, onSaveSearchKey, onModel, onAccess }) => {
  if (!open) return null;
  return <div className="ns-modal-backdrop" role="presentation" onMouseDown={onClose}><section className="ns-modal ns-agent-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="agent-settings-title" onMouseDown={(event) => event.stopPropagation()}>
    <div className="ns-modal-head"><div><h2 id="agent-settings-title" className="ns-modal-title">Cài đặt Agent</h2><p>Áp dụng cho workspace video này.</p></div><button type="button" className="ns-btn ns-btn-icon-only" aria-label="Đóng cài đặt" onClick={onClose}>{Icon.close({ size: 18 })}</button></div>
    {error && <p className="ns-agent-notice" role="alert">{error}</p>}
    {!settings ? <LoadingLine /> : <div className="ns-agent-settings-groups">
      <fieldset><legend>Tìm kiếm</legend><label>Dịch vụ<select className="ns-input" value={settings.searchProvider} disabled={busy} onChange={(event) => onSearchProvider(event.target.value as AgentSearchProvider)}><option value="deepseek">DeepSeek Search</option><option value="exa">Exa hosted</option></select></label>{settings.searchProvider === "deepseek" && <div className="ns-agent-search-key"><label>DeepSeek API key<input className="ns-input" type="password" value={searchApiKey} autoComplete="off" placeholder={settings.webSearchConfigured ? "Đã cấu hình — nhập key mới để thay" : "Nhập API key"} onChange={(event) => onSearchApiKeyChange(event.target.value)} /></label><button type="button" className="ns-btn" disabled={busy || !searchApiKey.trim()} onClick={onSaveSearchKey}>Lưu key</button></div>}<small>Đổi dịch vụ có hiệu lực khi Harness khởi động lại; lượt chat đang chạy không bị ngắt.</small></fieldset>
      <fieldset><legend>Model</legend>{settings.modelOptions.length === 0 ? <small>Runtime không cung cấp catalog model.</small> : <label>Model hiện tại<select className="ns-input" value={settings.currentModelId ?? ""} disabled={busy} onChange={(event) => onModel(event.target.value)}>{settings.modelOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>}</fieldset>
      <fieldset><legend>Quyền truy cập</legend>{settings.accessOptions.length === 0 ? <small>Runtime không cung cấp preset quyền.</small> : <div className="ns-agent-access-options">{settings.accessOptions.map((option) => <label key={option.id}><input type="radio" name="agent-access" checked={settings.currentAccessId === option.id} disabled={busy} onChange={() => onAccess(option.id, option.requiresConfirmation)} /><span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span></label>)}</div>}</fieldset>
    </div>}
  </section></div>;
};

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function motionrealHarnessUrl(value: string): string {
  try { const url = new URL(value); url.searchParams.set("embedded", "motionreal"); return url.href; } catch (_error) { return value; }
}
