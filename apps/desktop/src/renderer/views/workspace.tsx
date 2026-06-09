import React, { useState } from "react";
import type { ProjectStage, ScriptLine } from "../../shared/types.js";
import { Icon } from "../icons.js";
import { EmptyState, PageHeader, Spinner } from "../primitives.js";
import { StoryboardView } from "./storyboard.js";

/**
 * Project workspace: staged flow (write script → review → render → scenes).
 * The "ready" stage hands off to StoryboardView (Canva editor); other stages
 * render their own status panels.
 */

const ScriptReview: React.FC<{
  lines: ScriptLine[];
  linkWarning?: string;
  onApply: (edits: { sceneId: string; narration?: string; headline?: string }[]) => void;
  onApprove: () => void;
}> = ({ lines, linkWarning, onApply, onApprove }) => {
  const [draft, setDraft] = useState<Record<string, { headline: string; narration: string }>>(
    Object.fromEntries(lines.map((l) => [l.sceneId, { headline: l.headline, narration: l.narration }])),
  );
  const [warningDismissed, setWarningDismissed] = useState(false);
  const edits = lines.map((l) => ({ sceneId: l.sceneId, headline: draft[l.sceneId]?.headline, narration: draft[l.sceneId]?.narration }));
  return (
    <>
      {linkWarning && !warningDismissed && (
        <div
          className="ns-card"
          role="status"
          style={{
            padding: "12px 14px",
            marginBottom: 16,
            display: "flex",
            alignItems: "center",
            gap: 10,
            borderColor: "#d97706",
            background: "rgba(217, 119, 6, 0.08)",
          }}
        >
          <span style={{ color: "#d97706", flexShrink: 0, display: "inline-flex" }}><Icon.info size={16} /></span>
          <span style={{ color: "var(--foreground)", fontSize: 13, flex: 1 }}>{linkWarning}</span>
          <button
            className="ns-btn"
            aria-label="Đóng cảnh báo"
            onClick={() => setWarningDismissed(true)}
            style={{ flexShrink: 0, padding: "4px 10px" }}
          >
            Đóng
          </button>
        </div>
      )}
      <div className="ns-card" style={{ padding: 16, marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <span style={{ color: "var(--muted-foreground)" }}>AI đã soạn kịch bản. Sửa lời đọc nếu cần, rồi duyệt để dựng video.</span>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button className="ns-btn" onClick={() => onApply(edits)}>Lưu</button>
          <button className="ns-btn ns-btn-primary" onClick={() => { onApply(edits); onApprove(); }}>Duyệt &amp; dựng video →</button>
        </div>
      </div>
      <div style={{ display: "grid", gap: 12 }}>
        {lines.map((l, i) => (
          <div key={l.sceneId} className="ns-card" style={{ padding: 16 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "baseline", marginBottom: 8 }}>
              <span style={{ color: "var(--brand)", fontWeight: 800 }}>{i + 1}</span>
              <input className="ns-input" value={draft[l.sceneId]?.headline ?? ""} placeholder="Tiêu đề cảnh"
                onChange={(e) => setDraft((d) => ({ ...d, [l.sceneId]: { ...d[l.sceneId]!, headline: e.target.value } }))}
                style={{ flex: 1, padding: "8px 10px" }} />
            </div>
            <textarea className="ns-input" value={draft[l.sceneId]?.narration ?? ""} rows={2} placeholder="Lời đọc"
              onChange={(e) => setDraft((d) => ({ ...d, [l.sceneId]: { ...d[l.sceneId]!, narration: e.target.value } }))}
              style={{ width: "100%" }} />
          </div>
        ))}
      </div>
    </>
  );
};

export const ProjectWorkspaceView: React.FC<{
  stage: ProjectStage;
  onBack: () => void;
  onRetry: () => void;
  onFixWithAi: () => void;
  onApplyScript: (edits: { sceneId: string; narration?: string; headline?: string }[]) => void;
  onApproveScript: () => void;
  onSubmitEdits: (perScene: { sceneId: string; text: string }[], globalNotes: string) => Promise<boolean>;
  onApproveDraft: () => void;
  onReveal: () => void;
}> = ({ stage, onBack, onRetry, onFixWithAi, onApplyScript, onApproveScript, onSubmitEdits, onApproveDraft, onReveal }) => {
  const title: Record<ProjectStage["kind"], string> = {
    writing: "Đang viết kịch bản",
    script: "Duyệt kịch bản",
    rendering: "Đang dựng video",
    ready: "Duyệt cảnh",
    published: "Đã xuất bản",
    error: "Gặp lỗi",
  };
  if (stage.kind === "ready") {
    return (
      <StoryboardView
        model={{ projectId: "", scenes: stage.scenes, globalNotes: "" }}
        canApprove
        notice={stage.notice}
        onBack={onBack}
        onSubmit={onSubmitEdits}
        onApprove={onApproveDraft}
      />
    );
  }

  return (
    <div className="ns-content">
      <PageHeader title={title[stage.kind]} action={<button className="ns-btn" onClick={onBack}>← Quay lại</button>} />
      {stage.kind === "writing" && (
        <div className="ns-card" style={{ padding: 48, display: "grid", placeItems: "center", gap: 12 }}>
          <Spinner />
          <p style={{ color: "var(--muted-foreground)", margin: 0 }}>AI đang viết kịch bản từ nội dung của bạn…</p>
        </div>
      )}
      {stage.kind === "script" && <ScriptReview lines={stage.lines} linkWarning={stage.linkWarning} onApply={onApplyScript} onApprove={onApproveScript} />}
      {stage.kind === "rendering" && (() => {
        const phase = stage.phase ?? "draft";
        const label =
          phase === "edit" ? "AI đang chỉnh sửa các cảnh theo yêu cầu…"
            : phase === "qa" ? "AI đang tự kiểm tra & sửa lỗi hình ảnh…"
              : phase === "full" ? "Đang dựng video bản đầy đủ (chất lượng cao)…"
                : "Đang dựng giọng đọc + bản nháp…";
        const indeterminate = phase === "edit" || phase === "qa" || stage.percent <= 0;
        return (
          <div className="ns-card" style={{ padding: 32 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <Spinner /> <span>{label}{indeterminate ? "" : ` ${stage.percent}%`}</span>
            </div>
            <div style={{ height: 8, background: "var(--muted)", borderRadius: 999, overflow: "hidden" }}>
              {indeterminate ? (
                <div className="ns-indeterminate" style={{ height: "100%", borderRadius: 999 }} />
              ) : (
                <div style={{ width: `${stage.percent}%`, height: "100%", background: "var(--brand)", borderRadius: 999, transition: "width 0.3s" }} />
              )}
            </div>
          </div>
        );
      })()}
      {stage.kind === "published" && (
        <EmptyState icon={Icon.film({ size: 34 })} title="Đã xuất bản video 🎬"
          hint="Video bản đầy đủ đã được dựng xong. Mở thư mục dự án để lấy file MP4."
          action={
            <div style={{ display: "flex", gap: 10 }}>
              <button className="ns-btn ns-btn-primary" onClick={onReveal}>{Icon.folder({ size: 15 })} Mở thư mục</button>
              <button className="ns-btn" onClick={onBack}>Quay lại Trang chủ</button>
            </div>
          } />
      )}
      {stage.kind === "error" && (
        <EmptyState icon={Icon.film({ size: 34 })} title="Gặp lỗi khi dựng" hint={stage.message}
          action={
            <div style={{ display: "flex", gap: 10 }}>
              {stage.fixable && (
                <button className="ns-btn ns-btn-primary" onClick={onFixWithAi}>Sửa bằng AI</button>
              )}
              <button className={stage.fixable ? "ns-btn" : "ns-btn ns-btn-primary"} onClick={onRetry}>{Icon.plus({ size: 15 })} Thử lại</button>
              <button className="ns-btn" onClick={onBack}>Quay lại Trang chủ</button>
            </div>
          } />
      )}
    </div>
  );
};
