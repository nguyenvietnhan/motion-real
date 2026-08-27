import React, { useCallback, useEffect, useState } from "react";
import type { AgentDraftVM } from "../../shared/types.js";
import { Icon } from "../icons.js";
import { ConfirmDialog } from "../primitives.js";

/**
 * The Harness owns the chat, event timeline, tool cards, and history. Keeping
 * its web UI intact avoids rebuilding a partial copy in the desktop renderer.
 */
export const AgentView: React.FC = () => {
  const [drafts, setDrafts] = useState<AgentDraftVM[]>([]);
  const [active, setActive] = useState<AgentDraftVM | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [frameKey, setFrameKey] = useState(0);
  const [showNewVideo, setShowNewVideo] = useState(false);
  const [newVideoTitle, setNewVideoTitle] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

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
      setNotice(`Đã gửi video vào Create Flow hiện có (${created.projectId}). Mở Trang chủ để theo dõi bản dựng.`);
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
