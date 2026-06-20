import React, { useEffect, useState } from "react";
import type { BgmTrackVM, ProjectStage, ScriptLine, VideoFormatChoice } from "../../shared/types.js";
import { Icon } from "../icons.js";
import { EmptyState, PageHeader, Spinner } from "../primitives.js";
import { StoryboardView } from "./storyboard.js";
import { ImageReviewView } from "./image-review.js";

/**
 * Project workspace: staged flow (write script → review → render → scenes).
 * The "ready" stage hands off to StoryboardView (Canva editor); other stages
 * render their own status panels.
 */

/**
 * Final-screen Copy panel (R9.5/H3): shows the AI-generated publish title and
 * hashtags with one-click copy each, so the user can paste them straight into
 * TikTok/YouTube. Title doubles as the project name (clean, no inline hashtags);
 * hashtags are the separate publish tags. Renders nothing when neither exists
 * (an older video authored before the title/hashtags split, or a YouTube video
 * with no hashtags). UI tạm (D-UI): a plain "Đã copy" flash, no toast system.
 */
const PublishCopyPanel: React.FC<{ title?: string; hashtags?: string[] }> = ({ title, hashtags }) => {
  const [copied, setCopied] = useState<"title" | "tags" | null>(null);
  if (!title && !(hashtags && hashtags.length > 0)) return null;
  const tagLine = hashtags?.join(" ") ?? "";
  const copy = (text: string, which: "title" | "tags"): void => {
    // navigator.clipboard is the renderer's standard path; a failure (no focus,
    // denied permission) just skips the "Đã copy" flash rather than throwing.
    void navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(which);
        setTimeout(() => setCopied(null), 1500);
      },
      () => {},
    );
  };
  // Quiet icon-copy: a check flashes in place for 1.5s on success. The button is
  // a subordinate affordance on the value row, not a peer action button.
  const copyBtn = (text: string, which: "title" | "tags") => (
    <button className={`ns-copy-btn${copied === which ? " is-copied" : ""}`} onClick={() => copy(text, which)}
      title={copied === which ? "Đã copy" : "Copy"} aria-label={copied === which ? "Đã copy" : "Copy"}>
      {copied === which ? Icon.check({ size: 16 }) : Icon.copy({ size: 15 })}
    </button>
  );
  return (
    <div className="ns-publish-section">
      <span className="ns-publish-eyebrow">Đăng tải</span>
      {title && (
        <div className="ns-meta-field">
          <span className="ns-meta-value">{title}</span>
          {copyBtn(title, "title")}
        </div>
      )}
      {hashtags && hashtags.length > 0 && (
        <div className="ns-meta-field">
          <span className="ns-meta-value tags">{tagLine}</span>
          {copyBtn(tagLine, "tags")}
        </div>
      )}
    </div>
  );
};

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
          <div key={l.sceneId} className="ns-card" style={{ padding: 16, display: "flex", gap: 14 }}>
            {/* Thumbnail of the image the AI chose to place on THIS scene (Phase 2
                Block B) — so the user sees, at script-review time, which photo each
                scene will carry. Absent when the AI gave the scene no image. */}
            {l.imagePath && (
              <div
                title="Ảnh AI gắn cho cảnh này"
                style={{
                  flexShrink: 0, width: 72, aspectRatio: "9 / 16", borderRadius: 8, overflow: "hidden",
                  border: "1px solid var(--border)",
                  background: `center/contain no-repeat #0c0e12 url(${l.imagePath})`,
                }}
              />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
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
          </div>
        ))}
      </div>
    </>
  );
};

/**
 * The "đang dựng" status panel + its Stop button. Kept as its own component so
 * it can hold local `stopping` state: the Electron main process is briefly
 * blocked by the synchronous N10 typecheck, so the engine-side cancel + the
 * 1.5s stage poll can lag a second or two behind the click. The renderer
 * process is NOT blocked, so we flip to "Đang dừng…" and disable the button the
 * instant it's pressed — the user gets immediate feedback and never feels the
 * need to spam-click (which only queued more ignored IPC messages). The flag
 * resets automatically when the stage leaves "rendering" (recover/ready/error).
 */
const RenderingPanel: React.FC<{ stage: Extract<ProjectStage, { kind: "rendering" }>; onCancel: () => void }> = ({ stage, onCancel }) => {
  const [stopping, setStopping] = useState(false);
  const phase = stage.phase ?? "draft";
  // The QA phase carries the current vision pass (qaPass/qaTotal) so the user
  // sees progress through the refine loop instead of an opaque, seemingly-stuck
  // spinner — "(lần 2/5)" tells them how many rounds remain.
  const qaSuffix = phase === "qa" && stage.qaPass && stage.qaTotal ? ` (lần ${stage.qaPass}/${stage.qaTotal})` : "";
  const label =
    phase === "edit" ? "AI đang chỉnh sửa các cảnh theo yêu cầu…"
      : phase === "qa" ? `AI đang soát lỗi hình ảnh${qaSuffix}…`
        : phase === "prepare" ? "Đang dựng bản nháp…"
          : phase === "full" ? "Đang dựng video bản đầy đủ (chất lượng cao)…"
            : "Đang dựng giọng đọc + bản nháp…";
  // "prepare" (the two hidden pre-draft renders) shows a neutral indeterminate
  // bar — no raw percent — so the user never sees the bland/bootstrap takes.
  const indeterminate = phase === "edit" || phase === "qa" || phase === "prepare" || stage.percent <= 0;
  return (
    <div className="ns-card" style={{ padding: 32 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <Spinner /> <span>{stopping ? "Đang dừng…" : `${label}${indeterminate ? "" : ` ${stage.percent}%`}`}</span>
      </div>
      <div style={{ height: 8, background: "var(--muted)", borderRadius: 999, overflow: "hidden" }}>
        {indeterminate || stopping ? (
          <div className="ns-indeterminate" style={{ height: "100%", borderRadius: 999 }} />
        ) : (
          <div style={{ width: `${stage.percent}%`, height: "100%", background: "var(--brand)", borderRadius: 999, transition: "width 0.3s" }} />
        )}
      </div>
      {/* Stop the in-flight render. A cancel is not a failure: the project
          returns to its prior reviewable stage (the draft/scenes it had),
          never an error screen. One press is enough — disable + show "Đang
          dừng…" immediately so the brief engine-side lag never looks like a
          dead button. */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
        <button className="ns-btn" onClick={() => { setStopping(true); onCancel(); }} disabled={stopping}>
          {stopping ? "Đang dừng…" : "Dừng dựng"}
        </button>
      </div>
    </div>
  );
};

/** Cover panel for the caption-free still of the first authored scene. */
const ThumbnailPanel: React.FC<{
  thumbnailPath?: string;
  format: VideoFormatChoice;
  onGenerate: () => Promise<{ thumbnailUrl: string } | null>;
  onSave: () => Promise<{ saved: boolean; error?: string }>;
}> = ({ thumbnailPath, format, onGenerate, onSave }) => {
  const isTikTok = format !== "youtube";
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [freshUrl, setFreshUrl] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const baseUrl = freshUrl ?? thumbnailPath ?? null;
  const shownUrl = baseUrl ? `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}t=${nonce}` : null;

  useEffect(() => {
    if (!previewOpen) return;
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setPreviewOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [previewOpen]);

  const generate = (): void => {
    if (generating) return;
    setGenerating(true);
    void onGenerate()
      .then((r) => {
        if (r) {
          setFreshUrl(r.thumbnailUrl);
          setNonce((n) => n + 1);
        }
      })
      .finally(() => setGenerating(false));
  };

  const save = (): void => {
    if (saving || !baseUrl) return;
    setSaving(true);
    setSaved(false);
    setSaveError("");
    void onSave()
      .then((result) => {
        if (result.saved) {
          setSaved(true);
          setTimeout(() => setSaved(false), 1800);
        } else if (result.error) {
          setSaveError(result.error);
        }
      })
      .catch(() => setSaveError("Không mở được hộp thoại lưu ảnh. Hãy thử lại."))
      .finally(() => setSaving(false));
  };

  return (
    <div className="ns-publish-section ns-cover-section">
      <span className="ns-publish-eyebrow">{isTikTok ? "Ảnh bìa" : "Thumbnail YouTube"}</span>
      {!shownUrl && (
        <div className="ns-cover-actions">
          <button className="ns-btn" onClick={generate} disabled={generating}>
            {generating ? "Đang tạo…" : "Tạo ảnh bìa"}
          </button>
        </div>
      )}
      {saveError && <span className="ns-cover-error" role="status">{saveError}</span>}
      {shownUrl && (
        <div className={`ns-cover-media${isTikTok ? "" : " is-landscape"}`}>
          <button
            type="button"
            className="ns-cover-preview"
            onClick={() => setPreviewOpen(true)}
            aria-label="Xem ảnh bìa kích thước lớn"
          >
            <img src={shownUrl} alt="Ảnh bìa lấy từ cảnh đầu tiên" />
            <span className="ns-cover-preview-hint">Xem lớn</span>
          </button>
          <button
            type="button"
            className={`ns-copy-btn ns-cover-download${saved ? " is-copied" : ""}`}
            onClick={save}
            disabled={saving}
            title={saved ? "Đã lưu" : "Tải ảnh PNG"}
            aria-label={saved ? "Đã lưu ảnh bìa" : "Tải ảnh bìa PNG"}
          >
            {saved ? Icon.check({ size: 16 }) : Icon.download({ size: 16 })}
          </button>
        </div>
      )}
      {previewOpen && shownUrl && (
        <div className="ns-modal-backdrop ns-cover-lightbox" role="presentation" onMouseDown={() => setPreviewOpen(false)}>
          <div className="ns-cover-lightbox-card" role="dialog" aria-modal="true" aria-label="Xem ảnh bìa kích thước lớn" onMouseDown={(event) => event.stopPropagation()}>
            <button className="ns-cover-lightbox-close" onClick={() => setPreviewOpen(false)} aria-label="Đóng ảnh bìa">
              {Icon.close({ size: 20 })}
            </button>
            <img src={shownUrl} alt="Ảnh bìa kích thước lớn" />
          </div>
        </div>
      )}
    </div>
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
  /** Copy the finished MP4 to a user-chosen location (native Save dialog). */
  onSave: () => void;
  /** Stop the in-flight render/author/edit job ("Dừng render"). */
  onCancel: () => void;
  /** Confirm the crawled-image selection (Phase 2 Block B); empty ⇒ author text-only. */
  onSubmitImageReview: (selectedRefs: string[]) => void;
  /** Per-machine BGM library (shared across projects); the picker in the storyboard lists these. */
  bgm: BgmTrackVM[];
  /** The open project's currently-selected BGM track name (null = none). */
  bgmSelected: string | null;
  /** Open the native picker to add audio file(s) to the library. */
  onBgmAdd: () => void;
  /** Delete one library track by name. */
  onBgmRemove: (name: string) => Promise<void>;
  /** Set (or clear, with null) the open project's BGM track; persisted to its manifest. */
  onBgmSelect: (name: string | null) => Promise<void>;
  /** Generate a caption-free cover from the first authored scene. */
  onGenerateThumbnail: () => Promise<{ thumbnailUrl: string } | null>;
  /** Copy the generated cover PNG through a native Save dialog. */
  onSaveThumbnail: () => Promise<{ saved: boolean; error?: string }>;
}> = ({ stage, onBack, onRetry, onFixWithAi, onApplyScript, onApproveScript, onSubmitEdits, onApproveDraft, onReveal, onSave, onCancel, onSubmitImageReview, bgm, bgmSelected, onBgmAdd, onBgmRemove, onBgmSelect, onGenerateThumbnail, onSaveThumbnail }) => {
  const title: Record<ProjectStage["kind"], string> = {
    writing: "Đang viết kịch bản",
    script: "Duyệt kịch bản",
    "image-review": "Duyệt ảnh",
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
        draftPath={stage.draftPath}
        onBack={onBack}
        onSubmit={onSubmitEdits}
        onApprove={onApproveDraft}
        bgm={bgm}
        bgmSelected={bgmSelected}
        onBgmAdd={onBgmAdd}
        onBgmRemove={onBgmRemove}
        onBgmSelect={onBgmSelect}
      />
    );
  }

  const writingCopy =
    stage.kind === "writing"
      ? stage.phase === "crawl"
        ? {
            title: "Đang đọc link và cào ảnh từ bài báo…",
            detail: "Nếu trang chặn đọc nội dung hoặc ảnh, app sẽ bỏ qua phần đó và tiếp tục dựng từ phần đọc được.",
          }
        : stage.phase === "image-filter"
          ? {
              title: "AI đang chọn ảnh phù hợp từ bài báo…",
              detail: "Ảnh quảng cáo, logo hoặc ảnh không liên quan sẽ bị lọc trước khi bạn duyệt.",
            }
          : {
              title: "AI đang viết kịch bản từ nội dung của bạn…",
              detail: "Quá trình này có thể mất vài phút. Ứng dụng sẽ tự tiếp tục khi hoàn tất.",
            }
      : null;

  return (
    <div className="ns-content">
      <PageHeader title={title[stage.kind]} action={<button className="ns-btn" onClick={onBack}>← Quay lại</button>} />
      {stage.kind === "writing" && (
        <div className="ns-card" style={{ padding: 48, display: "grid", placeItems: "center", gap: 12 }}>
          <Spinner />
          <p style={{ color: "var(--muted-foreground)", margin: 0 }}>{writingCopy?.title}</p>
          <p style={{ color: "var(--muted-foreground)", margin: 0, fontSize: 13, textAlign: "center", maxWidth: 520 }}>
            {writingCopy?.detail}
          </p>
        </div>
      )}
      {stage.kind === "script" && <ScriptReview lines={stage.lines} linkWarning={stage.linkWarning} onApply={onApplyScript} onApprove={onApproveScript} />}
      {stage.kind === "image-review" && <ImageReviewView images={stage.images} onSubmit={onSubmitImageReview} />}
      {stage.kind === "rendering" && <RenderingPanel stage={stage} onCancel={onCancel} />}
      {stage.kind === "published" && (
        // Two-column export screen (the pattern CapCut / Opus Clip / Descript use
        // when a render finishes): the video preview is fixed on the LEFT, and a
        // right rail carries the metadata + actions in a clear hierarchy — a "done"
        // badge, the primary download CTA, then the publish copy, then the cover as
        // a subordinate section. The preview no longer pushes everything down a
        // single narrow centred column.
        <div className="ns-publish">
          <div className={`ns-publish-preview${stage.format === "youtube" ? " is-landscape" : ""}`}>
            <video src={stage.outputPath} controls style={{ width: "100%", aspectRatio: stage.format === "youtube" ? "16 / 9" : "9 / 16",
              borderRadius: 12, border: "1px solid var(--border)", boxShadow: "0 12px 40px rgba(0,0,0,0.5)", background: "#0c0e12", objectFit: "contain" }} />
          </div>
          <div className="ns-publish-rail">
            <div className="ns-publish-head">
              <span className="ns-publish-done"><span className="ns-publish-done-icon">{Icon.check({ size: 16 })}</span>Đã xuất bản</span>
              <h2 className="ns-publish-title">{stage.title || "Video đã sẵn sàng"}</h2>
            </div>
            <div className="ns-publish-cta">
              <button className="ns-btn ns-btn-primary" onClick={onSave}>{Icon.download({ size: 16 })} Lưu video</button>
              <button className="ns-btn" onClick={onReveal}>{Icon.folder({ size: 15 })} Mở thư mục</button>
            </div>
            <PublishCopyPanel title={stage.title} hashtags={stage.hashtags} />
            <ThumbnailPanel
              thumbnailPath={stage.thumbnailPath}
              format={stage.format ?? "tiktok"}
              onGenerate={onGenerateThumbnail}
              onSave={onSaveThumbnail}
            />
          </div>
        </div>
      )}
      {stage.kind === "error" && (
        <EmptyState icon={Icon.film({ size: 34 })} title="Gặp lỗi khi dựng" hint={stage.message}
          action={
            <div style={{ display: "flex", gap: 10 }}>
              {stage.fixable ? (
                // A content render defect: the grid is deterministic, so re-rendering
                // the SAME code would fail identically — only an AI rewrite can help.
                // Show just "Sửa bằng AI" (a redundant "Thử lại" would mislead).
                <button className="ns-btn ns-btn-primary" onClick={onFixWithAi}>Sửa bằng AI</button>
              ) : (
                // An author or infra error: re-running the failed loop is meaningful
                // (infra blips self-heal; a fresh author attempt may succeed).
                <button className="ns-btn ns-btn-primary" onClick={onRetry}>{Icon.plus({ size: 15 })} Thử lại</button>
              )}
              <button className="ns-btn" onClick={onBack}>Quay lại Trang chủ</button>
            </div>
          } />
      )}
    </div>
  );
};
