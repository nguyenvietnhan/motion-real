import React, { useEffect, useRef, useState } from "react";
import type { ProjectStage, ScriptLine, VideoFormatChoice } from "../../shared/types.js";
import {
  renderingPhaseIndeterminate,
  renderingPhaseParts,
  workspaceStageTitle,
  writingPhaseCopy,
} from "../../shared/stage-labels.js";
import { withMediaCacheBust } from "../../shared/media-cache-bust.js";
import { Icon } from "../icons.js";
import { EmptyState, PageHeader, Spinner, StableButtonLabel } from "../primitives.js";
import { StoryboardView } from "./storyboard.js";
import { ProjectDiagnosticsPanel } from "./project-diagnostics.js";
import type { ProjectDiagnosticsVM } from "../../shared/types.js";
import { ImageReviewView } from "./image-review.js";
import { compactNotificationMessage, errorDetails, useNotifications } from "../notifications.js";
import { useModalFocus } from "../use-modal-focus.js";

/**
 * Project workspace: staged flow (write script → review → render → scenes).
 * The "ready" stage hands off to StoryboardView (Canva editor); other stages
 * render their own status panels.
 */

/**
 * Final-screen Copy panel: publish title + hashtags with one-click copy for
 * short-form platforms. Title doubles as the project name (no inline hashtags).
 * Renders nothing when neither exists. Copy feedback stays on the icon button.
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
  evidence?: import("../../shared/types.js").ScriptEvidenceModel;
  onApply: (edits: { sceneId: string; narration?: string; headline?: string }[]) => void;
  onApprove: () => void;
}> = ({ lines, linkWarning, evidence, onApply, onApprove }) => {
  const [draft, setDraft] = useState<Record<string, { headline: string; narration: string }>>(
    Object.fromEntries(lines.map((l) => [l.sceneId, { headline: l.headline, narration: l.narration }])),
  );
  const [showEvidence, setShowEvidence] = useState(false);
  const notify = useNotifications();
  const lastWarning = useRef("");
  const edits = lines.map((l) => ({ sceneId: l.sceneId, headline: draft[l.sceneId]?.headline, narration: draft[l.sceneId]?.narration }));
  useEffect(() => {
    if (!linkWarning || linkWarning === lastWarning.current) return;
    lastWarning.current = linkWarning;
    notify.warning({
      title: "Không đọc được một số link",
      message: compactNotificationMessage(linkWarning, "App sẽ dùng phần nội dung đọc được."),
      details: linkWarning,
    });
  }, [linkWarning, notify]);

  return (
    <>
      <div className="ns-card ns-script-review-banner">
        <span className="ns-script-review-message">Sửa lời nếu cần, rồi duyệt.</span>
        <div className="ns-script-review-actions">
          <button className="ns-btn" onClick={() => onApply(edits)}>Lưu</button>
          <button className="ns-btn ns-btn-primary" onClick={() => { onApply(edits); onApprove(); }}>Duyệt</button>
        </div>
      </div>
      {evidence && evidence.sources.length > 0 && (
        <div className="ns-card ns-evidence-panel">
          <button type="button" className="ns-btn" onClick={() => setShowEvidence((v) => !v)}>
            <StableButtonLabel reserve={["Ẩn căn cứ nội dung", "Căn cứ nội dung"]}>
              {showEvidence ? "Ẩn căn cứ nội dung" : "Căn cứ nội dung"}
            </StableButtonLabel>
          </button>
          {showEvidence && (
            <div className="ns-evidence-list">
              {evidence.sources.map((s) => (
                <div key={s.id} className="ns-evidence-source">
                  <strong>{s.title}</strong>
                  <div className="ns-evidence-source-meta">
                    {s.site ? `${s.site} · ` : ""}
                    {s.publishedDate ? `${s.publishedDate} · ` : ""}
                    {s.sourceUrl}
                  </div>
                  <ul className="ns-evidence-claims">
                    {evidence.claims
                      .filter((c) => c.sourceId === s.id)
                      .map((c) => (
                        <li key={c.id} className="ns-evidence-claim">
                          <div>{c.text}</div>
                          {c.excerpt && <div className="ns-evidence-excerpt">“{c.excerpt}”</div>}
                          {c.sceneIds.length > 0 && (
                            <div className="ns-evidence-scenes">Cảnh: {c.sceneIds.join(", ")}</div>
                          )}
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="ns-script-list">
        {lines.map((l, i) => (
          <div key={l.sceneId} className="ns-card ns-script-card">
            {/* Left: Fixed-width scene index so numbers are perfectly aligned vertically */}
            <div className="ns-script-index-wrap">
              <span className="ns-script-index">{i + 1}</span>
            </div>

            {/* Center: Input fields (Heading & Textarea) */}
            <div className="ns-script-fields">
              <input className="ns-input" value={draft[l.sceneId]?.headline ?? ""} placeholder="Tiêu đề cảnh"
                onChange={(e) => setDraft((d) => ({ ...d, [l.sceneId]: { ...d[l.sceneId]!, headline: e.target.value } }))} />
              
              <textarea className="ns-input" value={draft[l.sceneId]?.narration ?? ""} rows={2} placeholder="Lời đọc"
                onChange={(e) => setDraft((d) => ({ ...d, [l.sceneId]: { ...d[l.sceneId]!, narration: e.target.value } }))} />
            </div>

            {/* Right: Media preview thumbnail slot (fixed-width, keeps text inputs perfectly aligned across all cards) */}
            <div className="ns-script-media-slot">
              {l.imagePath ? (
                <div
                  className="ns-script-media-thumb"
                  title="Ảnh AI gắn cho cảnh này"
                  style={{
                    background: `center/cover no-repeat #0c0e12 url(${l.imagePath})`,
                  }}
                />
              ) : (
                <div
                  className="ns-script-media-empty"
                  title="Cảnh này không dùng ảnh minh họa"
                >
                  {Icon.film({ size: 16 })}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
};

/**
 * Shared "job running" panel for writing + rendering: status row, progress,
 * Stop always bottom-right. Local `stopping` flips immediately so cancel lag
 * never looks like a dead button.
 */
const RunningJobPanel: React.FC<{
  label: string;
  detail?: string;
  percent?: number;
  indeterminate?: boolean;
  count?: string;
  onCancel: () => void;
}> = ({ label, detail, percent, indeterminate = true, count, onCancel }) => {
  const [stopping, setStopping] = useState(false);
  const showPct = !indeterminate && !stopping && typeof percent === "number";
  return (
    <div className="ns-card ns-running-card">
      <div className="ns-running-status">
        <Spinner />
        <div className="ns-running-copy">
          <div className="ns-running-label-row">
            <span className="ns-running-label">
              {stopping ? "Đang dừng…" : label}
              {!stopping && count ? (
                <>
                  {" "}
                  <span className="ns-running-count ns-tabular">{count}</span>
                  …
                </>
              ) : null}
            </span>
            {showPct && (
              <span className="ns-counter ns-counter-pct" aria-label={`${percent} phần trăm`}>
                {percent}%
              </span>
            )}
          </div>
          {!stopping && detail ? <p className="ns-running-detail">{detail}</p> : null}
        </div>
      </div>
      <div className="ns-progress-track">
        {indeterminate || stopping ? (
          <div className="ns-indeterminate ns-progress-fill" />
        ) : (
          <div className="ns-progress-fill" style={{ width: `${percent ?? 0}%` }} />
        )}
      </div>
      <div className="ns-running-actions">
        <button
          type="button"
          className="ns-btn"
          onClick={() => {
            setStopping(true);
            onCancel();
          }}
          disabled={stopping}
        >
          <StableButtonLabel reserve={["Đang dừng…", "Dừng"]}>{stopping ? "Đang dừng…" : "Dừng"}</StableButtonLabel>
        </button>
      </div>
    </div>
  );
};

const RenderingPanel: React.FC<{ stage: Extract<ProjectStage, { kind: "rendering" }>; onCancel: () => void }> = ({ stage, onCancel }) => {
  const parts = renderingPhaseParts(stage.phase, { qaPass: stage.qaPass, qaTotal: stage.qaTotal });
  const indeterminate = renderingPhaseIndeterminate(stage.phase, stage.percent);
  return (
    <RunningJobPanel
      label={parts.body}
      count={parts.count}
      percent={stage.percent}
      indeterminate={indeterminate}
      onCancel={onCancel}
    />
  );
};

/** Cover panel for the caption-free still of the first authored scene. */
const ThumbnailPanel: React.FC<{
  thumbnailPath?: string;
  format: VideoFormatChoice;
  onGenerate: () => Promise<{ thumbnailUrl: string } | null>;
  onSave: () => Promise<{ saved: boolean; error?: string }>;
}> = ({ thumbnailPath, format: _format, onGenerate, onSave }) => {
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [freshUrl, setFreshUrl] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const notify = useNotifications();
  const baseUrl = freshUrl ?? thumbnailPath ?? null;
  // media:// rejects query strings (403) — fragment-only bust via shared helper.
  const shownUrl = baseUrl ? withMediaCacheBust(baseUrl, nonce) : null;
  const lightboxRef = useRef<HTMLDivElement>(null);
  const lightboxCloseRef = useRef<HTMLButtonElement>(null);
  useModalFocus(previewOpen && Boolean(shownUrl), lightboxRef, () => setPreviewOpen(false), lightboxCloseRef);

  const generate = (): void => {
    if (generating) return;
    setGenerating(true);
    void onGenerate()
      .then((r) => {
        if (r?.thumbnailUrl) {
          setFreshUrl(r.thumbnailUrl);
          setNonce((n) => n + 1);
          return;
        }
        notify.warning({
          title: "Chưa tạo được ảnh bìa",
          message: "Thử lại sau khi video xong hẳn.",
        });
      })
      .catch((error: unknown) => {
        const details = errorDetails(error);
        notify.error({
          title: "Không tạo được ảnh bìa",
          message: compactNotificationMessage(details, "Thử lại."),
          details,
        });
      })
      .finally(() => setGenerating(false));
  };

  const save = (): void => {
    if (saving || !baseUrl) return;
    setSaving(true);
    setSaved(false);
    void onSave()
      .then((result) => {
        if (result.saved) {
          setSaved(true);
          notify.success({ title: "Đã lưu ảnh bìa" });
          setTimeout(() => setSaved(false), 1800);
        } else if (result.error) {
          notify.error({
            title: "Không lưu được ảnh bìa",
            message: compactNotificationMessage(result.error, "Thử lại."),
            details: result.error,
          });
        }
      })
      .catch((error: unknown) => {
        const details = errorDetails(error);
        notify.error({
          title: "Không lưu được ảnh bìa",
          message: compactNotificationMessage(details, "Thử lại."),
          details,
        });
      })
      .finally(() => setSaving(false));
  };

  return (
    <div className="ns-publish-section ns-cover-section">
      <span className="ns-publish-eyebrow">Ảnh bìa</span>
      {!shownUrl && (
        <div className="ns-cover-actions">
          <button className="ns-btn" onClick={generate} disabled={generating}>
            <StableButtonLabel reserve={["Đang tạo…", "Tạo ảnh bìa"]}>{generating ? "Đang tạo…" : "Tạo ảnh bìa"}</StableButtonLabel>
          </button>
        </div>
      )}
      {shownUrl && (
        <div className="ns-cover-media">
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
          <div ref={lightboxRef} className="ns-cover-lightbox-card" role="dialog" aria-modal="true" aria-label="Xem ảnh bìa kích thước lớn" onMouseDown={(event) => event.stopPropagation()} tabIndex={-1}>
            <button ref={lightboxCloseRef} className="ns-cover-lightbox-close" onClick={() => setPreviewOpen(false)} aria-label="Đóng ảnh bìa">
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
  projectId?: string;
  onBack: () => void;
  onRetry: () => void;
  onFixWithAi: () => void;
  onApplyScript: (edits: { sceneId: string; narration?: string; headline?: string }[]) => void;
  onApproveScript: () => void;
  onSubmitEdits: (perScene: { sceneId: string; text: string }[], globalNotes: string) => Promise<boolean>;
  onApproveDraft: () => void;
  /** When false, hide scene-edit chrome (skip_edit review mode). */
  allowSceneEdit?: boolean;
  onReveal: () => void;
  /** Copy the finished MP4 to a user-chosen location (native Save dialog). */
  onSave: () => void;
  /** Stop the in-flight render/author/edit job ("Dừng render"). */
  onCancel: () => void;
  /** Confirm the crawled-image selection (crawled-image review); empty ⇒ author text-only. */
  onSubmitImageReview: (selectedRefs: string[]) => void;
  /** Generate a caption-free cover from the first authored scene. */
  onGenerateThumbnail: () => Promise<{ thumbnailUrl: string } | null>;
  /** Copy the generated cover PNG through a native Save dialog. */
  onSaveThumbnail: () => Promise<{ saved: boolean; error?: string }>;
  loadDiagnostics?: (projectId: string) => Promise<ProjectDiagnosticsVM>;
}> = ({ stage, projectId, onBack, onRetry, onFixWithAi, onApplyScript, onApproveScript, onSubmitEdits, onApproveDraft, allowSceneEdit = true, onReveal, onSave, onCancel, onSubmitImageReview, onGenerateThumbnail, onSaveThumbnail, loadDiagnostics }) => {
  const title = workspaceStageTitle;
  if (stage.kind === "ready") {
    return (
      <StoryboardView
        model={{ projectId: projectId ?? "", scenes: stage.scenes, globalNotes: "" }}
        canApprove
        notice={stage.notice}
        draftPath={stage.draftPath}
        allowSceneEdit={allowSceneEdit}
        onBack={onBack}
        onSubmit={onSubmitEdits}
        onApprove={onApproveDraft}
        diagnosticsSlot={
          projectId && loadDiagnostics ? (
            <ProjectDiagnosticsPanel projectId={projectId} load={loadDiagnostics} />
          ) : undefined
        }
      />
    );
  }

  const writingLabel = stage.kind === "writing" ? writingPhaseCopy(stage.phase) : null;

  return (
    <div className="ns-content">
      <PageHeader title={title(stage.kind)} action={<button className="ns-btn" onClick={onBack}>Quay lại</button>} />
      {stage.kind === "writing" && writingLabel && (
        <RunningJobPanel
          label={writingLabel}
          indeterminate
          onCancel={onCancel}
        />
      )}
      {stage.kind === "script" && (
        <ScriptReview
          lines={stage.lines}
          linkWarning={stage.linkWarning}
          evidence={stage.evidence}
          onApply={onApplyScript}
          onApprove={onApproveScript}
        />
      )}
      {stage.kind === "image-review" && <ImageReviewView images={stage.images} onSubmit={onSubmitImageReview} />}
      {stage.kind === "rendering" && <RenderingPanel stage={stage} onCancel={onCancel} />}
      {stage.kind === "draft-recovery" && (
        <div className="ns-card ns-draft-recovery">
          <p className="ns-writing-title">Bản nháp đã khôi phục</p>
          {stage.notice ? <p className="ns-writing-detail">{stage.notice}</p> : null}
          {stage.draftPath ? (
            <video className="ns-draft-recovery-video" src={stage.draftPath} controls />
          ) : null}
          <div className="ns-error-actions">
            <button type="button" className="ns-btn" onClick={onReveal}>
              {Icon.folder({ size: 15 })} Mở thư mục
            </button>
            <button type="button" className="ns-btn" onClick={onBack}>
              Quay lại
            </button>
          </div>
        </div>
      )}
      {stage.kind === "published" && (
        // Two-column export screen (the pattern CapCut / Opus Clip / Descript use
        // when a render finishes): the video preview is fixed on the LEFT, and a
        // right rail carries the metadata + actions in a clear hierarchy — a "done"
        // badge, the primary download CTA, then the publish copy, then the cover as
        // a subordinate section. The preview no longer pushes everything down a
        // single narrow centred column.
        <div className="ns-publish">
          <div className="ns-publish-preview">
            <video
              className="ns-publish-video"
              src={stage.outputPath}
              controls
            />
          </div>
          <div className="ns-publish-rail">
            <div className="ns-publish-head">
              <h2 className="ns-publish-title">{stage.title || "Video đã sẵn sàng"}</h2>
            </div>
            <div className="ns-publish-cta">
              <button className="ns-btn ns-btn-primary" onClick={onSave}>{Icon.download({ size: 16 })} Lưu video</button>
              <button
                type="button"
                className="ns-btn ns-btn-icon-only"
                onClick={onReveal}
                title="Mở thư mục"
                aria-label="Mở thư mục"
              >
                {Icon.folder({ size: 16 })}
              </button>
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
        <>
          <EmptyState
            icon={Icon.film({ size: 34 })}
            // Soft titles: "Lỗi" feels dead-end; fixable → AI can help, else setup/retry.
            title={stage.fixable ? "Chưa dựng xong" : "Chưa thể dựng"}
            hint={stage.message}
            action={
              <div className="ns-error-actions">
                {stage.fixable ? (
                  // A content render defect: the grid is deterministic, so re-rendering
                  // the SAME code would fail identically — only an AI rewrite can help.
                  // Show just "Sửa bằng AI" (a redundant "Thử lại" would mislead).
                  <button className="ns-btn ns-btn-primary" onClick={onFixWithAi}>Sửa bằng AI</button>
                ) : (
                  // An author or infra error: re-running the failed loop is meaningful
                  // (infra blips self-heal; a fresh author attempt may succeed).
                  <button className="ns-btn ns-btn-primary" onClick={onRetry}>{Icon.refresh({ size: 14 })} Thử lại</button>
                )}
                <button className="ns-btn" onClick={onBack}>Về trang chủ</button>
                {projectId && loadDiagnostics && (
                  <ProjectDiagnosticsPanel projectId={projectId} load={loadDiagnostics} />
                )}
              </div>
            }
          />
        </>
      )}
    </div>
  );
};
