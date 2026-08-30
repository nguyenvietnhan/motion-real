import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { agentProjectProgress, shouldPollAgentActivities, shouldPollProjectStage } from "../../shared/agent-project-progress.js";
import { reviewModeAllowsSceneEdit } from "../../shared/settings-model.js";
import type {
  AgentBriefInput,
  AgentDraftVM,
  AgentProductionState,
  AgentSearchProvider,
  AgentSettingsVM,
  DurationTierChoice,
  ProjectStage,
  ReviewMode,
  VideoLanguageChoice,
  VoiceProviderChoice,
} from "../../shared/types.js";
import { Icon } from "../icons.js";
import { ConfirmDialog, CustomSelect, EmptyState, LoadingLine, PageHeader, Spinner, StableButtonLabel } from "../primitives.js";
import { useDismissable } from "../use-dismissable.js";
import { useModalFocus } from "../use-modal-focus.js";
import { ImageReviewView } from "./image-review.js";
import { ProjectWorkspaceView } from "./workspace.js";
import {
  isAgentBriefInputDirty,
  reconcileAgentBriefInput,
  requiresBriefDiscardConfirmation,
  type AgentBriefBaseline,
  type BriefDiscardAction,
} from "./agent-brief-state.js";
import {
  applyVideoLanguageSelection,
  applyVoiceProviderSelection,
  KnobButton,
  languageOptionsForProvider,
} from "./home.js";

const PRODUCTION_LABELS: Record<AgentProductionState, string> = {
  discovery: "Đang trao đổi ý tưởng",
  collecting_assets: "Đang thu thập asset",
  asset_review: "Chờ duyệt asset",
  preparing_brief: "Đang chuẩn bị brief",
  brief_review: "Chờ duyệt brief",
  queued_create: "Đang chờ tạo video",
  authoring: "Agent đang viết cảnh",
  visual_refine: "Agent đang kiểm tra ảnh",
  scene_review: "Chờ duyệt từng cảnh",
  paused: "Đã tạm dừng",
  error: "Cần xử lý lỗi",
};

const ASSET_ROLE_LABEL = { hero: "Ảnh chính", support: "Bổ trợ", logo: "Logo", icon: "Icon" } as const;
type Run = (work: () => Promise<void>) => Promise<void>;
type BriefDiscardRequest = { action: BriefDiscardAction; feedback?: string };

function briefInputFor(
  brief: AgentDraftVM["briefReview"],
  durationTier: DurationTierChoice,
  voiceProvider: VoiceProviderChoice,
): AgentBriefInput | null {
  if (!brief) return null;
  return {
    title: brief.title,
    prompt: brief.prompt,
    durationTier,
    videoLanguage: brief.videoLanguage,
    voiceProvider,
  };
}

export const AgentView: React.FC<{
  reviewMode: ReviewMode;
  defaultDurationTier: DurationTierChoice;
  defaultVoiceProvider: VoiceProviderChoice;
  incomingDraft?: AgentDraftVM | null;
  onIncomingDraftHandled?: () => void;
}> = ({
  reviewMode,
  defaultDurationTier,
  defaultVoiceProvider,
  incomingDraft = null,
  onIncomingDraftHandled,
}) => {
  const [drafts, setDrafts] = useState<AgentDraftVM[]>([]);
  const [active, setActive] = useState<AgentDraftVM | null>(null);
  const [projectProgress, setProjectProgress] = useState<Record<string, ReturnType<typeof agentProjectProgress>>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const listed = await window.dashboard.agent.list();
      setDrafts(listed);
      const progress = await Promise.all(listed.map(async (draft) => {
        if (!draft.projectId) return null;
        try {
          return [draft.id, agentProjectProgress(await window.dashboard.projects.stage(draft.projectId))] as const;
        } catch (_error) {
          return null;
        }
      }));
      setProjectProgress(Object.fromEntries(progress.filter((value): value is readonly [string, ReturnType<typeof agentProjectProgress>] => value !== null)));
      setNotice(null);
    } catch (_error) {
      setNotice("Không đọc được danh sách Video Agent.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!incomingDraft) return;
    setActive(incomingDraft);
    onIncomingDraftHandled?.();
    void refresh();
  }, [incomingDraft, onIncomingDraftHandled, refresh]);

  const run = useCallback<Run>(async (work) => {
    setBusy(true);
    setNotice(null);
    try {
      await work();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Video Agent gặp lỗi trước khi thay đổi video.");
      throw error;
    } finally {
      setBusy(false);
    }
  }, []);

  const createDraft = async (title: string): Promise<void> => {
    await run(async () => {
      try {
        setActive(await window.dashboard.agent.createDraft(title));
      } finally {
        await refresh();
      }
    });
  };

  const openDraft = async (draft: AgentDraftVM): Promise<void> => {
    await run(async () => {
      setActive(await window.dashboard.agent.openDraft(draft.id));
      await refresh();
    });
  };

  const renameDraft = async (draft: AgentDraftVM, title: string): Promise<void> => {
    await run(async () => {
      const renamed = await window.dashboard.agent.renameDraft(draft.id, title);
      setDrafts((current) => current.map((item) => (item.id === renamed.id ? renamed : item)));
      setActive((current) => (current?.id === renamed.id ? renamed : current));
      await refresh();
    });
  };

  const deleteDraft = async (draft: AgentDraftVM): Promise<void> => {
    await run(async () => {
      await window.dashboard.agent.deleteDraft(draft.id);
      setDrafts((current) => current.filter((item) => item.id !== draft.id));
      setActive((current) => (current?.id === draft.id ? null : current));
      await refresh();
    });
  };

  if (!active) {
    return (
      <AgentLibrary
        drafts={drafts}
        projectProgress={projectProgress}
        loading={loading}
        busy={busy}
        notice={notice}
        onCreate={createDraft}
        onOpen={openDraft}
        onRename={renameDraft}
        onDelete={deleteDraft}
      />
    );
  }

  return (
    <AgentWorkspace
      draft={active}
      reviewMode={reviewMode}
      defaultDurationTier={defaultDurationTier}
      defaultVoiceProvider={defaultVoiceProvider}
      busy={busy}
      notice={notice}
      onBack={() => {
        setActive(null);
        setNotice(null);
        void refresh();
      }}
      onDraftChange={(next) => {
        setActive(next);
        setDrafts((current) => current.map((item) => (item.id === next.id ? next : item)));
      }}
      run={run}
    />
  );
};

type AgentLibraryProps = {
  drafts: AgentDraftVM[];
  projectProgress?: Record<string, ReturnType<typeof agentProjectProgress>>;
  loading: boolean;
  busy: boolean;
  notice: string | null;
  onCreate: (title: string) => Promise<void> | void;
  onOpen: (draft: AgentDraftVM) => Promise<void> | void;
  onRename: (draft: AgentDraftVM, title: string) => Promise<void> | void;
  onDelete: (draft: AgentDraftVM) => Promise<void> | void;
};

export const AgentLibrary: React.FC<AgentLibraryProps> = ({
  drafts,
  projectProgress = {},
  loading,
  busy,
  notice,
  onCreate,
  onOpen,
  onRename,
  onDelete,
}) => {
  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<AgentDraftVM | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AgentDraftVM | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);

  const menuWrapRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setMenuId(null), []);
  useDismissable(Boolean(menuId), closeMenu, menuWrapRef);

  return (
    <section className="ns-agent-view ns-agent-library" aria-label="Thư viện Video Agent">
      <div className="ns-content">
        <PageHeader
          title="Video Agent"
          action={
            <button
              type="button"
              className="ns-btn ns-btn-primary"
              onClick={() => setCreateOpen(true)}
              disabled={busy}
            >
              {Icon.plus({ size: 16 })} Tạo video mới
            </button>
          }
        />
        {notice && (
          <p className="ns-agent-notice" role="alert">
            {notice}
          </p>
        )}
        {loading && <LoadingLine />}
        {!loading && drafts.length === 0 && (
          <EmptyState
            icon={Icon.spark({ size: 32 })}
            title="Chưa có video Agent"
            hint="Tạo một workspace để bắt đầu nghiên cứu và làm video."
            action={
              <button type="button" className="ns-btn ns-btn-primary" onClick={() => setCreateOpen(true)}>
                Tạo video mới
              </button>
            }
          />
        )}
        {!loading && drafts.length > 0 && (
          <div className="ns-agent-table" role="list" aria-label="Video Agent" ref={menuWrapRef}>
            <div className="ns-agent-table-head" aria-hidden="true">
              <span>Tên video</span>
              <span>Trạng thái</span>
              <span>Cập nhật</span>
              <span />
            </div>
            {drafts.map((draft) => (
              <div className="ns-agent-row" role="listitem" key={draft.id}>
                <button
                  type="button"
                  className="ns-agent-row-open"
                  onClick={() => {
                    void Promise.resolve(onOpen(draft)).catch((_error) => undefined);
                  }}
                  disabled={busy}
                >
                  <span className="ns-agent-row-title">
                    <span className="ns-agent-row-icon">{Icon.film({ size: 17 })}</span>
                    <strong>{draft.title}</strong>
                  </span>
                  <span className={`ns-agent-row-state is-${projectProgress[draft.id]?.state ?? draft.productionState}`}>
                    {projectProgress[draft.id]?.label ?? PRODUCTION_LABELS[draft.productionState]}
                  </span>
                  <time dateTime={draft.updatedAt}>{formatUpdatedAt(draft.updatedAt)}</time>
                </button>
                <div className="ns-agent-row-menu-wrap">
                  <button
                    type="button"
                    className="ns-btn ns-btn-icon-only ns-agent-row-menu-trigger"
                    aria-label={`Tùy chọn ${draft.title}`}
                    aria-expanded={menuId === draft.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      setMenuId((current) => (current === draft.id ? null : draft.id));
                    }}
                  >
                    {Icon.more({ size: 18 })}
                  </button>
                  {menuId === draft.id && (
                    <div className="ns-agent-row-menu" role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuId(null);
                          setRenameTarget(draft);
                        }}
                      >
                        {Icon.pencil({ size: 15 })} <span>Đổi tên</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="danger"
                        onClick={() => {
                          setMenuId(null);
                          setDeleteTarget(draft);
                        }}
                      >
                        {Icon.trash({ size: 15 })} <span>Xóa video</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <AgentNameDialog
        open={createOpen}
        title="Tạo video mới"
        confirmLabel="Tạo workspace"
        initialValue=""
        busy={busy}
        onCancel={() => setCreateOpen(false)}
        onConfirm={async (title) => {
          await onCreate(title);
          setCreateOpen(false);
        }}
      />
      <AgentNameDialog
        open={Boolean(renameTarget)}
        title="Đổi tên video"
        confirmLabel="Lưu"
        initialValue={renameTarget?.title ?? ""}
        busy={busy}
        onCancel={() => setRenameTarget(null)}
        onConfirm={async (title) => {
          if (!renameTarget) return;
          await onRename(renameTarget, title);
          setRenameTarget(null);
        }}
      />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Xóa toàn bộ video Agent?"
        message="Project/video MotionReal, workspace Agent, asset, research và lịch sử hội thoại của video này sẽ bị xóa. Hành động không thể hoàn tác."
        confirmLabel="Xóa toàn bộ"
        cancelLabel="Huỷ"
        danger
        onConfirm={() => {
          if (deleteTarget)
            void Promise.resolve(onDelete(deleteTarget))
              .then(() => setDeleteTarget(null))
              .catch((_error) => undefined);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
};

export const AgentNameDialog: React.FC<{
  open: boolean;
  title: string;
  confirmLabel: string;
  initialValue: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (title: string) => Promise<void> | void;
}> = ({ open, title, confirmLabel, initialValue, busy, onCancel, onConfirm }) => {
  const [value, setValue] = useState(initialValue);
  const dialogRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setValue(initialValue), [initialValue, open]);
  useModalFocus(open, dialogRef, onCancel, inputRef);

  if (!open) return null;
  return (
    <div className="ns-modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <form
        ref={dialogRef}
        className="ns-modal ns-agent-name-dialog"
        role="dialog"
        aria-modal="true"
        onSubmit={(event) => {
          event.preventDefault();
          if (value.trim()) void Promise.resolve(onConfirm(value.trim())).catch((_error) => undefined);
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="ns-modal-head">
          <h2 className="ns-modal-title">{title}</h2>
        </div>
        <div className="ns-agent-name-dialog-body">
          <label htmlFor="agent-name-input" style={{ display: "grid", gap: 8, fontSize: 13, fontWeight: 500 }}>
            <span>Tên video</span>
            <input
              ref={inputRef}
              id="agent-name-input"
              className="ns-input"
              value={value}
              maxLength={120}
              placeholder="Nhập tên video..."
              disabled={busy}
              onChange={(event) => setValue(event.target.value)}
            />
          </label>
        </div>
        <div className="ns-agent-dialog-actions">
          <button type="button" className="ns-btn" onClick={onCancel} disabled={busy}>
            Huỷ
          </button>
          <button type="submit" className="ns-btn ns-btn-primary" disabled={busy || !value.trim()}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
};

type AgentWorkspaceProps = {
  draft: AgentDraftVM;
  reviewMode: ReviewMode;
  /** Defaults preserve the standalone visual-audit fixture; App always supplies Settings values. */
  defaultDurationTier?: DurationTierChoice;
  defaultVoiceProvider?: VoiceProviderChoice;
  busy: boolean;
  notice: string | null;
  onBack: () => void;
  onDraftChange: (draft: AgentDraftVM) => void;
  run: Run;
};

export const AgentWorkspace: React.FC<AgentWorkspaceProps> = ({
  draft,
  reviewMode: _reviewMode,
  defaultDurationTier = 2,
  defaultVoiceProvider = "vivibe",
  busy,
  notice,
  onBack,
  onDraftChange,
  run,
}) => {
  const briefBaselineRef = useRef<AgentBriefBaseline | null>(null);
  const [briefInput, setBriefInput] = useState<AgentBriefInput | null>(() =>
    briefInputFor(draft.briefReview, defaultDurationTier, defaultVoiceProvider),
  );
  const [showBriefReview, setShowBriefReview] = useState(true);
  const [pendingBriefDiscard, setPendingBriefDiscard] = useState<BriefDiscardRequest | null>(null);
  const [projectStage, setProjectStage] = useState<ProjectStage | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<AgentSettingsVM | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [searchApiKey, setSearchApiKey] = useState("");
  const [pendingFullAccess, setPendingFullAccess] = useState(false);
  const [frameKey, setFrameKey] = useState(0);
  const [frameFailed, setFrameFailed] = useState(false);
  const [showNativeChat, setShowNativeChat] = useState(false);
  const [createStartFailed, setCreateStartFailed] = useState(false);

  useEffect(() => {
    setCreateStartFailed(false);
  }, [draft.id, draft.workflowRevision]);

  useEffect(() => {
    if (!shouldPollAgentActivities(draft.productionState, showNativeChat)) return;
    const refresh = (): void => {
      void window.dashboard.agent.status(draft.id, { includeActivities: true }).then(onDraftChange).catch((_error) => undefined);
    };
    refresh();
    const timer = window.setInterval(() => {
      refresh();
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [draft.id, draft.productionState, onDraftChange, showNativeChat]);

  useEffect(() => {
    if (!draft.briefReview) {
      briefBaselineRef.current = null;
      setBriefInput(null);
      return;
    }
    const input = briefInputFor(draft.briefReview, defaultDurationTier, defaultVoiceProvider);
    if (!input) return;
    const next = reconcileAgentBriefInput(
      briefBaselineRef.current,
      briefInput,
      draft.id,
      draft.briefReview.revision,
      input,
    );
    briefBaselineRef.current = next.baseline;
    if (next.didReset) {
      setBriefInput(next.input);
      setShowBriefReview(true);
    }
  }, [draft.id, draft.briefReview?.revision]);

  useEffect(() => {
    if (!draft.projectId) {
      setProjectStage(null);
      return;
    }
    let alive = true;
    let refreshInFlight = false;
    let fallbackTimer: number | undefined;
    const clearFallback = (): void => {
      if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer);
      fallbackTimer = undefined;
    };
    const scheduleFallback = (): void => {
      if (!alive || fallbackTimer !== undefined) return;
      fallbackTimer = window.setTimeout(() => {
        fallbackTimer = undefined;
        void refreshStage();
      }, 1_500);
    };
    const refreshStage = async (): Promise<void> => {
      if (refreshInFlight) return;
      refreshInFlight = true;
      try {
        const next = await window.dashboard.projects.stage(draft.projectId!);
        if (alive) {
          setProjectStage(next);
          if (shouldPollProjectStage(agentProjectProgress(next))) scheduleFallback();
          else clearFallback();
        }
      } catch (_error) {
        /* keep last authoritative stage */
      } finally {
        refreshInFlight = false;
      }
    };
    void refreshStage();
    const refreshForProject = (event: { projectId?: string }) => {
      if (event.projectId === draft.projectId) {
        clearFallback();
        void refreshStage();
      }
    };
    const unsubscribe = [
      window.dashboard.events.onProgress(refreshForProject),
      window.dashboard.events.onStatus(refreshForProject),
    ];
    return () => {
      alive = false;
      clearFallback();
      unsubscribe.forEach((stop) => stop());
    };
  }, [draft.projectId]);

  const updateDraft = async (work: () => Promise<AgentDraftVM>): Promise<void> => {
    await run(async () => onDraftChange(await work()));
  };

  const startProject = async (): Promise<void> => {
    try {
      await window.dashboard.agent.createVideo(draft.id);
      onDraftChange(await window.dashboard.agent.status(draft.id));
      setCreateStartFailed(false);
    } catch (error) {
      setCreateStartFailed(true);
      throw error;
    }
  };

  const completeBriefDiscard = (request: BriefDiscardRequest): void => {
    if (request.action === "back") {
      onBack();
      return;
    }
    if (request.action === "return_to_assets") {
      void updateDraft(() =>
        window.dashboard.agent.returnToAssets(draft.id, draft.workflowRevision),
      ).catch((_error) => undefined);
      return;
    }
    if (request.feedback) {
      void updateDraft(() =>
        window.dashboard.agent.requestBriefChanges(draft.id, draft.workflowRevision, request.feedback!),
      ).catch((_error) => undefined);
    }
  };

  const requestBriefDiscard = (request: BriefDiscardRequest): void => {
    if (requiresBriefDiscardConfirmation(request.action, briefBaselineRef.current?.input ?? null, briefInput)) {
      setPendingBriefDiscard(request);
      return;
    }
    completeBriefDiscard(request);
  };

  const liveProgress = projectStage ? agentProjectProgress(projectStage) : null;
  const displayedState = liveProgress?.state ?? draft.productionState;
  const progressLabel = liveProgress?.label ?? PRODUCTION_LABELS[draft.productionState];
  const reviewObscuresChat = Boolean(
    (draft.productionState === "asset_review" && draft.assetReview) ||
      (draft.productionState === "brief_review" && draft.briefReview && showBriefReview),
  );
  const showProjectSurface = Boolean(
    draft.projectId
      && projectStage
      && (liveProgress?.state === "scene_review" || liveProgress?.state === "published" || liveProgress?.state === "error"),
  );
  const workflowObscuresChat =
    !showNativeChat && !reviewObscuresChat && !showProjectSurface &&
    ([
      "collecting_assets",
      "preparing_brief",
      "queued_create",
      "authoring",
      "visual_refine",
      "paused",
    ].includes(draft.productionState)
      || liveProgress?.state === "authoring"
      || liveProgress?.state === "rendering");

  const openSettings = () => {
    setSettingsOpen(true);
    setSettingsError(null);
    void run(async () => setSettings(await window.dashboard.agent.settings(draft.id))).catch((error) =>
      setSettingsError(error instanceof Error ? error.message : "Không đọc được cài đặt Agent."),
    );
  };

  const contextualAction = useMemo(() => {
    if (draft.productionState === "paused")
      return {
        label: "Tiếp tục",
        icon: Icon.play({ size: 15 }),
        run: () => updateDraft(() => window.dashboard.agent.resumeWorkflow(draft.id, draft.workflowRevision)),
      };
    if (draft.productionState === "error")
      return {
        label: draft.retryAction === "rerender_stills" ? "Thử render ảnh" : "Thử lại bước này",
        icon: Icon.refresh({ size: 15 }),
        run: () => updateDraft(() => window.dashboard.agent.retryWorkflow(draft.id, draft.workflowRevision)),
      };
    if (
      draft.productionState === "collecting_assets" ||
      draft.productionState === "preparing_brief" ||
      draft.productionState === "authoring" ||
      draft.productionState === "visual_refine"
    )
      return {
        label: "Dừng",
        icon: Icon.close({ size: 15 }),
        run: () => updateDraft(() => window.dashboard.agent.pauseWorkflow(draft.id, draft.workflowRevision)),
      };
    if (liveProgress?.canCancel && draft.projectId)
      return {
        label: "Dừng",
        icon: Icon.close({ size: 15 }),
        run: () =>
          run(async () => {
            await window.dashboard.projects.cancel(draft.projectId!);
          }),
      };
    if (draft.productionState === "discovery")
      return {
        label: "Thu thập asset",
        icon: Icon.spark({ size: 15 }),
        run: () => updateDraft(() => window.dashboard.agent.prepareAssets(draft.id, draft.workflowRevision)),
      };
    if (draft.productionState === "brief_review" && !draft.briefReview)
      return {
        label: "Tạo lại brief",
        icon: Icon.refresh({ size: 15 }),
        run: () => updateDraft(() => window.dashboard.agent.prepareBrief(draft.id, draft.workflowRevision)),
      };
    if (draft.createReady)
      return {
        label: createStartFailed ? "Thử bắt đầu dựng" : "Bắt đầu dựng",
        icon: Icon.spark({ size: 15 }),
        run: () => run(startProject),
      };
    return null;
  }, [createStartFailed, draft, liveProgress?.canCancel, liveProgress?.state, startProject]);

  return (
    <section className="ns-agent-view ns-agent-workspace" aria-label={`Video Agent ${draft.title}`}>
      <header className={`ns-agent-workspace-bar is-${displayedState}`}>
        <button
          type="button"
          className="ns-btn ns-btn-icon-only"
          onClick={() => requestBriefDiscard({ action: "back" })}
          disabled={busy}
          aria-label="Quay lại danh sách Video Agent"
          title="Quay lại danh sách Video Agent"
        >
          {Icon.chevronLeft({ size: 18 })}
        </button>
        <div className="ns-agent-workspace-title">
          <strong>{draft.title}</strong>
          <span>{progressLabel}</span>
        </div>
        <div className="ns-agent-workspace-actions">
          {contextualAction && (
            <button
              type="button"
              className="ns-btn ns-btn-primary"
              onClick={() => {
                void contextualAction.run().catch((_error) => undefined);
              }}
              disabled={busy}
            >
              {contextualAction.icon}
              <span>{contextualAction.label}</span>
            </button>
          )}
          <button
            type="button"
            className="ns-btn ns-btn-icon-only"
            aria-label="Cài đặt Agent"
            title="Cài đặt Agent"
            onClick={openSettings}
            disabled={busy}
          >
            {Icon.settings({ size: 18 })}
          </button>
        </div>
      </header>

      {notice && (
        <p className="ns-agent-notice" role="status">
          {notice}
        </p>
      )}
      {draft.sessionAccess === "legacy-approval" && (
        <p className="ns-agent-notice is-warning" role="status">
          Phiên cũ có thể yêu cầu duyệt quyền ngay trong chat.
        </p>
      )}
      {draft.assetCollectionError && (
        <p className="ns-agent-notice is-danger" role="alert">
          {draft.assetCollectionError}
        </p>
      )}
      {draft.briefReviewError && (
        <p className="ns-agent-notice is-danger" role="alert">
          {draft.briefReviewError}
        </p>
      )}

      {draft.productionState === "asset_review" && draft.assetReview && (
        <div className="ns-agent-asset-review">
          <ImageReviewView
            key={`${draft.id}-${draft.workflowRevision}`}
            images={draft.assetReview.map((asset) => ({
              ref: asset.id,
              previewUrl: asset.previewUrl,
              width: asset.width,
              height: asset.height,
              sourceUrl: asset.sourceUrl,
              label: `${asset.label} · ${ASSET_ROLE_LABEL[asset.role]}`,
              suggested: draft.selectedAssetIds === undefined || draft.selectedAssetIds.includes(asset.id),
            }))}
            initialSelectedRefs={draft.selectedAssetIds ?? draft.assetReview.map((asset) => asset.id)}
            approveLabel="Chấp nhận"
            onRequestMore={(ids, note) => {
              void updateDraft(() =>
                window.dashboard.agent.requestMoreAssets(draft.id, draft.workflowRevision, ids, note),
              ).catch((_error) => undefined);
            }}
            onSubmit={(ids) => {
              void updateDraft(() =>
                window.dashboard.agent.approveAssets(draft.id, draft.workflowRevision, ids),
              ).catch((_error) => undefined);
            }}
          />
        </div>
      )}

      {draft.productionState === "brief_review" && draft.briefReview && briefInput && showBriefReview && (
        <BriefReview
          draft={draft}
          input={briefInput}
          busy={busy}
          onInput={setBriefInput}
          onContinue={() => setShowBriefReview(false)}
          onReturn={() => {
            requestBriefDiscard({ action: "return_to_assets" });
          }}
          onApprove={() => {
            void run(async () => {
              const accepted = await window.dashboard.agent.approveBrief(draft.id, draft.workflowRevision, briefInput);
              onDraftChange(accepted);
              await startProject();
            }).catch((_error) => undefined);
          }}
          onRequestChanges={(feedback) => {
            requestBriefDiscard({ action: "request_changes", feedback });
          }}
        />
      )}

      {draft.productionState === "brief_review" && draft.briefReview && !showBriefReview && (
        <div className="ns-agent-inline-action ns-card">
          <span>Kịch bản Brief đang chờ duyệt trước khi tạo video.</span>
          <button type="button" className="ns-btn ns-btn-primary" onClick={() => setShowBriefReview(true)}>
            {Icon.pencil({ size: 15 })} Mở duyệt brief
          </button>
        </div>
      )}

      {showProjectSurface && projectStage && draft.projectId && (
        <ProjectWorkspaceView
          stage={projectStage}
          projectId={draft.projectId}
          hideHeader
          allowSceneEdit={reviewModeAllowsSceneEdit(_reviewMode)}
          loadDiagnostics={(id) => window.dashboard.projects.diagnostics(id)}
          onBack={onBack}
          onRetry={() => {
            const retry = projectStage.kind === "error" ? projectStage.retry : undefined;
            if (retry === "full") void window.dashboard.review.approveDraft(draft.projectId!);
            else if (retry === "draft") void window.dashboard.projects.fixWithAi(draft.projectId!);
            else void window.dashboard.projects.retry(draft.projectId!);
          }}
          onFixWithAi={() => void window.dashboard.projects.fixWithAi(draft.projectId!)}
          onApplyScript={(edits) => void window.dashboard.script.applyEdits(draft.projectId!, edits)}
          onApproveScript={() => void window.dashboard.script.approve(draft.projectId!)}
          onSubmitEdits={async (perScene, globalNotes) => {
            try {
              const result = await window.dashboard.review.submitEdits(draft.projectId!, { perScene, globalNotes });
              return result.ok !== false;
            } catch (_error) {
              return false;
            }
          }}
          onApproveDraft={() => void window.dashboard.review.approveDraft(draft.projectId!)}
          onReveal={() => void window.dashboard.projects.reveal(draft.projectId!)}
          onSave={() => void window.dashboard.projects.save(draft.projectId!)}
          onCancel={() => void window.dashboard.projects.cancel(draft.projectId!)}
          onSubmitImageReview={(refs) => void window.dashboard.projects.submitImageReview(draft.projectId!, refs)}
          onGenerateThumbnail={() => window.dashboard.thumbnail.generate(draft.projectId!)}
          onSaveThumbnail={() => window.dashboard.thumbnail.save(draft.projectId!)}
        />
      )}

      {workflowObscuresChat && (
        <AgentWorkflowProgress
          label={progressLabel}
          activities={draft.activities}
          paused={draft.productionState === "paused"}
          needsAttention={draft.needsAttention === true}
          onOpenChat={() => setShowNativeChat(true)}
        />
      )}

      {showNativeChat && (
        <div className="ns-agent-inline-action ns-card">
          <span>Đang mở chat để bạn phản hồi Agent.</span>
          <button type="button" className="ns-btn" onClick={() => setShowNativeChat(false)}>Quay lại quy trình</button>
        </div>
      )}

      {!reviewObscuresChat && !showProjectSurface && !workflowObscuresChat && draft.harnessUrl && !frameFailed && (
        <iframe
          key={`${draft.harnessUrl}-${frameKey}`}
          className="ns-agent-frame"
          src={motionrealHarnessUrl(draft.harnessUrl)}
          title={`MotionReal Agent — ${draft.title}`}
          allow="clipboard-write"
          sandbox="allow-scripts allow-forms allow-same-origin allow-downloads allow-popups"
          referrerPolicy="no-referrer"
          onError={() => setFrameFailed(true)}
        />
      )}

      {!reviewObscuresChat && !showProjectSurface && !workflowObscuresChat && (!draft.harnessUrl || frameFailed) && (
        <div className="ns-agent-placeholder">
          <Spinner />
          <p>{frameFailed ? "Không mở được cuộc trò chuyện Agent." : "Đang khởi động Agent…"}</p>
          {frameFailed && (
            <button
              type="button"
              className="ns-btn ns-btn-primary"
              onClick={() => {
                setFrameFailed(false);
                setFrameKey((value) => value + 1);
              }}
            >
              Thử lại
            </button>
          )}
        </div>
      )}

      <AgentSettingsDialog
        open={settingsOpen}
        busy={busy}
        settings={settings}
        error={settingsError}
        searchApiKey={searchApiKey}
        onSearchApiKeyChange={setSearchApiKey}
        onClose={() => {
          setSettingsOpen(false);
          setSearchApiKey("");
          setSettingsError(null);
        }}
        onSearchProvider={(provider) =>
          void run(async () => {
            await window.dashboard.agent.setSearchProvider(draft.id, provider);
            setSettings((current) => (current ? { ...current, searchProvider: provider } : current));
          }).catch((error) =>
            setSettingsError(error instanceof Error ? error.message : "Không lưu được dịch vụ tìm kiếm."),
          )
        }
        onSaveSearchKey={() =>
          void run(async () => {
            const next = await window.dashboard.agent.setSearchApiKey(draft.id, searchApiKey);
            onDraftChange(next);
            setSearchApiKey("");
            setSettings((current) => (current ? { ...current, webSearchConfigured: true } : current));
          }).catch((error) => setSettingsError(error instanceof Error ? error.message : "Không lưu được API key."))
        }
        onModel={(modelId) =>
          void run(async () => setSettings(await window.dashboard.agent.selectModel(draft.id, modelId))).catch(
            (error) => setSettingsError(error instanceof Error ? error.message : "Không đổi được model."),
          )
        }
        onAccess={(presetId, confirmation) => {
          if (confirmation) {
            setPendingFullAccess(true);
            return;
          }
          void run(async () => setSettings(await window.dashboard.agent.setAccess(draft.id, presetId))).catch(
            (error) => setSettingsError(error instanceof Error ? error.message : "Không đổi được quyền truy cập."),
          );
        }}
      />
      <ConfirmDialog
        open={Boolean(pendingBriefDiscard)}
        title="Bỏ các chỉnh sửa brief?"
        message="Các thay đổi chưa được chấp nhận sẽ mất. Bạn vẫn có thể ở lại để tiếp tục chỉnh brief."
        confirmLabel="Bỏ chỉnh sửa"
        cancelLabel="Ở lại"
        onCancel={() => setPendingBriefDiscard(null)}
        onConfirm={() => {
          const request = pendingBriefDiscard;
          setPendingBriefDiscard(null);
          if (request) completeBriefDiscard(request);
        }}
      />
      <ConfirmDialog
        open={pendingFullAccess}
        title="Cho phép toàn quyền?"
        message="Agent có thể dùng terminal và thay đổi mọi file mà Harness truy cập được. Chỉ bật khi bạn tin tưởng yêu cầu hiện tại."
        confirmLabel="Bật toàn quyền"
        cancelLabel="Huỷ"
        danger
        onCancel={() => setPendingFullAccess(false)}
        onConfirm={() => {
          setPendingFullAccess(false);
          void run(async () =>
            setSettings(await window.dashboard.agent.setAccess(draft.id, "danger-full-access")),
          ).catch((error) => setSettingsError(error instanceof Error ? error.message : "Không đổi được quyền truy cập."));
        }}
      />
    </section>
  );
};

const AgentWorkflowProgress: React.FC<{
  label: string;
  activities?: AgentDraftVM["activities"];
  paused: boolean;
  needsAttention?: boolean;
  onOpenChat?: () => void;
}> = ({ label, activities, paused, needsAttention = false, onOpenChat }) => (
  <section className="ns-agent-workflow-progress" aria-label="Tiến trình Video Agent">
    <div className="ns-agent-workflow-card ns-card">
      <div className="ns-agent-workflow-header">
        <div className="ns-agent-workflow-spinner-wrap">
          {paused ? <span className="ns-agent-paused-icon">{Icon.pause({ size: 22 })}</span> : <Spinner />}
        </div>
        <h2 className="ns-agent-workflow-title">{paused ? "Đã tạm dừng" : label}</h2>
      </div>
      <div className="ns-agent-activity-wrap">
        <ol className="ns-agent-activity-list">
          {activities?.length ? (
            activities.map((activity) => (
              <li key={activity.id} className={`is-${activity.status}`}>
                <span className="ns-agent-activity-dot" aria-hidden="true" />
                <span className="ns-agent-activity-label">{activity.label}</span>
                <em>
                  {activity.status === "running"
                    ? "Đang chạy"
                    : activity.status === "failed"
                      ? "Cần thử lại"
                      : "Hoàn tất"}
                </em>
              </li>
            ))
          ) : (
            <li className="is-running">
              <span className="ns-agent-activity-dot" aria-hidden="true" />
              <span className="ns-agent-activity-label">Agent đang bắt đầu công việc</span>
              <em>Đang chạy</em>
            </li>
          )}
        </ol>
      </div>
      {needsAttention && onOpenChat && (
        <div className="ns-agent-workflow-attention">
          <span>Agent cần bạn phản hồi.</span>
          <button type="button" className="ns-btn ns-btn-primary" onClick={onOpenChat}>Mở chat</button>
        </div>
      )}
    </div>
  </section>
);

const BriefReview: React.FC<{
  draft: AgentDraftVM;
  input: AgentBriefInput;
  busy: boolean;
  onInput: (value: AgentBriefInput) => void;
  onContinue: () => void;
  onReturn: () => void;
  onApprove: () => void;
  onRequestChanges: (feedback: string) => void;
}> = ({ draft, input, busy, onInput, onContinue, onReturn, onApprove, onRequestChanges }) => {
  const [openKnob, setOpenKnob] = useState<null | "duration" | "language" | "voice">(null);
  const [editPromptOpen, setEditPromptOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  const copyPrompt = (): void => {
    if (!input.prompt.trim()) return;
    void navigator.clipboard?.writeText(input.prompt).then(
      () => {
        setCopiedPrompt(true);
        setTimeout(() => setCopiedPrompt(false), 1500);
      },
      () => {},
    );
  };

  return (
    <section className="ns-agent-brief-review" aria-label="Duyệt brief">
      <div className="ns-agent-brief-container">
        {/* Header */}
        <div className="ns-agent-brief-head">
          <div className="ns-agent-brief-head-info">
            <h2>Duyệt kịch bản Brief</h2>
            <span className="ns-agent-badge">Revision {draft.briefReview!.revision} · 9:16</span>
          </div>
          <button type="button" className="ns-btn" onClick={onContinue}>
            Đóng brief
          </button>
        </div>

        {/* Title Input */}
        <div className="ns-agent-brief-field">
          <label htmlFor="agent-brief-title" className="ns-agent-brief-label">
            Tiêu đề video
          </label>
          <input
            id="agent-brief-title"
            className="ns-input ns-agent-brief-title-input"
            value={input.title}
            maxLength={160}
            placeholder="Nhập tiêu đề video..."
            onChange={(event) => onInput({ ...input, title: event.target.value })}
          />
        </div>

        {/* Delivery Knob Chips */}
        <div className="ns-agent-brief-knobs-section">
          <span className="ns-agent-brief-label">Cấu hình:</span>
          <div className="ns-agent-brief-knobs" role="group" aria-label="Cấu hình kịch bản">
            <KnobButton
              icon={Icon.clock({ size: 14 })}
              title="Thời lượng"
              value={input.durationTier}
              open={openKnob === "duration"}
              onToggle={() => setOpenKnob((k) => (k === "duration" ? null : "duration"))}
              onClose={() => setOpenKnob(null)}
              onChange={(tier) => onInput({ ...input, durationTier: tier })}
              options={[
                { value: 1, label: "0:45 (~45s)" },
                { value: 2, label: "1:30 (~90s)" },
                { value: 3, label: "2:30 (~150s)" },
                { value: 4, label: "3:30 (~210s)" },
              ]}
            />
            <KnobButton
              icon={Icon.globe({ size: 14 })}
              title="Ngôn ngữ"
              value={input.videoLanguage}
              open={openKnob === "language"}
              onToggle={() => setOpenKnob((k) => (k === "language" ? null : "language"))}
              onClose={() => setOpenKnob(null)}
              onChange={(next) => {
                const selection = applyVideoLanguageSelection(next, input.voiceProvider);
                onInput({ ...input, videoLanguage: selection.videoLanguage, voiceProvider: selection.voiceProvider });
              }}
              options={languageOptionsForProvider(input.voiceProvider)}
            />
            <KnobButton
              icon={Icon.spark({ size: 14 })}
              title="Giọng đọc"
              value={input.voiceProvider}
              open={openKnob === "voice"}
              onToggle={() => setOpenKnob((k) => (k === "voice" ? null : "voice"))}
              onClose={() => setOpenKnob(null)}
              onChange={(next) => {
                const selection = applyVoiceProviderSelection(next, input.videoLanguage);
                onInput({ ...input, videoLanguage: selection.videoLanguage, voiceProvider: selection.voiceProvider });
              }}
              options={[
                { value: "vivibe", label: "Vivibe" },
                { value: "elevenlabs", label: "ElevenLabs" },
                { value: "vieneu", label: "VieNeu Local" },
              ]}
            />
          </div>
        </div>

        {/* Structured Script Review */}
        <div className="ns-agent-brief-copy">
          <div className="ns-agent-brief-copy-head">
            <span className="ns-agent-brief-label">Nội dung kịch bản:</span>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <button
                type="button"
                className={`ns-agent-prompt-edit-toggle${copiedPrompt ? " is-copied" : ""}`}
                onClick={copyPrompt}
                title="Sao chép kịch bản brief"
                aria-label={copiedPrompt ? "Đã sao chép kịch bản" : "Sao chép kịch bản"}
              >
                {copiedPrompt ? Icon.check({ size: 14 }) : Icon.copy({ size: 14 })}
                <span>{copiedPrompt ? "Đã sao chép" : "Sao chép brief"}</span>
              </button>
              <button
                type="button"
                className="ns-agent-prompt-edit-toggle"
                onClick={() => setEditPromptOpen((prev) => !prev)}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    width: 14,
                    height: 14,
                    transformOrigin: "center center",
                    transform: editPromptOpen ? "rotate(90deg)" : "rotate(0deg)",
                    transition: "transform 0.15s cubic-bezier(0.16, 1, 0.3, 1)",
                  }}
                >
                  {Icon.chevronRight({ size: 14 })}
                </span>
                <span>{editPromptOpen ? "Ẩn trình sửa văn bản" : "Chỉnh sửa văn bản thô"}</span>
              </button>
            </div>
          </div>

          {editPromptOpen && (
            <div className="ns-agent-brief-prompt-edit-wrap">
              <textarea
                className="ns-input ns-agent-brief-prompt"
                value={input.prompt}
                maxLength={20_000}
                placeholder="Nhập hoặc chỉnh sửa cấu trúc kịch bản..."
                onChange={(event) => onInput({ ...input, prompt: event.target.value })}
              />
            </div>
          )}

          <BriefMarkdown text={input.prompt} />
        </div>

        <div className="ns-agent-brief-field">
          <label className="ns-agent-brief-label" htmlFor="agent-brief-feedback">Yêu cầu Agent chỉnh brief</label>
          <textarea
            id="agent-brief-feedback"
            className="ns-input ns-agent-brief-feedback"
            value={feedback}
            maxLength={2000}
            placeholder="Ví dụ: Mở đầu rõ vấn đề người mới gặp, thêm ví dụ thực tế, giảm phần kỹ thuật…"
            onChange={(event) => setFeedback(event.target.value)}
            disabled={busy}
          />
          <button
            type="button"
            className="ns-btn ns-btn-secondary"
            disabled={busy || !feedback.trim()}
            onClick={() => {
              const next = feedback.trim();
              if (!next) return;
              setFeedback("");
              onRequestChanges(next);
            }}
          >
            Yêu cầu chỉnh brief
          </button>
        </div>

        {/* Approved Assets */}
        {draft.assetReview && draft.assetReview.length > 0 && (
          <div className="ns-agent-brief-assets-section">
            <span className="ns-agent-brief-label">Ảnh đã chọn cho video:</span>
            <div className="ns-agent-brief-assets">
              {(draft.assetReview ?? [])
                .filter((asset) => draft.briefReview?.selectedAssetIds.includes(asset.id))
                .map((asset) => (
                  <div key={asset.id} className="ns-agent-brief-asset-card">
                    <img src={asset.previewUrl} alt={asset.label} title={asset.label} loading="lazy" decoding="async" />
                    <span className="ns-agent-brief-asset-label">{asset.label}</span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Action Footer */}
        <div className="ns-agent-brief-actions">
          <button type="button" className="ns-btn" onClick={onReturn} disabled={busy}>
            {Icon.chevronLeft({ size: 15 })} Quay lại asset
          </button>
          <button
            type="button"
            className="ns-btn ns-btn-primary"
            onClick={onApprove}
            disabled={busy || input.prompt.trim().length < 20 || !input.title.trim()}
          >
            <StableButtonLabel reserve={["Đang xử lý…", "Chấp nhận brief & Tạo video"]}>
              {busy ? "Đang xử lý…" : "Chấp nhận brief & Tạo video"}
            </StableButtonLabel>
          </button>
        </div>
      </div>
    </section>
  );
};

const BriefMarkdown: React.FC<{ text: string }> = ({ text }) => {
  const lines = text.split(/\r?\n/);
  return (
    <article className="ns-agent-brief-markdown">
      {lines.map((line, index) => {
        const value = line.trim();
        if (!value) return null;
        if (value.startsWith("### ")) {
          return (
            <h4 key={index} className="ns-brief-h4">
              {value.slice(4)}
            </h4>
          );
        }
        if (value.startsWith("## ")) {
          return (
            <div key={index} className="ns-brief-scene-heading">
              <h3>{value.slice(3)}</h3>
            </div>
          );
        }
        if (value.startsWith("# ")) {
          return (
            <h2 key={index} className="ns-brief-h2">
              {value.slice(2)}
            </h2>
          );
        }
        if (/^[-*]\s+/.test(value)) {
          return (
            <div key={index} className="ns-brief-bullet">
              <span className="ns-brief-bullet-dot" aria-hidden="true" />
              <span>{value.replace(/^[-*]\s+/, "")}</span>
            </div>
          );
        }
        return (
          <p key={index} className="ns-brief-p">
            {value}
          </p>
        );
      })}
    </article>
  );
};

export const AgentSettingsDialog: React.FC<{
  open: boolean;
  busy: boolean;
  settings: AgentSettingsVM | null;
  error: string | null;
  searchApiKey: string;
  onSearchApiKeyChange: (value: string) => void;
  onClose: () => void;
  onSearchProvider: (provider: AgentSearchProvider) => void;
  onSaveSearchKey: () => void;
  onModel: (modelId: string) => void;
  onAccess: (presetId: string, requiresConfirmation: boolean) => void;
}> = ({
  open,
  busy,
  settings,
  error,
  searchApiKey,
  onSearchApiKeyChange,
  onClose,
  onSearchProvider,
  onSaveSearchKey,
  onModel,
  onAccess,
}) => {
  const [showKey, setShowKey] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(open, dialogRef, onClose);

  if (!open) return null;
  return (
    <div className="ns-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="ns-modal ns-agent-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="ns-modal-head">
          <div>
            <h2 id="agent-settings-title" className="ns-modal-title">
              Cài đặt Agent
            </h2>
            <p>Cấu hình công cụ tìm kiếm, model và quyền hạn cho workspace này.</p>
          </div>
          <button
            type="button"
            className="ns-btn ns-btn-icon-only"
            aria-label="Đóng cài đặt"
            onClick={onClose}
          >
            {Icon.close({ size: 18 })}
          </button>
        </div>

        {error && (
          <p className="ns-agent-notice is-danger" role="alert">
            {error}
          </p>
        )}

        {!settings ? (
          <div style={{ padding: 24 }}>
            <LoadingLine label="Đang tải cài đặt..." />
          </div>
        ) : (
          <div className="ns-agent-settings-body">
            {/* Search Provider Section */}
            <div className="ns-agent-settings-card">
              <div className="ns-agent-settings-card-head">
                <span className="ns-agent-settings-card-title">Tìm kiếm tài liệu & hình ảnh</span>
                <span className="ns-agent-settings-card-desc">Công cụ để Agent tự động research nội dung trên web.</span>
              </div>
              <div className="ns-agent-settings-fields">
                <div className="ns-agent-settings-field">
                  <label htmlFor="agent-search-provider" className="ns-agent-settings-label">
                    Dịch vụ tìm kiếm
                  </label>
                  <CustomSelect
                    id="agent-search-provider"
                    value={settings.searchProvider}
                    disabled={busy}
                    onChange={(val) => onSearchProvider(val as AgentSearchProvider)}
                    options={[
                      { value: "deepseek", label: "DeepSeek Search" },
                      { value: "exa", label: "Exa hosted" },
                    ]}
                  />
                </div>

                {settings.searchProvider === "deepseek" && (
                  <div className="ns-agent-settings-field">
                    <label htmlFor="agent-search-key" className="ns-agent-settings-label">
                      DeepSeek API Key
                    </label>
                    <div className="ns-secret-field">
                      <input
                        id="agent-search-key"
                        className="ns-input"
                        type={showKey ? "text" : "password"}
                        value={searchApiKey}
                        autoComplete="off"
                        placeholder={settings.webSearchConfigured ? "Đã cấu hình — nhập key mới để thay thế" : "Nhập DeepSeek API Key..."}
                        onChange={(event) => onSearchApiKeyChange(event.target.value)}
                      />
                      <button
                        type="button"
                        className="ns-secret-toggle"
                        onClick={() => setShowKey((v) => !v)}
                      >
                        <StableButtonLabel reserve={["Ẩn", "Hiện"]}>
                          {showKey ? "Ẩn" : "Hiện"}
                        </StableButtonLabel>
                      </button>
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <button
                        type="button"
                        className="ns-btn ns-btn-primary"
                        disabled={busy || !searchApiKey.trim()}
                        onClick={onSaveSearchKey}
                      >
                        Lưu API key
                      </button>
                    </div>
                  </div>
                )}
                <small className="ns-agent-settings-hint">
                  Đổi dịch vụ tìm kiếm sẽ có hiệu lực khi khởi động lại Agent.
                </small>
              </div>
            </div>

            {/* Model Selection */}
            <div className="ns-agent-settings-card">
              <div className="ns-agent-settings-card-head">
                <span className="ns-agent-settings-card-title">Mô hình AI (Model)</span>
                <span className="ns-agent-settings-card-desc">Lựa chọn model phụ trách nghiên cứu và lên kịch bản.</span>
              </div>
              <div className="ns-agent-settings-fields">
                {settings.modelOptions.length === 0 ? (
                  <small className="ns-agent-settings-hint">Runtime không cung cấp danh mục model.</small>
                ) : (
                  <div className="ns-agent-settings-field">
                    <label htmlFor="agent-model-select" className="ns-agent-settings-label">
                      Model hiện tại
                    </label>
                    <CustomSelect
                      id="agent-model-select"
                      value={settings.currentModelId ?? ""}
                      disabled={busy}
                      onChange={(val) => onModel(val)}
                      options={settings.modelOptions.map((opt) => ({
                        value: opt.id,
                        label: opt.label,
                      }))}
                    />
                  </div>
          )}
        </div>

            </div>

            {/* Access Permissions */}
            <div className="ns-agent-settings-card">
              <div className="ns-agent-settings-card-head">
                <span className="ns-agent-settings-card-title">Quyền hạn phiên làm việc</span>
                <span className="ns-agent-settings-card-desc">Kiểm soát mức độ truy cập tệp và terminal của Agent.</span>
              </div>
              <div className="ns-agent-settings-fields">
                {settings.accessOptions.length === 0 ? (
                  <small className="ns-agent-settings-hint">Runtime không cung cấp preset quyền.</small>
                ) : (
                  <div className="ns-agent-access-options">
                    {settings.accessOptions.map((option) => {
                      const isSelected = settings.currentAccessId === option.id;
                      return (
                        <label
                          key={option.id}
                          className={`ns-agent-access-card${isSelected ? " is-selected" : ""}`}
                        >
                          <input
                            type="radio"
                            name="agent-access"
                            checked={isSelected}
                            disabled={busy}
                            onChange={() => onAccess(option.id, option.requiresConfirmation)}
                          />
                          <div className="ns-agent-access-copy">
                            <strong>{option.label}</strong>
                            {option.description && <small>{option.description}</small>}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function motionrealHarnessUrl(value: string): string {
  try {
    const url = new URL(value);
    url.searchParams.set("embedded", "motionreal");
    return url.href;
  } catch (_error) {
    return value;
  }
}
