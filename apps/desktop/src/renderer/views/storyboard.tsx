import React, { useState } from "react";
import type { StoryboardModel } from "../../shared/types.js";
import { Icon } from "../icons.js";
import { EmptyState } from "../primitives.js";

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
  onBack: () => void;
  onSubmit: (perScene: { sceneId: string; text: string }[], globalNotes: string) => void;
  onApprove: () => void;
}> = ({ model, canApprove, notice, onBack, onSubmit, onApprove }) => {
  const [selected, setSelected] = useState(0);
  // Per-scene edit drafts keyed by sceneId, so switching slides KEEPS what you
  // typed. You gather edits across many scenes and send them in ONE pass.
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [showEdit, setShowEdit] = useState(false);
  const [dismissedNotice, setDismissedNotice] = useState("");

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
    if (!canSend) return;
    onSubmit(batch, notes.trim());
    setEdits({}); // optimistic clear — the edits are being applied + re-rendered
    setNotes("");
    setShowEdit(false);
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
          <button className="ns-btn ns-btn-primary" disabled={!canSend} onClick={sendAll}>
            {editedCount > 0 ? `Gửi chỉnh sửa (${editedCount})` : "Gửi chỉnh sửa"}
          </button>
          <button className="ns-btn" disabled={!canApprove} onClick={onApprove}>Duyệt &amp; xuất bản</button>
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

      {/* Body fills the viewport; rail + edit panel scroll internally (no page scroll). */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", gap: 14, padding: 14 }}>
        {/* Slide rail */}
        <div style={{ width: 88, flexShrink: 0, display: "flex", flexDirection: "column", gap: 8, overflowY: "auto", paddingRight: 4 }}>
          {scenes.map((s, i) => (
            <button key={s.sceneId} onClick={() => setSelected(i)} title={`Cảnh ${i + 1}`} className="ns-thumb"
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

        {/* Big preview (always visible; click a slide to enlarge it here) */}
        <div style={{ flex: 1, minWidth: 0, display: "grid", placeItems: "center" }}>
          <div style={{ height: "100%", aspectRatio: "9 / 16", maxWidth: "100%",
            borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden",
            boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
            background: current?.stillPath ? `center/contain no-repeat #0c0e12 url(${current.stillPath})` : "#101216",
            display: "grid", placeItems: "center", color: "#3a3f49" }}>
            {!current?.stillPath && Icon.film({ size: 30 })}
          </div>
        </div>

        {/* Edit panel — shown only on demand (toggle in header) */}
        {showEdit && (
          <div className="ns-card" style={{ width: 320, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10, padding: 14, overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <strong style={{ fontSize: 14 }}>Sửa cảnh {idx + 1}</strong>
              <button className="ns-btn" style={{ padding: "4px 10px" }} onClick={() => setShowEdit(false)}>Đóng</button>
            </div>
            <textarea aria-label={`edit-${current?.sceneId}`} className="ns-input" value={current ? (edits[current.sceneId] ?? "") : ""}
              maxLength={2000} rows={5} onChange={(e) => setCurrentEdit(e.target.value)}
              placeholder="Nói tự nhiên điều muốn đổi cho cảnh này: “to chữ tiêu đề”, “đổi nền sang xanh”, “bỏ bớt chữ, thêm biểu đồ cột”…"
              style={{ width: "100%", resize: "none" }} />
            <label style={{ fontSize: 12, color: "var(--muted-foreground)" }}>Ghi chú chung cho cả video (tùy chọn)</label>
            <textarea aria-label="global-notes" className="ns-input" value={notes} maxLength={2000} rows={3}
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
