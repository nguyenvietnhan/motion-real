import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { BgmTrackVM, StoryboardModel } from "../../shared/types.js";
import { Icon } from "../icons.js";
import { EmptyState, InfoHint } from "../primitives.js";
import { compactNotificationMessage, errorDetails, useNotifications } from "../notifications.js";
import { sceneIndexAtSeconds, seekSecondsForScene } from "../storyboard-timing.js";
import { placeDiagPanel, type DiagPanelPlacement } from "./diag-panel-placement.js";

const BGM_MENU_WIDTH_PX = 268;

/**
 * Background-music picker: a compact dropdown of the per-machine BGM
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<DiagPanelPlacement | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const missing = selected !== null && !bgm.some((t) => t.name === selected);
  const selectedTrack = bgm.find((t) => t.name === selected);

  const updatePlacement = useCallback((): void => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    setPlacement(
      placeDiagPanel(
        trigger.getBoundingClientRect(),
        { width: window.innerWidth, height: window.innerHeight },
        { preferredWidth: BGM_MENU_WIDTH_PX, preferredMaxHeight: 360 },
      ),
    );
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }
    updatePlacement();
  }, [open, updatePlacement, bgm.length]);

  useEffect(() => {
    if (!open) return;
    const onReposition = (): void => updatePlacement();
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, updatePlacement]);

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
          ref={triggerRef}
          className="ns-bgm-trigger"
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-busy={busy}
          disabled={busy}
          title="Nhạc nền"
          onClick={() => setOpen((value) => !value)}
        >
          <span className="ns-bgm-leading">{Icon.music({ size: 15 })}</span>
          <span className="ns-bgm-current">{selectedTrack?.label ?? (missing ? selected : "Không nhạc")}</span>
          <span className="ns-bgm-chevron">{Icon.chevronDown({ size: 14 })}</span>
        </button>
        <button className="ns-bgm-add" type="button" aria-label="Thêm nhạc" title="Thêm nhạc" disabled={busy} onClick={onAdd}>
          {Icon.plus({ size: 15 })}
        </button>
      </div>

      {open && placement && (
        <div
          className="ns-bgm-menu"
          role="menu"
          aria-label="Nhạc nền"
          style={{
            top: placement.top,
            left: placement.left,
            width: placement.width,
            maxHeight: placement.maxHeight,
          }}
        >
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
  /**
   * When false (skip_edit review mode), hide scene-edit chrome; stills + BGM +
   * full approve remain. Defaults to true for fixtures/call sites that omit it.
   */
  allowSceneEdit?: boolean;
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
  /** Optional diagnostics entry (ready-stage). */
  diagnosticsSlot?: React.ReactNode;
}> = ({ model, canApprove, notice, draftPath, allowSceneEdit = true, onBack, onSubmit, onApprove, bgm, bgmSelected, onBgmAdd, onBgmRemove, onBgmSelect, diagnosticsSlot }) => {
  const [selected, setSelected] = useState(0);
  // Per-scene edit drafts keyed by sceneId, so switching slides KEEPS what you
  // typed. You gather edits across many scenes and send them in ONE pass.
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  // When a draft video exists, the big preview defaults to playing it; this flips
  // to the selected scene's still (what you point at to edit one scene).
  // Default to video draft when present; rail click flips to that scene's still.
  const [showStill, setShowStill] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [bgmSaving, setBgmSaving] = useState(false);
  const notify = useNotifications();
  const lastNotice = useRef("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const pendingSeekRef = useRef<number | null>(null);
  /** Suppress timeupdate→rail sync while a programmatic seek is in flight (avoids thrash). */
  const seekingRef = useRef(false);

  const scenes = model.scenes;
  const idx = Math.min(selected, Math.max(0, scenes.length - 1));
  const current = scenes[idx];

  const seekVideoTo = (seconds: number): void => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(seconds)) return;
    if (video.readyState >= 1) {
      if (Math.abs(video.currentTime - seconds) > 0.05) {
        seekingRef.current = true;
        video.currentTime = seconds;
      } else {
        seekingRef.current = false;
      }
      pendingSeekRef.current = null;
    } else {
      pendingSeekRef.current = seconds;
    }
  };

  /** Rail click: select that scene and show its still (review/edit UX). Never force video mode. */
  const selectSceneOnRail = (i: number): void => {
    setSelected(i);
    setShowStill(true);
    pendingSeekRef.current = null;
    seekingRef.current = false;
    const video = videoRef.current;
    if (video) {
      try {
        video.pause();
      } catch (_error: unknown) {
        // ignore pause failures on detached media
      }
    }
  };

  /** Switch preview to draft video, seeking to the currently selected scene when timing exists. */
  const switchToVideoPreview = (): void => {
    const seek = seekSecondsForScene(scenes[idx]);
    if (seek !== undefined) pendingSeekRef.current = seek;
    setShowStill(false);
  };

  // After the video element mounts (or remounts), flush a pending seek for the selected scene.
  useEffect(() => {
    if (showStill || !draftPath) return;
    if (pendingSeekRef.current === null) return;
    // Defer so ref is attached after paint.
    const id = requestAnimationFrame(() => {
      if (pendingSeekRef.current !== null) seekVideoTo(pendingSeekRef.current);
    });
    return () => cancelAnimationFrame(id);
  }, [showStill, draftPath, selected]);

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
      title: "Chú ý",
      message: compactNotificationMessage(notice, "Kiểm tra trước khi xuất bản."),
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

  // Full-height shell: leading identity row + action cluster that wraps cleanly
  // on narrow windows (never overlap BGM / diagnostics / primary actions).
  const Header = (
    <header className="ns-story-header">
      <div className="ns-story-header-leading">
        <button type="button" className="ns-btn ns-story-back" onClick={onBack}>
          Quay lại
        </button>
        <div className="ns-story-title">
          <strong className="ns-story-heading">Duyệt</strong>
          {scenes.length > 0 && (
            <span className="ns-story-count ns-tabular" aria-label={`Cảnh ${idx + 1} trên ${scenes.length}`}>
              {idx + 1}/{scenes.length}
            </span>
          )}
        </div>
      </div>
      {scenes.length > 0 && (
        <div className="ns-story-header-actions">
          {/* Primary actions stay visible; secondary (log) collapses into overflow on narrow widths. */}
          {bgm && onBgmAdd && onBgmRemove && onBgmSelect && (
            <BgmPicker bgm={bgm} selected={bgmSelected ?? null} busy={bgmSaving} onAdd={onBgmAdd} onRemove={removeBgm} onSelect={selectBgm} />
          )}
          {allowSceneEdit && (
            <button
              type="button"
              className="ns-btn ns-story-send"
              disabled={!canSend || submitting}
              onClick={sendAll}
              title={canSend ? undefined : "Nhập yêu cầu trước khi gửi."}
            >
              {submitting ? "Đang gửi…" : editedCount > 0 ? (
                <span className="ns-tabular">Gửi ({editedCount})</span>
              ) : (
                "Gửi"
              )}
            </button>
          )}
          <button
            type="button"
            className="ns-btn ns-btn-primary ns-story-approve"
            disabled={!canApprove || bgmSaving}
            onClick={onApprove}
            title={
              bgmSaving
                ? "Đang lưu nhạc nền."
                : canApprove
                  ? undefined
                  : "Chưa sẵn sàng xuất bản."
            }
          >
            Xuất bản
          </button>
          {diagnosticsSlot ? <div className="ns-story-overflow">{diagnosticsSlot}</div> : null}
        </div>
      )}
    </header>
  );

  if (scenes.length === 0) {
    return (
      <div className="ns-story-shell">
        {Header}
        <div className="ns-story-empty-body">
          <EmptyState icon={Icon.film({ size: 34 })} title="Chưa có cảnh" hint="Thử tạo lại video." />
        </div>
      </div>
    );
  }

  return (
    <div className="ns-story-shell">
      {Header}

      {/* Body fills the viewport; rail + edit panel scroll internally (no page scroll). */}
      <div className={`ns-story-body${allowSceneEdit ? " has-edit" : ""}`}>
        {/* Slide rail */}
        <div className="ns-story-rail">
          {scenes.map((s, i) => (
            <button
              key={s.sceneId}
              type="button"
              onClick={() => selectSceneOnRail(i)}
              title={`Cảnh ${i + 1}`}
              className="ns-thumb ns-story-thumb"
              aria-current={i === idx ? "true" : undefined}
              style={{
                border: i === idx ? "2px solid var(--brand)" : "1px solid var(--border)",
                background: s.stillPath ? `center/cover no-repeat #0c0e12 url(${s.stillPath})` : "#101216",
              }}
            >
              <span className="ns-story-thumb-index">{i + 1}</span>
              {allowSceneEdit && hasEdit(s.sceneId) && (
                <span className="ns-story-thumb-edit" title="Đã ghi yêu cầu chỉnh sửa">
                  <svg className="ns-story-thumb-edit-icon" viewBox="0 0 512 512" width="9" height="9" fill="currentColor">
                    <path d="M362.7 19.3L314.3 67.7 444.3 197.7l48.4-48.4c25-25 25-65.5 0-90.5L453.3 19.3c-25-25-65.5-25-90.5 0zm-71 71L58.6 323.5c-10.4 10.4-18 23.3-22.2 37.4L1 490.7c-3.9 13 8.4 25.3 21.4 21.4l129.8-35.4c14.1-4.2 27-11.8 37.4-22.2L422.3 221.7 291.7 90.3z" />
                  </svg>
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Big preview */}
        <div className="ns-story-preview-pane">
          {draftPath && (
            <div className="ns-story-preview-toolbar">
              <div className="ns-story-segmented">
                <button
                  type="button"
                  onClick={() => switchToVideoPreview()}
                  className={`ns-story-segment${!showStill ? " is-active" : ""}`}
                >
                  Nháp
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowStill(true);
                    pendingSeekRef.current = null;
                    seekingRef.current = false;
                    videoRef.current?.pause();
                  }}
                  className={`ns-story-segment${showStill ? " is-active" : ""}`}
                >
                  {`Ảnh ${idx + 1}`}
                </button>
              </div>
              <InfoHint text="Bấm cảnh bên trái để xem ảnh." />
            </div>
          )}

          <div className="ns-story-preview-stage">
            {draftPath && !showStill ? (
              <video
                ref={videoRef}
                src={draftPath}
                controls
                className="ns-story-preview-media"
                onLoadedMetadata={() => {
                  if (pendingSeekRef.current !== null) {
                    seekVideoTo(pendingSeekRef.current);
                  }
                }}
                onSeeking={() => {
                  seekingRef.current = true;
                }}
                onSeeked={(e) => {
                  seekingRef.current = false;
                  // One stable rail update at the final seek position (not mid-scrub thrash).
                  const next = sceneIndexAtSeconds(scenes, e.currentTarget.currentTime);
                  if (next !== undefined && next !== selected) setSelected(next);
                }}
                onTimeUpdate={(e) => {
                  // Only follow playback while playing; ignore seeks / pause scrub thrash.
                  if (seekingRef.current || e.currentTarget.paused) return;
                  const next = sceneIndexAtSeconds(scenes, e.currentTarget.currentTime);
                  if (next !== undefined && next !== selected) setSelected(next);
                }}
              />
            ) : (
              <div
                className="ns-story-preview-media ns-story-preview-still"
                style={current?.stillPath ? { background: `center/contain no-repeat #0c0e12 url(${current.stillPath})` } : undefined}
              >
                {!current?.stillPath && Icon.film({ size: 30 })}
              </div>
            )}
          </div>
        </div>

        {/* Edit panel — hidden when reviewMode is skip_edit. */}
        {allowSceneEdit && (
          <aside className="ns-card ns-story-edit-panel" aria-label="Yêu cầu chỉnh sửa">
            <div className="ns-story-edit-heading">
              <strong>Chỉnh sửa</strong>
              <span>Góp ý theo cảnh hoặc cả video</span>
            </div>

            <section className="ns-edit-field">
              <label className="ns-edit-label" htmlFor={`edit-scene-${current?.sceneId ?? "none"}`}>
                Cảnh {idx + 1}
              </label>
              <textarea
                id={`edit-scene-${current?.sceneId ?? "none"}`}
                aria-label={`Yêu cầu cảnh ${idx + 1}`}
                className="ns-input ns-edit-textarea"
                value={current ? (edits[current.sceneId] ?? "") : ""}
                maxLength={2000}
                rows={4}
                onChange={(e) => setCurrentEdit(e.target.value)}
                placeholder="Ví dụ: to chữ, đổi nền…"
              />
            </section>

            <section className="ns-edit-field">
              <label className="ns-edit-label" htmlFor="edit-global-notes">
                Cả video
              </label>
              <textarea
                id="edit-global-notes"
                aria-label="Ghi chú cả video"
                className="ns-input ns-edit-textarea"
                value={notes}
                maxLength={2000}
                rows={3}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Góp ý chung…"
              />
            </section>
          </aside>
        )}
      </div>
    </div>
  );
};
