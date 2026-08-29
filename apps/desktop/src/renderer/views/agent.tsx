import React, { useCallback, useEffect, useState } from "react";
import { agentProjectProgress } from "../../shared/agent-project-progress.js";
import type { AgentBriefInput, AgentDraftVM, AgentProductionState, AgentSearchProvider, DurationTierChoice, ProjectStage, ReviewMode, VideoLanguageChoice, VoiceProviderChoice } from "../../shared/types.js";
import { Icon } from "../icons.js";
import { ConfirmDialog } from "../primitives.js";
import { ImageReviewView } from "./image-review.js";

const PRODUCTION_LABELS: Record<AgentProductionState, string> = {
  discovery: "Đang trao đổi ý tưởng",
  collecting_assets: "Đang thu thập asset",
  asset_review: "Chờ duyệt asset",
  brief_review: "Chờ duyệt brief",
  queued_create: "Đang chờ tạo video",
  authoring: "Harness đang viết và kiểm tra cảnh",
  still_review: "Chờ bạn duyệt từng cảnh",
  draft_render: "Đang render draft",
  draft_review: "Chờ duyệt draft",
  final_render: "Đang render final",
  completed: "Đã hoàn tất",
  error: "Cần xử lý lỗi",
};

const ASSET_ROLE_LABEL = {
  hero: "ảnh chính",
  support: "ảnh bổ trợ",
  logo: "logo",
  icon: "icon",
} as const;

const REVIEW_MODE_LABELS: Record<ReviewMode, string> = {
  full: "Draft MP4 trước final",
  stills_edit: "Duyệt ảnh từng cảnh · không render draft MP4",
  skip_edit: "Tự động final · không dừng ở draft",
};

export const AgentView: React.FC<{
  onOpenProject: (projectId: string) => void;
  reviewMode: ReviewMode;
}> = ({ onOpenProject, reviewMode }) => {
  const [drafts, setDrafts] = useState<AgentDraftVM[]>([]);
  const [active, setActive] = useState<AgentDraftVM | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [frameKey, setFrameKey] = useState(0);
  const [searchApiKey, setSearchApiKey] = useState("");
  const [showNewVideo, setShowNewVideo] = useState(false);
  const [newVideoTitle, setNewVideoTitle] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [briefInput, setBriefInput] = useState<AgentBriefInput | null>(null);
  const [showBriefReview, setShowBriefReview] = useState(true);
  const [projectStage, setProjectStage] = useState<ProjectStage | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await window.dashboard.agent.list();
      setDrafts(next);
      setActive((current) => current && next.some((draft) => draft.id === current.id) ? current : null);
    } catch {
      setNotice("Không đọc được các workspace Video Agent.");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      void window.dashboard.agent.status(active.id).then((next) => {
        setActive((current) => current?.id === next.id ? next : current);
        setDrafts((current) => current.map((draft) => draft.id === next.id ? next : draft));
      }).catch(() => undefined);
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [active?.id]);

  useEffect(() => {
    const projectId = active?.projectId;
    if (!projectId) {
      setProjectStage(null);
      return;
    }
    setProjectStage(null);
    let alive = true;
    const refreshStage = async () => {
      try {
        const next = await window.dashboard.projects.stage(projectId);
        if (alive) setProjectStage(next);
      } catch {
        // Keep the last authoritative stage during a transient IPC failure.
      }
    };
    void refreshStage();
    const interval = window.setInterval(() => void refreshStage(), 1_500);
    const refreshForProject = (event: { projectId?: string }) => {
      if (event.projectId === projectId) void refreshStage();
    };
    const unsubscribe = [
      window.dashboard.events.onProgress(refreshForProject),
      window.dashboard.events.onStatus(refreshForProject),
    ];
    return () => {
      alive = false;
      window.clearInterval(interval);
      unsubscribe.forEach((stop) => stop());
    };
  }, [active?.projectId]);

  useEffect(() => {
    if (!active?.briefReview) {
      setBriefInput(null);
      return;
    }
    setBriefInput({
      title: active.briefReview.title,
      prompt: active.briefReview.prompt,
      durationTier: active.briefReview.durationTier,
      videoLanguage: active.briefReview.videoLanguage,
      voiceProvider: active.briefReview.voiceProvider,
    });
    setShowBriefReview(true);
  }, [active?.id, active?.briefReview?.revision]);

  useEffect(() => setSearchApiKey(""), [active?.id]);

  const run = useCallback(async (work: () => Promise<void>) => {
    setBusy(true);
    setNotice(null);
    try {
      await work();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Video Agent gặp lỗi trước khi thay đổi video.");
    } finally {
      setBusy(false);
    }
  }, []);

  const createDraft = (event: React.FormEvent) => {
    event.preventDefault();
    const title = newVideoTitle.trim();
    if (!title) {
      setNotice("Hãy nhập tên video trước khi mở Agent.");
      return;
    }
    void run(async () => {
      try {
        const draft = await window.dashboard.agent.createDraft(title);
        setActive(draft);
        setNewVideoTitle("");
        setShowNewVideo(false);
      } finally {
        // createDraft persists the workspace before starting Harness. Keep the
        // retry/delete entry visible even when the child fails to boot.
        await refresh();
      }
    });
  };

  const openDraft = (draft: AgentDraftVM) => {
    void run(async () => {
      const opened = await window.dashboard.agent.openDraft(draft.id);
      setActive(opened);
      await refresh();
    });
  };

  const configureSearch = (event: React.FormEvent) => {
    event.preventDefault();
    if (!active || !searchApiKey.trim()) return;
    void run(async () => {
      const next = await window.dashboard.agent.setSearchApiKey(active.id, searchApiKey);
      setActive(next);
      setDrafts((current) => current.map((draft) => draft.id === next.id ? next : draft));
      setSearchApiKey("");
      setNotice("Đã cấu hình web_search cho Harness.");
    });
  };

  const selectSearchProvider = (provider: AgentSearchProvider) => {
    if (!active) return;
    void run(async () => {
      await window.dashboard.agent.setSearchProvider(active.id, provider);
      setSearchApiKey("");
      setNotice(`Đã lưu lựa chọn ${provider === "exa" ? "Exa hosted" : "DeepSeek"} cho mọi video Agent. Khởi động lại MotionReal để áp dụng; phiên chat hiện tại không bị ngắt.`);
    });
  };

  const createVideo = () => {
    if (!active) return;
    void run(async () => {
      await window.dashboard.agent.createVideo(active.id);
      setNotice("Đã tạo project. Harness đang đọc asset và viết các scene; tiến trình sẽ hiển thị tại đây.");
      await refresh();
    });
  };

  const cancelProject = () => {
    if (!active?.projectId) return;
    void run(async () => {
      await window.dashboard.projects.cancel(active.projectId!);
      setNotice("Đã yêu cầu dừng công việc đang chạy; project và bản nháp hiện có vẫn được giữ lại.");
    });
  };

  const liveProgress = projectStage ? agentProjectProgress(projectStage) : null;
  const harnessStillReview = liveProgress?.state === "still_review" && projectStage?.kind === "ready";
  const displayedState = liveProgress?.state ?? active?.productionState;
  const progressLabel = liveProgress?.label ?? (active ? PRODUCTION_LABELS[active.productionState] : "");
  const canCancelProject = liveProgress?.canCancel && active?.productionState !== "authoring";

  const prepareAssets = () => {
    if (!active) return;
    void run(async () => {
      const next = await window.dashboard.agent.prepareAssets(active.id, active.workflowRevision);
      setActive(next);
      await refresh();
    });
  };

  const requestMoreAssets = (selectedIds: string[], note: string) => {
    if (!active) return;
    void run(async () => {
      const next = await window.dashboard.agent.requestMoreAssets(active.id, active.workflowRevision, selectedIds, note);
      setActive(next);
      await refresh();
    });
  };

  const approveAssets = (selectedIds: string[]) => {
    if (!active) return;
    void run(async () => {
      const next = await window.dashboard.agent.approveAssets(active.id, active.workflowRevision, selectedIds);
      setActive(next);
      setNotice("Đã chốt asset. Agent đang chuẩn bị brief để bạn duyệt.");
      await refresh();
    });
  };

  const prepareBrief = () => {
    if (!active) return;
    void run(async () => {
      const next = await window.dashboard.agent.prepareBrief(active.id, active.workflowRevision);
      setActive(next);
      setNotice("Đã yêu cầu Agent tạo brief.");
      await refresh();
    });
  };

  const returnToAssets = () => {
    if (!active) return;
    void run(async () => {
      const next = await window.dashboard.agent.returnToAssets(active.id, active.workflowRevision);
      setActive(next);
      await refresh();
    });
  };

  const approveBrief = () => {
    if (!active || !briefInput) return;
    void run(async () => {
      const next = await window.dashboard.agent.approveBrief(active.id, active.workflowRevision, briefInput);
      setActive(next);
      setNotice("Đã đóng băng brief. MotionReal chưa tạo project cho đến khi bạn bấm Tạo video.");
      await refresh();
    });
  };

  const deleteDraft = () => {
    if (!active) return;
    void run(async () => {
      await window.dashboard.agent.deleteDraft(active.id);
      setActive(null);
      setConfirmDelete(false);
      await refresh();
    });
  };

  const reviewObscuresChat = Boolean(
    active?.productionState === "asset_review" && active.assetReview
    || active?.productionState === "brief_review" && active.briefReview && showBriefReview,
  );

  return (
    <section className="ns-agent-view" aria-label="Video Agent">
      <header className="ns-agent-chrome">
        <div>
          <h1 className="ns-agent-title">Video Agent</h1>
          <p className="ns-agent-subtitle">Trao đổi, research và tạo video trong một workspace riêng. MotionReal giữ quyền duyệt ở từng bước.</p>
        </div>
        <div className="ns-agent-actions">
          <button type="button" className="ns-btn" onClick={() => setShowNewVideo(true)} disabled={busy}>
            {Icon.plus({ size: 16 })}
            Video mới
          </button>
          {active && <button type="button" className="ns-btn ns-agent-delete" onClick={() => setConfirmDelete(true)} disabled={busy}>Xóa video</button>}
        </div>
      </header>
      {showNewVideo && (
        <form className="ns-agent-new-video" onSubmit={createDraft}>
          <label htmlFor="agent-video-title">Tên video</label>
          <input
            id="agent-video-title"
            className="ns-input"
            value={newVideoTitle}
            onChange={(event) => setNewVideoTitle(event.target.value)}
            placeholder="Ví dụ: ChatGPT thay đổi cách học thế nào?"
            autoFocus
            disabled={busy}
          />
          <button type="button" className="ns-btn" onClick={() => setShowNewVideo(false)} disabled={busy}>Huỷ</button>
          <button type="submit" className="ns-btn ns-btn-primary" disabled={busy}>Tạo workspace</button>
        </form>
      )}
      <div className="ns-agent-sessionbar" aria-label="Workspace Video Agent">
        <label className="ns-agent-session-picker">
          <span>Video đang làm</span>
          <select
            className="ns-input"
            value={active?.id ?? ""}
            onChange={(event) => {
              const draft = drafts.find((item) => item.id === event.target.value);
              if (draft) openDraft(draft);
            }}
            disabled={busy || drafts.length === 0}
          >
            <option value="" disabled>{drafts.length === 0 ? "Chưa có video" : "Chọn video"}</option>
            {drafts.map((draft) => (
              <option key={draft.id} value={draft.id}>{draft.title}{draft.projectId ? " · đã tạo project" : ""}</option>
            ))}
          </select>
        </label>
        {drafts.length === 0 && <span className="ns-agent-empty">Tạo một video mới để bắt đầu trao đổi.</span>}
        <div className="ns-agent-session-actions">
          {active?.harnessUrl && <button type="button" className="ns-btn ns-agent-reload" onClick={() => setFrameKey((current) => current + 1)} disabled={busy} title="Tải lại chat">
            {Icon.refresh({ size: 16 })} Tải lại chat
          </button>}
        </div>
      </div>
      {notice && <p className="ns-agent-notice" role="status">{notice}</p>}
      {active?.sessionAccess === "legacy-approval" && (
        <p className="ns-agent-notice is-warning" role="status">
          Phiên này được tạo trước cấu hình Full access nên có thể còn yêu cầu duyệt ngay trong chat. Video mới sẽ dùng Full access tự động.
        </p>
      )}
      {active && (
        <div className={`ns-agent-workflow is-${displayedState}`} title={`Workflow revision ${active.workflowRevision}`}>
          <span>Quy trình video</span>
          <strong>{progressLabel}</strong>
          <small className="ns-agent-review-mode">Chế độ duyệt: {REVIEW_MODE_LABELS[reviewMode]}</small>
          {liveProgress?.percent !== undefined && (
            <progress value={liveProgress.percent} max={100} aria-label={`Tiến trình ${liveProgress.percent}%`} />
          )}
          {active.projectId && (
            <div className="ns-agent-project-actions">
              {canCancelProject && <button type="button" className="ns-btn" onClick={cancelProject} disabled={busy}>Dừng</button>}
              <button type="button" className="ns-btn ns-btn-primary" onClick={() => onOpenProject(active.projectId!)} disabled={busy}>
                {harnessStillReview ? "Duyệt từng cảnh" : liveProgress?.state === "draft_review" ? "Xem draft" : "Mở dự án"}
              </button>
            </div>
          )}
        </div>
      )}
      {active?.harnessUrl && (
        <div className="ns-agent-prepare">
          <span>
            Tìm kiếm đang cấu hình: {active.searchProvider === "exa" ? "Exa hosted" : "DeepSeek"}.
            {" "}Exa nhận truy vấn tìm kiếm qua mạng, có mức dùng miễn phí giới hạn; kết quả có thể lưu trong lịch sử Harness.
          </span>
          <button type="button" className="ns-btn" disabled={busy}
            onClick={() => selectSearchProvider(active.searchProvider === "exa" ? "deepseek" : "exa")}>
            {active.searchProvider === "exa" ? "Chuyển sang DeepSeek" : "Dùng Exa hosted"}
          </button>
        </div>
      )}
      {active?.harnessUrl && active.searchProvider !== "exa" && active.webSearchConfigured === false && (
        <form className="ns-agent-prepare" onSubmit={configureSearch}>
          <span>
            Chat đang dùng 9router. Công cụ <code>web_search</code> cần DeepSeek API key riêng và lưu trực tiếp trong Harness.
          </span>
          <input
            className="ns-input"
            type="password"
            value={searchApiKey}
            onChange={(event) => setSearchApiKey(event.target.value)}
            placeholder="DeepSeek API key cho web_search"
            autoComplete="off"
            disabled={busy}
          />
          <button type="submit" className="ns-btn ns-btn-primary" disabled={busy || !searchApiKey.trim()}>
            Lưu key tìm kiếm
          </button>
        </form>
      )}
      {active?.productionState === "discovery" && (
        <div className="ns-agent-prepare">
          <span>Khi đã trao đổi đủ ý tưởng, bắt đầu để Agent tìm và tải ảnh vào workspace video này.</span>
          <button type="button" className="ns-btn ns-btn-primary" onClick={prepareAssets} disabled={busy}>Chuẩn bị tạo video</button>
        </div>
      )}
      {active?.assetCollectionError && (
        <p className="ns-agent-notice" role="alert">{active.assetCollectionError}</p>
      )}
      {active?.briefReviewError && (
        <p className="ns-agent-notice" role="alert">{active.briefReviewError}</p>
      )}
      {active?.productionState === "asset_review" && active.assetReview && (
        <div className="ns-agent-asset-review">
          <ImageReviewView
            key={`${active.id}-${active.workflowRevision}`}
            images={active.assetReview.map((asset) => ({
              ref: asset.id,
              previewUrl: asset.previewUrl,
              width: asset.width,
              height: asset.height,
              sourceUrl: asset.sourceUrl,
              label: `${asset.label} · ${ASSET_ROLE_LABEL[asset.role]}`,
              suggested: active.selectedAssetIds === undefined || active.selectedAssetIds.includes(asset.id),
            }))}
            initialSelectedRefs={active.selectedAssetIds ?? active.assetReview.map((asset) => asset.id)}
            approveLabel="Chấp nhận"
            onRequestMore={requestMoreAssets}
            onSubmit={approveAssets}
          />
        </div>
      )}
      {active?.productionState === "brief_review" && !active.briefReview && (
        <div className="ns-agent-prepare">
          <span>{active.briefReviewError ? "Brief chưa hợp lệ. Bạn có thể yêu cầu Agent tạo lại." : "Agent đang tạo brief từ cuộc trò chuyện và asset đã duyệt."}</span>
          <button type="button" className="ns-btn" onClick={prepareBrief} disabled={busy}>Tạo lại brief</button>
        </div>
      )}
      {active?.productionState === "brief_review" && active.briefReview && briefInput && showBriefReview && (
        <section className="ns-agent-brief-review" aria-label="Duyệt brief">
          <div className="ns-agent-brief-head">
            <div>
              <h2>Duyệt brief</h2>
              <p>Revision {active.briefReview.revision} · Video dọc 9:16</p>
            </div>
            <button type="button" className="ns-btn" onClick={() => setShowBriefReview(false)}>Tiếp tục chat</button>
          </div>
          <label>
            Tiêu đề
            <input className="ns-input" value={briefInput.title} maxLength={160} onChange={(event) => setBriefInput({ ...briefInput, title: event.target.value })} />
          </label>
          <label>
            Brief cuối
            <textarea className="ns-input ns-agent-brief-prompt" value={briefInput.prompt} maxLength={20_000} onChange={(event) => setBriefInput({ ...briefInput, prompt: event.target.value })} />
          </label>
          <div className="ns-agent-brief-settings">
            <label>Thời lượng
              <select className="ns-input" value={briefInput.durationTier} onChange={(event) => setBriefInput({ ...briefInput, durationTier: Number(event.target.value) as DurationTierChoice })}>
                <option value={1}>0:45</option><option value={2}>1:30</option><option value={3}>2:30</option><option value={4}>3:30</option>
              </select>
            </label>
            <label>Ngôn ngữ
              <select className="ns-input" value={briefInput.videoLanguage} onChange={(event) => {
                const videoLanguage = event.target.value as VideoLanguageChoice;
                setBriefInput({ ...briefInput, videoLanguage, ...(videoLanguage === "en" && briefInput.voiceProvider !== "elevenlabs" ? { voiceProvider: "elevenlabs" } : {}) });
              }}>
                <option value="vi">Tiếng Việt</option><option value="en">English</option>
              </select>
            </label>
            <label>Giọng đọc
              <select className="ns-input" value={briefInput.voiceProvider} onChange={(event) => setBriefInput({ ...briefInput, voiceProvider: event.target.value as VoiceProviderChoice })}>
                {briefInput.videoLanguage === "vi" && <option value="vivibe">Vivibe</option>}
                {briefInput.videoLanguage === "vi" && <option value="vieneu">VieNeu Local</option>}
                <option value="elevenlabs">ElevenLabs</option>
              </select>
            </label>
          </div>
          <div className="ns-agent-brief-assets">
            {(active.assetReview ?? []).filter((asset) => active.briefReview?.selectedAssetIds.includes(asset.id)).map((asset) => (
              <img key={asset.id} src={asset.previewUrl} alt={asset.label} title={asset.label} />
            ))}
          </div>
          <div className="ns-agent-brief-actions">
            <button type="button" className="ns-btn" onClick={returnToAssets} disabled={busy}>Quay lại asset</button>
            <button type="button" className="ns-btn ns-btn-primary" onClick={approveBrief} disabled={busy || briefInput.prompt.trim().length < 20 || !briefInput.title.trim()}>Chấp nhận brief</button>
          </div>
        </section>
      )}
      {active?.productionState === "brief_review" && active.briefReview && !showBriefReview && (
        <div className="ns-agent-prepare">
          <span>Brief đang chờ duyệt; bạn có thể tiếp tục trao đổi với Agent.</span>
          <button type="button" className="ns-btn ns-btn-primary" onClick={() => setShowBriefReview(true)}>Mở lại brief</button>
        </div>
      )}
      {active?.createReady && (
        <div className="ns-agent-create-ready">
          Agent đã chuẩn bị brief và asset local. MotionReal chưa tạo project.
          <button type="button" className="ns-btn" onClick={createVideo} disabled={busy}>Bắt đầu dựng bằng Harness</button>
        </div>
      )}
      {active?.harnessUrl && !reviewObscuresChat ? (
        <iframe
          key={`${active.harnessUrl}-${frameKey}`}
          className="ns-agent-frame"
          src={active.harnessUrl}
          title={`DeepSeek Harness — ${active.title}`}
          allow="clipboard-read; clipboard-write"
          referrerPolicy="no-referrer"
        />
      ) : (
        !reviewObscuresChat && <div className="ns-agent-placeholder">
          <p>{busy ? "Đang khởi động Agent…" : "Chọn hoặc tạo video để mở workspace Agent."}</p>
        </div>
      )}
      <ConfirmDialog
        open={confirmDelete}
        title="Xóa video Agent?"
        message={active?.projectId
          ? "Xóa dự án MotionReal cùng workspace, research và asset của Agent. Phiên chat sẽ được ẩn khỏi Harness. Hành động không thể hoàn tác."
          : "Xóa workspace Agent, research và asset đã tải. Phiên chat sẽ được ẩn khỏi Harness. Hành động không thể hoàn tác."}
        confirmLabel="Xóa"
        cancelLabel="Huỷ"
        danger
        onConfirm={deleteDraft}
        onCancel={() => setConfirmDelete(false)}
      />
    </section>
  );
};
