import React, { useState } from "react";
import type { StoryboardModel } from "../../shared/types.js";
import { Icon } from "../icons.js";
import { EmptyState, InfoHint } from "../primitives.js";

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
}> = ({ model, canApprove, notice, draftPath, onBack, onSubmit, onApprove }) => {
  const [selected, setSelected] = useState(0);
  // Per-scene edit drafts keyed by sceneId, so switching slides KEEPS what you
  // typed. You gather edits across many scenes and send them in ONE pass.
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [showEdit, setShowEdit] = useState(false);
  // When a draft video exists, the big preview defaults to playing it; this flips
  // to the selected scene's still (what you point at to edit one scene).
  const [showStill, setShowStill] = useState(false);
  const [dismissedNotice, setDismissedNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

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
  const sendAll = (): void => {
    if (!canSend || submitting) return;
    setSubmitting(true);
    setSubmitError("");
    // Capture drafts, but DON'T clear them until the backend confirms — on a
    // failed/rejected submit the user keeps everything they typed (audit P1-7).
    void onSubmit(batch, notes.trim())
      .then((ok) => {
        if (ok) {
          setEdits({});
          setNotes("");
          setShowEdit(false);
        } else {
          setSubmitError("Không gửi được chỉnh sửa. Nội dung bạn nhập vẫn được giữ — hãy thử lại.");
        }
      })
      .catch(() => {
        setSubmitError("Không gửi được chỉnh sửa. Nội dung bạn nhập vẫn được giữ — hãy thử lại.");
      })
      .finally(() => setSubmitting(false));
  };

  // Full-height Canva-style shell: fixed header with actions, then a body that
  // fills the rest WITHOUT page scroll (rail + edit panel scroll internally).
  const Header = (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 18px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
      <button className="ns-btn" onClick={onBack}>← Quay lại</button>
      <div style={{ marginRight: "auto", display: "flex", alignItems: "baseline", gap: 10 }}>
        <strong style={{ fontSize: 16 }}>Duyệt cảnh</strong>
        {scenes.length > 0 && <span style={{ color: "var(--muted-foreground)", fontSize: 13 }}>Cảnh {idx + 1}/{scenes.length}</span>}
        {editedCount > 0 && <span style={{ color: "var(--brand)", fontSize: 13, fontWeight: 700 }}>· đã ghi {editedCount} cảnh</span>}
      </div>
      {scenes.length > 0 && (
        <>
          <button className={`ns-btn${showEdit ? " ns-btn-primary" : ""}`} onClick={() => setShowEdit((v) => !v)}>✎ Sửa cảnh</button>
          <button className="ns-btn ns-btn-primary" disabled={!canSend || submitting} onClick={sendAll}
            title={canSend ? undefined : "Chưa có chỉnh sửa nào — sửa một cảnh hoặc ghi chú chung trước khi gửi."}>
            {submitting ? "Đang gửi…" : editedCount > 0 ? `Gửi chỉnh sửa (${editedCount})` : "Gửi chỉnh sửa"}
          </button>
          <button className="ns-btn" disabled={!canApprove} onClick={onApprove}
            title={canApprove ? undefined : "Bản nháp chưa sẵn sàng để duyệt."}>Duyệt &amp; xuất bản</button>
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

      {notice && notice !== dismissedNotice && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "10px 14px 0", padding: "10px 14px",
          borderRadius: 8, border: "1px solid var(--warn)", background: "color-mix(in srgb, transparent 86%, var(--warn))", flexShrink: 0 }}>
          <span style={{ fontSize: 13, color: "var(--foreground)", marginRight: "auto" }}>{notice}</span>
          <button className="ns-btn" style={{ padding: "4px 10px" }} onClick={() => setDismissedNotice(notice)}>Đã hiểu</button>
        </div>
      )}

      {submitError && (
        <div role="alert" style={{ display: "flex", alignItems: "center", gap: 12, margin: "10px 14px 0", padding: "10px 14px",
          borderRadius: 8, border: "1px solid var(--danger)", background: "color-mix(in srgb, transparent 86%, var(--danger))", flexShrink: 0 }}>
          <span style={{ fontSize: 13, color: "var(--foreground)", marginRight: "auto" }}>{submitError}</span>
          <button className="ns-btn" style={{ padding: "4px 10px" }} onClick={() => setSubmitError("")}>Đã hiểu</button>
        </div>
      )}

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

        {/* Big preview (always visible; click a slide to enlarge it here). When a
            draft MP4 exists it is the default — the user plays it to check pacing
            + voice in-app; a toggle switches to the selected scene's still (what
            you point at to edit one scene). No draft → just the still. The video
            shares the still's exact frame so it is never larger than a scene image. */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
          {draftPath && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              {/* Minimal segmented toggle: one bordered track, the active segment
                  filled. No icons/emoji — the labels alone carry the purpose. */}
              <div style={{ display: "inline-flex", borderRadius: 8, border: "1px solid var(--border)", overflow: "hidden", background: "var(--muted)" }}>
                {[{ still: false, label: "Video nháp" }, { still: true, label: `Ảnh cảnh ${idx + 1}` }].map((seg) => {
                  const active = showStill === seg.still;
                  return (
                    <button key={seg.label} onClick={() => setShowStill(seg.still)}
                      style={{ border: "none", padding: "5px 14px", fontSize: 13, cursor: "pointer", lineHeight: 1.4,
                        background: active ? "var(--brand)" : "transparent",
                        color: active ? "#fff" : "var(--muted-foreground)", fontWeight: active ? 700 : 500 }}>
                      {seg.label}
                    </button>
                  );
                })}
              </div>
              {/* Hover-only hint: the shared (i) primitive, so the tooltip style
                  matches Settings instead of a raw native title bubble. */}
              <InfoHint text="Bản nháp nhẹ để xem nhịp & nghe giọng — bản cuối sẽ nét hơn." />
            </div>
          )}
          {/* Grid track is pinned to minmax(0,1fr) on both axes: an auto track would
              grow to the video's intrinsic 1080×1920, so once metadata loads the player
              would balloon past the still. Pinning bounds the cell to the container. */}
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

        {/* Edit panel — shown only on demand (toggle in header) */}
        {showEdit && (
          <div className="ns-card" style={{ width: 320, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10, padding: 14, overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <strong style={{ fontSize: 14 }}>Sửa cảnh {idx + 1}</strong>
              <button className="ns-btn" style={{ padding: "4px 10px" }} onClick={() => setShowEdit(false)}>Đóng</button>
            </div>
            <textarea aria-label={`Yêu cầu chỉnh sửa cảnh ${idx + 1}`} className="ns-input" value={current ? (edits[current.sceneId] ?? "") : ""}
              maxLength={2000} rows={5} onChange={(e) => setCurrentEdit(e.target.value)}
              placeholder="Nói tự nhiên điều muốn đổi cho cảnh này: “to chữ tiêu đề”, “đổi nền sang xanh”, “bỏ bớt chữ, thêm biểu đồ cột”…"
              style={{ width: "100%", resize: "none" }} />
            <label style={{ fontSize: 12, color: "var(--muted-foreground)" }}>Ghi chú chung cho cả video (tùy chọn)</label>
            <textarea aria-label="Ghi chú chung cho cả video" className="ns-input" value={notes} maxLength={2000} rows={3}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="vd “giọng nhanh hơn”, “tông màu ấm hơn”…"
              style={{ width: "100%", resize: "none" }} />
            <p style={{ margin: 0, fontSize: 12, color: "var(--muted-foreground)" }}>
              Chuyển cảnh khác để ghi thêm — yêu cầu được giữ lại tới khi bạn bấm “Gửi chỉnh sửa” trên đầu.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
