import React, { useCallback, useEffect, useState } from "react";
import { agentProjectProgress } from "../../shared/agent-project-progress.js";
import type { AgentBriefInput, AgentDraftVM, AgentProductionState, DurationTierChoice, ProjectStage, VideoLanguageChoice, VoiceProviderChoice } from "../../shared/types.js";
import { Icon } from "../icons.js";
import { ConfirmDialog } from "../primitives.js";
import { ImageReviewView } from "./image-review.js";

const PRODUCTION_LABELS: Record<AgentProductionState, string> = {
  discovery: "Đang trao đổi ý tưởng",
  collecting_assets: "Đang thu thập asset",
  asset_review: "Chờ duyệt asset",
  brief_review: "Chờ duyệt brief",
  queued_create: "Đang chờ tạo video",
  authoring: "Đang dựng nội dung",
  still_review: "Đang kiểm tra cảnh",
  draft_render: "Đang render draft",
  draft_review: "Chờ duyệt draft",
  final_render: "Đang render final",
  completed: "Đã hoàn tất",
  error: "Cần xử lý lỗi",
};

/**
 * The Harness owns the chat, event timeline, tool cards, and history. Keeping
 * its web UI intact avoids rebuilding a partial copy in the desktop renderer.
 */
export const AgentView: React.FC<{ onOpenProject: (projectId: string) => void }> = ({ onOpenProject }) => {
  const [drafts, setDrafts] = useState<AgentDraftVM[]>([]);
  const [active, setActive] = useState<AgentDraftVM | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [frameKey, setFrameKey] = useState(0);
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
      setActive((current) => {
        const refreshed = current ? next.find((draft) => draft.id === current.id) : null;
        return refreshed ? { ...current, ...refreshed } : null;
      });
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
        setActive((current) => current?.id === next.id ? { ...current, ...next } : current);
        setDrafts((current) => current.map((draft) => draft.id === next.id ? { ...draft, ...next } : draft));
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

  const createVideo = () => {
    if (!active) return;
    void run(async () => {
      const created = await window.dashboard.agent.createVideo(active.id);
      setNotice("Đã tạo project. Tiến trình dựng sẽ hiển thị ngay tại đây.");
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
  const displayedState = liveProgress?.state ?? active?.productionState;

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

  return (
    <section className="ns-agent-view" aria-label="Video Agent">
      <header className="ns-agent-chrome">
        <div>
          <h1 className="ns-agent-title">Video Agent</h1>
          <p className="ns-agent-subtitle">Một DeepSeek Harness dùng chung, mỗi video có workspace riêng. Chat, suy luận và tool được giữ nguyên bản.</p>
        </div>
        <div className="ns-agent-actions">
          <button type="button" className="ns-btn" onClick={() => setShowNewVideo(true)} disabled={busy}>
            {Icon.plus({ size: 16 })}
            Video mới
          </button>
          {active && <button type="button" className="ns-btn ns-agent-reload" onClick={() => setFrameKey((current) => current + 1)} disabled={busy} title="Tải lại Harness">
            {Icon.refresh({ size: 16 })}
            Tải lại
          </button>}
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
          <button type="submit" className="ns-btn ns-btn-primary" disabled={busy}>Mở Harness</button>
        </form>
      )}
      <div className="ns-agent-drafts" aria-label="Workspace Video Agent">
        {drafts.map((draft) => (
          <button
            key={draft.id}
            type="button"
            className={`ns-agent-draft ${active?.id === draft.id ? "is-active" : ""}`}
            onClick={() => openDraft(draft)}
            disabled={busy}
          >
            {draft.title}{draft.projectId ? " · đã tạo video" : ""}
          </button>
        ))}
        {drafts.length === 0 && <span className="ns-agent-empty">Tạo một video mới để mở Harness.</span>}
      </div>
      {notice && <p className="ns-agent-notice" role="status">{notice}</p>}
      {active && (
        <div className={`ns-agent-workflow is-${displayedState}`} title={`Workflow revision ${active.workflowRevision}`}>
          <span>Quy trình video</span>
          <strong>{liveProgress?.label ?? PRODUCTION_LABELS[active.productionState]}</strong>
          {liveProgress?.percent !== undefined && (
            <progress value={liveProgress.percent} max={100} aria-label={`Tiến trình ${liveProgress.percent}%`} />
          )}
          {active.projectId && (
            <div className="ns-agent-project-actions">
              {liveProgress?.canCancel && <button type="button" className="ns-btn" onClick={cancelProject} disabled={busy}>Dừng</button>}
              <button type="button" className="ns-btn ns-btn-primary" onClick={() => onOpenProject(active.projectId!)} disabled={busy}>
                {liveProgress?.state === "draft_review" ? "Xem draft" : "Mở dự án"}
              </button>
            </div>
          )}
        </div>
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
              label: asset.label,
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
          Agent đã chuẩn bị brief và asset local. MotionReal chưa thay đổi video nào.
          <button type="button" className="ns-btn" onClick={createVideo} disabled={busy}>Tạo video bằng Create Flow</button>
        </div>
      )}
      {active?.harnessUrl ? (
        <iframe
          key={`${active.harnessUrl}-${frameKey}`}
          className="ns-agent-frame"
          src={active.harnessUrl}
          title={`DeepSeek Harness — ${active.title}`}
          allow="clipboard-read; clipboard-write"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="ns-agent-placeholder">
          <p>{busy ? "Đang khởi động Harness…" : "Chọn hoặc tạo video để mở workspace Agent."}</p>
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
