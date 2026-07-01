import React, { useEffect, useRef, useState } from "react";
import type { BgmTrackVM, StoryboardModel } from "../../shared/types.js";
import { Icon } from "../icons.js";
import { EmptyState, InfoHint } from "../primitives.js";
import { compactNotificationMessage, errorDetails, useNotifications } from "../notifications.js";

/**
 * Background-music picker (I2): a compact dropdown of the per-machine BGM
 * library + add/remove, shown in the storyboard header so the user sets the
 * track BEFORE approving the full render (the choice is persisted to the
 * manifest; the MCP render tool resolves it to a real path and mixes it in).
 * "Không nhạc" clears the selection. The custom menu keeps select, preview,
 * add, and remove in one compact control instead of scattering peer buttons
 * across the storyboard toolbar.
 */
const BgmPicker: React.FC<{
  bgm: BgmTrackVM[];
  selected: string | null;
  busy: boolean;
  onAdd: () => void;
  onRemove: (name: string) => Promise<void>;
  onSelect: (name: string | null) => Promise<void>;
}> = ({ bgm, selected, busy, onAdd, onRemove, onSelect }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [open, setOpen] = useState(false);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const missing = selected !== null && !bgm.some((t) => t.name === selected);
  const selectedTrack = bgm.find((t) => t.name === selected);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useEffect(() => () => audioRef.current?.pause(), []);

  const stopPreview = (): void => {
    audioRef.current?.pause();
    setPreviewing(null);
  };
  const choose = (name: string | null): void => {
    stopPreview();
    void onSelect(name);
    setOpen(false);
  };
  const togglePreview = (track: BgmTrackVM): void => {
    const audio = audioRef.current;
    if (!audio || !track.previewUrl) return;
    if (previewing === track.name && !audio.paused) {
      stopPreview();
      return;
    }
    audio.pause();
    audio.src = track.previewUrl;
    audio.currentTime = 0;
    void audio.play()
      .then(() => setPreviewing(track.name))
      .catch(() => setPreviewing(null));
  };

  return (
    <div className="ns-bgm-picker" ref={rootRef}>
      <audio ref={audioRef} onEnded={() => setPreviewing(null)} />
      <div className="ns-bgm-control">
        <button
          className="ns-bgm-trigger"
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-busy={busy}
          disabled={busy}
          title="Chọn nhạc nền cho video"
          onClick={() => setOpen((value) => !value)}
        >
          <span className="ns-bgm-leading">{Icon.music({ size: 15 })}</span>
          <span className="ns-bgm-current">{selectedTrack?.label ?? (missing ? selected : "Không nhạc")}</span>
          <span className="ns-bgm-chevron">{Icon.chevronDown({ size: 14 })}</span>
        </button>
        <button className="ns-bgm-add" type="button" aria-label="Thêm nhạc nền" title="Thêm nhạc nền từ máy" disabled={busy} onClick={onAdd}>
          {Icon.plus({ size: 15 })}
        </button>
      </div>

      {open && (
        <div className="ns-bgm-menu" role="menu" aria-label="Nhạc nền">
          <div className="ns-bgm-row">
            <span className="ns-bgm-preview-spacer" />
            <button className="ns-bgm-choice" type="button" role="menuitemradio" aria-checked={selected === null} disabled={busy} onClick={() => choose(null)}>
              <span className="ns-bgm-name">Không nhạc</span>
              {selected === null && <span className="ns-bgm-check">{Icon.check({ size: 14 })}</span>}
            </button>
          </div>

          {missing && (
          <div className="ns-bgm-missing">Không tìm thấy “{selected}”. Chọn bài khác.</div>
          )}

          {bgm.map((track) => (
            <div className="ns-bgm-row" key={track.name}>
              <button
                className="ns-bgm-preview"
                type="button"
                aria-label={`${previewing === track.name ? "Dừng" : "Nghe thử"} ${track.label}`}
                title={previewing === track.name ? "Dừng nghe thử" : "Nghe thử"}
                disabled={busy}
                onClick={() => togglePreview(track)}
              >
                {previewing === track.name ? Icon.pause({ size: 13 }) : Icon.play({ size: 13 })}
              </button>
              <button className="ns-bgm-choice" type="button" role="menuitemradio" aria-checked={selected === track.name} disabled={busy} onClick={() => choose(track.name)}>
                <span className="ns-bgm-track-copy">
                  <span className="ns-bgm-name">{track.label}</span>
                  <span className="ns-bgm-size">{track.sizeLabel}</span>
                </span>
                {selected === track.name && <span className="ns-bgm-check">{Icon.check({ size: 14 })}</span>}
              </button>
              {!track.builtIn && (
                <button className="ns-bgm-remove" type="button" aria-label={`Xoá ${track.label}`} title="Xoá khỏi thư viện" disabled={busy} onClick={() => void onRemove(track.name)}>
                  {Icon.trash({ size: 13 })}
                </button>
              )}
            </div>
          ))}

          {bgm.length === 0 && <div className="ns-bgm-empty">Chưa có nhạc nền. Thêm bằng nút +.</div>}
        </div>
      )}
    </div>
  );
};

/**
 * Storyboard ("Duyệt cảnh"): Canva-style full-height shell — fixed header with
 * actions, a slide rail, a big 9:16 preview, and an on-demand edit panel. Edit
 * drafts are kept per-sceneId so switching slides preserves what you typed; all
 * edits are gathered and sent in ONE pass.
 */
export const StoryboardView: React.FC<{
  model: StoryboardModel;
  canApprove: boolean;
  notice?: string;
  /**
   * mediaUrl of the low-res draft MP4, when one has been rendered. Shown as the
   * big preview so the user can play the draft (pacing + voice) in-app instead
   * of digging through folders; absent → the big preview falls back to the
   * selected scene's still image.
   */
  draftPath?: string;
  onBack: () => void;
  /**
   * Submit the gathered edits. Resolves `true` when the backend accepted them
   * (the drafts are then safe to clear) and `false` when it did not — on `false`
   * the typed drafts are KEPT so a transient failure never destroys the user's
   * work across many scenes (audit P1-7).
   */
  onSubmit: (perScene: { sceneId: string; text: string }[], globalNotes: string) => Promise<boolean>;
  onApprove: () => void;
  /** Per-machine BGM library (shared across projects). Optional: only the "ready" stage passes it. */
  bgm?: BgmTrackVM[];
  /** The open project's currently-selected BGM track name (null = none). */
  bgmSelected?: string | null;
  /** Open the native picker to add audio file(s) to the library. */
  onBgmAdd?: () => void;
  /** Delete one library track by name. */
  onBgmRemove?: (name: string) => Promise<void>;
  /** Set (or clear, with null) the open project's BGM track; persisted to its manifest before the full render. */
  onBgmSelect?: (name: string | null) => Promise<void>;
}> = ({ model, canApprove, notice, draftPath, onBack, onSubmit, onApprove, bgm, bgmSelected, onBgmAdd, onBgmRemove, onBgmSelect }) => {
  const [selected, setSelected] = useState(0);
  // Per-scene edit drafts keyed by sceneId, so switching slides KEEPS what you
  // typed. You gather edits across many scenes and send them in ONE pass.
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [showEdit, setShowEdit] = useState(true);
  // When a draft video exists, the big preview defaults to playing it; this flips
  // to the selected scene's still (what you point at to edit one scene).
  const [showStill, setShowStill] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [bgmSaving, setBgmSaving] = useState(false);
  const notify = useNotifications();
  const lastNotice = useRef("");

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
  useEffect(() => {
    if (!notice || notice === lastNotice.current) return;
    lastNotice.current = notice;
    notify.warning({
      title: "Cần chú ý",
      message: compactNotificationMessage(notice, "Kiểm tra bản nháp trước khi duyệt."),
      details: notice,
    });
  }, [notice, notify]);

  const sendAll = (): void => {
    if (!canSend || submitting) return;
    setSubmitting(true);
    // Capture drafts, but DON'T clear them until the backend confirms — on a
    // failed/rejected submit the user keeps everything they typed (audit P1-7).
    void onSubmit(batch, notes.trim())
      .then((ok) => {
        if (ok) {
          setEdits({});
          setNotes("");
          setShowEdit(false);
        } else {
          notify.error({
            title: "Không gửi được chỉnh sửa",
            message: "Nội dung bạn nhập vẫn được giữ.",
            details: "Backend từ chối chỉnh sửa.",
          });
        }
      })
      .catch((error: unknown) => {
        const details = errorDetails(error);
        notify.error({
          title: "Không gửi được chỉnh sửa",
          message: "Nội dung bạn nhập vẫn được giữ.",
          details,
        });
      })
      .finally(() => setSubmitting(false));
  };
  const selectBgm = async (name: string | null): Promise<void> => {
    if (!onBgmSelect || bgmSaving) return;
    setBgmSaving(true);
    try {
      await onBgmSelect(name);
    } finally {
      setBgmSaving(false);
    }
  };
  const removeBgm = async (name: string): Promise<void> => {
    if (!onBgmRemove || bgmSaving) return;
    setBgmSaving(true);
    try {
      await onBgmRemove(name);
    } finally {
      setBgmSaving(false);
    }
  };

  // Full-height Canva-style shell: fixed header with actions, then a body that
  // fills the rest WITHOUT page scroll (rail + edit panel scroll internally).
  const Header = (
    <div className="ns-story-header">
      <button className="ns-btn" onClick={onBack}>Quay lại</button>
      <div className="ns-story-title">
        <strong style={{ fontSize: 16 }}>Duyệt cảnh</strong>
        {scenes.length > 0 && <span style={{ color: "var(--muted-foreground)", fontSize: 13 }}>Cảnh {idx + 1}/{scenes.length}</span>}
        {editedCount > 0 && <span style={{ color: "var(--brand)", fontSize: 13, fontWeight: 700 }}>· đã ghi {editedCount} cảnh</span>}
      </div>
      {scenes.length > 0 && (
        <>
          {bgm && onBgmAdd && onBgmRemove && onBgmSelect && (
            <BgmPicker bgm={bgm} selected={bgmSelected ?? null} busy={bgmSaving} onAdd={onBgmAdd} onRemove={removeBgm} onSelect={selectBgm} />
          )}
          <button className={`ns-btn ns-story-edit-toggle${showEdit ? " is-active" : ""}`} onClick={() => setShowEdit((v) => !v)}>
            {Icon.pencil({ size: 15 })}
            {showEdit ? `Sửa cảnh ${idx + 1}` : "Sửa cảnh"}
          </button>
          {showEdit && (
            <button className="ns-btn ns-btn-primary" disabled={!canSend || submitting} onClick={sendAll}
              title={canSend ? undefined : "Nhập yêu cầu cho một cảnh hoặc ghi chú chung trước khi gửi."}>
              {submitting ? "Đang gửi…" : editedCount > 0 ? `Gửi chỉnh sửa (${editedCount})` : "Gửi chỉnh sửa"}
            </button>
          )}
          <button className="ns-btn" disabled={!canApprove || bgmSaving} onClick={onApprove}
            title={bgmSaving ? "Đang lưu lựa chọn nhạc nền." : canApprove ? undefined : "Bản nháp chưa sẵn sàng để duyệt."}>Duyệt &amp; xuất bản</button>
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

      {/* Body fills the viewport; rail + edit panel scroll internally (no page scroll). */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", gap: 14, padding: 14 }}>
        {/* Slide rail */}
        <div style={{ width: 88, flexShrink: 0, display: "flex", flexDirection: "column", gap: 8, overflowY: "auto", paddingRight: 4 }}>
          {scenes.map((s, i) => (
            <button key={s.sceneId} onClick={() => { setSelected(i); setShowStill(true); }} title={`Cảnh ${i + 1}`} className="ns-thumb"
              style={{
                position: "relative", flexShrink: 0, padding: 0, cursor: "pointer", borderRadius: 8, overflow: "hidden",
                border: i === idx ? "2px solid var(--brand)" : "1px solid var(--border)",
                background: s.stillPath ? `center/cover no-repeat #0c0e12 url(${s.stillPath})` : "#101216",
                aspectRatio: "9 / 16", width: "100%",
                transition: "border-color 0.15s ease",
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

        {/* Big preview */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
          {draftPath && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              <div style={{ display: "inline-flex", borderRadius: 10, border: "1px solid rgba(255, 255, 255, 0.08)", overflow: "hidden", background: "rgba(255, 255, 255, 0.03)", padding: 4 }}>
                {[{ still: false, label: "Video nháp" }, { still: true, label: `Ảnh cảnh ${idx + 1}` }].map((seg) => {
                  const active = showStill === seg.still;
                  return (
                    <button key={seg.label} onClick={() => setShowStill(seg.still)}
                      style={{ border: "none", padding: "6px 16px", fontSize: 13, cursor: "pointer", lineHeight: 1.4,
                        borderRadius: 6,
                        background: active ? "var(--brand)" : "transparent",
                        color: active ? "#fff" : "var(--muted-foreground)", fontWeight: active ? 700 : 500,
                        boxShadow: active ? "0 2px 8px rgba(59, 130, 246, 0.35)" : "none",
                        transition: "all 0.15s ease" }}>
                      {seg.label}
                    </button>
                  );
                })}
              </div>
              <InfoHint text="Bản nháp nhẹ để xem nhịp và nghe giọng. Bản cuối sẽ nét hơn." />
            </div>
          )}
          
          <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateRows: "minmax(0, 1fr)", gridTemplateColumns: "minmax(0, 1fr)", placeItems: "center" }}>
            {draftPath && !showStill ? (
              <video src={draftPath} controls style={{ height: "100%", maxHeight: "100%", aspectRatio: "9 / 16", maxWidth: "100%",
                borderRadius: 12, border: "1px solid var(--border)", boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
                background: "#0c0e12", objectFit: "contain" }} />
            ) : (
              <div style={{ height: "100%", aspectRatio: "9 / 16", maxWidth: "100%",
                borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden",
                boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
                background: current?.stillPath ? `center/contain no-repeat #0c0e12 url(${current.stillPath})` : "#101216",
                display: "grid", placeItems: "center", color: "#3a3f49" }}>
                {!current?.stillPath && Icon.film({ size: 30 })}
              </div>
            )}
          </div>
        </div>

        {/* Edit panel */}
        {showEdit && (
          <aside className="ns-card ns-story-edit-panel" aria-label="Yêu cầu chỉnh sửa">
            <div className="ns-story-edit-heading">
              <div>
                <strong>Biên tập &amp; Góp ý</strong>
                <span>Gửi phản hồi chỉnh sửa cảnh hoặc toàn video</span>
              </div>
              <button className="ns-story-edit-close" type="button" aria-label="Đóng bảng chỉnh sửa" title="Đóng" onClick={() => setShowEdit(false)}>
                {Icon.close({ size: 16 })}
              </button>
            </div>

            <section className="ns-edit-scope is-scene">
              <div className="ns-edit-scope-heading">
                <span className="ns-edit-scope-icon">{Icon.pencil({ size: 15 })}</span>
                <strong>Yêu cầu Cảnh {idx + 1}</strong>
                <span className="ns-edit-scope-badge">Riêng cảnh này</span>
              </div>
              <textarea aria-label={`Yêu cầu chỉnh sửa cảnh ${idx + 1}`} className="ns-input ns-edit-textarea" value={current ? (edits[current.sceneId] ?? "") : ""}
                maxLength={2000} rows={4} onChange={(e) => setCurrentEdit(e.target.value)}
                placeholder="Nhập yêu cầu chỉnh sửa (đổi ảnh, chỉnh chữ...)" />
            </section>

            <section className="ns-edit-scope is-global">
              <div className="ns-edit-scope-heading">
                <span className="ns-edit-scope-icon">{Icon.globe({ size: 15 })}</span>
                <strong>Góp ý toàn video</strong>
                <span className="ns-edit-scope-badge">Mọi cảnh</span>
              </div>
              <textarea aria-label="Ghi chú chung cho cả video" className="ns-input ns-edit-textarea" value={notes} maxLength={2000} rows={3}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Nhập ghi chú chung cho toàn bộ video..." />
            </section>
          </aside>
        )}
      </div>
    </div>
  );
};
