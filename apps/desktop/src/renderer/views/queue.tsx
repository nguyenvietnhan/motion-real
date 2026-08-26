import React, { useEffect, useRef, useState } from "react";
import type {
  BgmTrackVM,
  DroppedImage,
  DurationTierChoice,
  PickImagesResult,
  StagedImage,
  StagedImageRef,
  VideoLanguageChoice,
  VoiceProviderChoice,
} from "../../shared/types.js";
import type {
  QueueJobUpdateInput,
  QueueJobVM,
  QueueProjectVM,
  QueueRunnerStatus,
  QueueStartResult,
} from "../../shared/queue-types.js";
import { validateCreateInput } from "../../shared/create-validation.js";
import { Icon } from "../icons.js";
import { EmptyState, LoadingLine, PageHeader, StableButtonLabel, STATUS_COLOR } from "../primitives.js";
import { compactNotificationMessage, errorDetails, useNotifications } from "../notifications.js";
import { useDismissable } from "../use-dismissable.js";
import { useMenuNavigation } from "../use-menu-navigation.js";
import { useModalFocus } from "../use-modal-focus.js";
import { BgmPicker } from "./bgm-picker.js";
import {
  applyVideoLanguageSelection,
  applyVoiceProviderSelection,
  filesToDroppedImages,
  KnobButton,
  languageOptionsForProvider,
  rejectedImageDetails,
  StagedImageStrip,
} from "./home.js";

/** Map queue job status → gallery status colors (status dot only). */
function jobStatusColor(status: QueueJobVM["status"]): string {
  if (status === "done") return STATUS_COLOR.done;
  if (status === "failed") return STATUS_COLOR.error;
  if (status === "running") return STATUS_COLOR.building;
  if (status === "cancelled") return "var(--muted-foreground)";
  return "color-mix(in srgb, var(--text) 28%, transparent)"; // queued
}

function jobStatusLabel(status: QueueJobVM["status"]): string {
  if (status === "done") return "Xong";
  if (status === "failed") return "Lỗi";
  if (status === "running") return "Đang dựng…";
  if (status === "cancelled") return "Đã dừng";
  return "Chờ";
}

function jobDisplayName(job: QueueJobVM): string {
  if (job.displayTitle?.trim()) return job.displayTitle.trim();
  if (job.smoke) return "Smoke test";
  const t = job.raw.trim().replace(/\s+/g, " ");
  return t.length > 48 ? `${t.slice(0, 47)}…` : t || "Untitled";
}

/** Progress k/N while a queue run is active. */
export function queueProgress(jobs: readonly QueueJobVM[]): { k: number; n: number } {
  const n = jobs.length;
  const finished = jobs.filter((j) => j.status === "done" || j.status === "failed" || j.status === "cancelled").length;
  const running = jobs.some((j) => j.status === "running") ? 1 : 0;
  return { k: Math.min(n, finished + running), n };
}

export const EMPTY_QUEUE_STATUS: QueueRunnerStatus = {
  busy: false,
  activeQueueId: null,
  pendingQueueIds: [],
};

/** List-card meta: running / waiting in process schedule / idle counts. */
export function queueContainerMeta(
  q: QueueProjectVM,
  status: QueueRunnerStatus,
  queues: readonly QueueProjectVM[],
): string {
  if (status.activeQueueId === q.id) return "Đang chạy";
  const pendingIdx = status.pendingQueueIds.indexOf(q.id);
  if (pendingIdx >= 0) {
    const aheadId = pendingIdx === 0 ? status.activeQueueId : status.pendingQueueIds[pendingIdx - 1]!;
    const aheadTitle = queues.find((x) => x.id === aheadId)?.title?.trim();
    if (aheadTitle) return `Chờ · sau ${aheadTitle}`;
    return `Chờ (thứ ${pendingIdx + 1})`;
  }
  return `${q.jobs.length} video · ${new Date(q.createdAt).toLocaleString("vi-VN")}`;
}

type JobInput = {
  raw: string;
  durationTier: DurationTierChoice;
  videoLanguage: VideoLanguageChoice;
  voiceProvider: VoiceProviderChoice;
  bgm: string | null;
  smoke?: boolean;
  images?: StagedImageRef[];
};

export const QueueView: React.FC<{
  queues: QueueProjectVM[];
  active: QueueProjectVM | null;
  load: "loading" | "ready" | "error";
  defaultVoiceProvider: VoiceProviderChoice;
  smokeRenderEnabled?: boolean;
  bgm?: BgmTrackVM[];
  bgmSelected?: string | null;
  onBgmAdd?: () => void;
  onBgmRemove?: (name: string) => Promise<void>;
  onBgmSelect?: (name: string | null) => void;
  onPickImages?: () => Promise<PickImagesResult>;
  onImportImageBytes?: (files: DroppedImage[]) => Promise<PickImagesResult>;
  onUnstageImage?: (ref: string) => void;
  onRefresh: () => void;
  onCreateQueue: () => Promise<void>;
  onOpenQueue: (id: string) => void;
  onDeleteQueue: (id: string) => void | Promise<void>;
  onRenameQueue: (id: string, title: string) => Promise<void>;
  onBackToList: () => void;
  onAddJob: (input: JobInput) => Promise<void>;
  onUpdateJob: (jobId: string, patch: QueueJobUpdateInput) => Promise<void>;
  onDeleteJob: (jobId: string) => Promise<void>;
  onCancelJob: (jobId: string) => Promise<void>;
  onStartQueue: () => Promise<QueueStartResult>;
  onEnableFullAutoAndStart: () => Promise<QueueStartResult>;
  onPauseQueue: () => Promise<{ ok: true } | { ok: false; error: string }>;
  onResumeQueue: () => Promise<QueueStartResult>;
  onOpenVoiceSettings: () => void;
  queueStatus?: QueueRunnerStatus;
}> = (props) => {
  if (props.active) {
    return <QueueDetail {...props} queue={props.active} />;
  }

  const {
    load,
    queues,
    onCreateQueue,
    onOpenQueue,
    onDeleteQueue,
    onRefresh,
    queueStatus = EMPTY_QUEUE_STATUS,
  } = props;

  return (
    <div className="ns-content">
      <PageHeader
        title="Hàng đợi"
        action={
          <button type="button" className="ns-btn ns-btn-primary" onClick={() => void onCreateQueue()}>
            Tạo hàng đợi
          </button>
        }
      />
      {load === "loading" && <LoadingLine />}
      {load === "error" && (
        <EmptyState
          icon={Icon.list({ size: 28 })}
          title="Không tải được"
          hint="Thử lại sau."
          action={
            <button type="button" className="ns-btn" onClick={onRefresh}>
              Thử lại
            </button>
          }
        />
      )}
      {load === "ready" && queues.length === 0 && (
        <EmptyState icon={Icon.list({ size: 28 })} title="Chưa có hàng đợi" hint="Tạo hàng đợi để gom prompt." />
      )}
      {load === "ready" && queues.length > 0 && (
        <ul className="ns-queue-list" aria-label="Danh sách hàng đợi">
          {queues.map((q) => {
            const isActive = queueStatus.activeQueueId === q.id;
            const isPending = queueStatus.pendingQueueIds.includes(q.id);
            const isHomeEphemeral = q.ephemeralKind === "home" || q.id === "queue-home";
            return (
              <li key={q.id} className="ns-queue-row">
                <button type="button" className="ns-queue-card" onClick={() => onOpenQueue(q.id)}>
                  <span className="ns-queue-card-title-row">
                    <span className="ns-queue-card-title">{q.title}</span>
                    {isHomeEphemeral ? <span className="ns-queue-badge is-home">Tạm · Home</span> : null}
                    {isActive ? <span className="ns-queue-badge is-running">Đang chạy</span> : null}
                    {isPending ? <span className="ns-queue-badge is-pending">Chờ</span> : null}
                  </span>
                  <span className="ns-queue-card-meta">{queueContainerMeta(q, queueStatus, queues)}</span>
                </button>
                <button
                  type="button"
                  className="ns-queue-delete"
                  title="Xóa"
                  aria-label={`Xóa ${q.title}`}
                  disabled={isActive}
                  onClick={(e) => {
                    e.stopPropagation();
                    void onDeleteQueue(q.id);
                  }}
                >
                  {Icon.trash({ size: 16 })}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

const QueueDetail: React.FC<{
  queue: QueueProjectVM;
  defaultVoiceProvider: VoiceProviderChoice;
  smokeRenderEnabled?: boolean;
  bgm?: BgmTrackVM[];
  bgmSelected?: string | null;
  onBgmAdd?: () => void;
  onBgmRemove?: (name: string) => Promise<void>;
  onBgmSelect?: (name: string | null) => void;
  onPickImages?: () => Promise<PickImagesResult>;
  onImportImageBytes?: (files: DroppedImage[]) => Promise<PickImagesResult>;
  onUnstageImage?: (ref: string) => void;
  onBackToList: () => void;
  onDeleteQueue: (id: string) => void | Promise<void>;
  onRenameQueue: (id: string, title: string) => Promise<void>;
  onAddJob: (input: JobInput) => Promise<void>;
  onUpdateJob: (jobId: string, patch: QueueJobUpdateInput) => Promise<void>;
  onDeleteJob: (jobId: string) => Promise<void>;
  onCancelJob: (jobId: string) => Promise<void>;
  onStartQueue: () => Promise<QueueStartResult>;
  onEnableFullAutoAndStart: () => Promise<QueueStartResult>;
  onPauseQueue: () => Promise<{ ok: true } | { ok: false; error: string }>;
  onResumeQueue: () => Promise<QueueStartResult>;
  onOpenVoiceSettings: () => void;
  queueStatus?: QueueRunnerStatus;
  queues?: QueueProjectVM[];
}> = ({
  queue,
  defaultVoiceProvider,
  smokeRenderEnabled = false,
  bgm = [],
  bgmSelected = null,
  onBgmAdd,
  onBgmRemove,
  onBgmSelect,
  onPickImages,
  onImportImageBytes,
  onUnstageImage,
  onBackToList,
  onDeleteQueue,
  onRenameQueue,
  onAddJob,
  onUpdateJob,
  onDeleteJob,
  onCancelJob,
  onStartQueue,
  onEnableFullAutoAndStart,
  onPauseQueue,
  onResumeQueue,
  onOpenVoiceSettings,
  queueStatus = EMPTY_QUEUE_STATUS,
  queues = [],
}) => {
  const notify = useNotifications();
  const [raw, setRaw] = useState("");
  const [images, setImages] = useState<StagedImage[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [adding, setAdding] = useState(false);
  const [durationTier, setDurationTier] = useState<DurationTierChoice>(1);
  const [videoLanguage, setVideoLanguage] = useState<VideoLanguageChoice>("vi");
  const [voiceProvider, setVoiceProvider] = useState<VoiceProviderChoice>(defaultVoiceProvider);
  const [openKnob, setOpenKnob] = useState<"duration" | "language" | "voice" | null>(null);
  const [menuJobId, setMenuJobId] = useState<string | null>(null);
  const [editJob, setEditJob] = useState<QueueJobVM | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState(queue.title);
  const [fullAutoRequired, setFullAutoRequired] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const menuSurfaceRef = useRef<HTMLDivElement>(null);
  const dragDepth = useRef(0);

  useEffect(() => {
    setRenameDraft(queue.title);
  }, [queue.title]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [raw]);

  useDismissable(Boolean(menuJobId), () => setMenuJobId(null), menuRef);
  const jobMenu = useMenuNavigation(Boolean(menuJobId), () => setMenuJobId(null), menuTriggerRef, menuSurfaceRef);

  const valid = validateCreateInput({ raw });
  const inputValid = valid.ok;
  const mergeImages = (result: PickImagesResult): void => {
    setImages((current) => {
      const refs = new Set(current.map((image) => image.ref));
      return [...current, ...result.staged.filter((image) => !refs.has(image.ref))];
    });
    if (result.rejected.length > 0) {
      notify.warning({
        title: "Một số ảnh bị bỏ qua",
        message: `${result.rejected.length} ảnh không hợp lệ.`,
        details: rejectedImageDetails(result.rejected),
      });
    }
  };
  const pickImages = (): void => {
    if (!onPickImages) return;
    void onPickImages().then(mergeImages).catch((error: unknown) => {
      const details = errorDetails(error);
      notify.error({ title: "Không nạp được ảnh", message: compactNotificationMessage(details, "Thử lại."), details });
    });
  };
  const importFiles = (files: File[]): void => {
    if (!onImportImageBytes || files.length === 0) return;
    void filesToDroppedImages(files)
      .then(onImportImageBytes)
      .then(mergeImages)
      .catch((error: unknown) => {
        const details = errorDetails(error);
        notify.error({ title: "Không nạp được ảnh", message: compactNotificationMessage(details, "Thử lại."), details });
      });
  };
  const removeImage = (ref: string): void => {
    setImages((current) => current.filter((image) => image.ref !== ref));
    onUnstageImage?.(ref);
  };
  /** Start can run fresh queued jobs or retry failed/cancelled after a fix. */
  const startableCount = queue.jobs.filter(
    (j) => j.status === "queued" || j.status === "failed" || j.status === "cancelled",
  ).length;
  const progress = queueProgress(queue.jobs);
  const isThisActive = queueStatus.activeQueueId === queue.id;
  const isThisPending = queueStatus.pendingQueueIds.includes(queue.id);
  const isThisPaused = Boolean(queueStatus.paused && isThisPending);
  const pendingHint =
    isThisPending && queues.length > 0
      ? queueContainerMeta(queue, queueStatus, queues)
      : isThisPending
        ? "Đã xếp chờ"
        : null;

  const addJob = (smoke: boolean): void => {
    if (adding) return;
    if (!smoke && !inputValid) return;
    setAdding(true);
    void onAddJob({
      raw: smoke ? raw.trim() || "Smoke test — video ngắn 10 giây, không tiếng." : raw.trim(),
      durationTier: smoke ? 1 : durationTier,
      videoLanguage,
      voiceProvider,
      bgm: smoke ? null : bgmSelected,
      ...(!smoke && images.length > 0 ? { images: images.map(({ ref, width, height }) => ({ ref, width, height })) } : {}),
      ...(smoke ? { smoke: true } : {}),
    })
      .then(() => {
        setRaw("");
        setImages([]);
      })
      .catch((error: unknown) => {
        const details = errorDetails(error);
        notify.error({
          title: "Không thêm được",
          message: compactNotificationMessage(details, "Thử lại."),
          details,
        });
      })
      .finally(() => setAdding(false));
  };

  const commitRename = (): void => {
    const next = renameDraft.trim();
    setRenaming(false);
    if (!next || next === queue.title) {
      setRenameDraft(queue.title);
      return;
    }
    void onRenameQueue(queue.id, next).catch((error: unknown) => {
      setRenameDraft(queue.title);
      const details = errorDetails(error);
      notify.error({
        title: "Không đổi tên được",
        message: compactNotificationMessage(details, "Thử lại."),
        details,
      });
    });
  };

  return (
    <div className="ns-content">
      <PageHeader
        title={
          <span className="ns-queue-title-row" role="heading" aria-level={1}>
            {renaming ? (
              <input
                className="ns-queue-title-input"
                value={renameDraft}
                autoFocus
                aria-label="Tên hàng đợi"
                onChange={(e) => setRenameDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") {
                    setRenameDraft(queue.title);
                    setRenaming(false);
                  }
                }}
              />
            ) : (
              <span className="ns-page-title ns-queue-title-text">{queue.title}</span>
            )}
            {queue.ephemeralKind === "home" || queue.id === "queue-home" ? null : (
            <button
              type="button"
              className="ns-project-action"
              title="Đổi tên"
              aria-label="Đổi tên hàng đợi"
              disabled={renaming}
              tabIndex={renaming ? -1 : 0}
              aria-hidden={renaming}
              style={renaming ? { visibility: "hidden" } : undefined}
              onClick={() => {
                setRenameDraft(queue.title);
                setRenaming(true);
              }}
            >
              {Icon.pencil({ size: 15 })}
            </button>
            )}
          </span>
        }
        action={
          <div className="ns-queue-header-actions">
            <button type="button" className="ns-btn" onClick={onBackToList} title="Danh sách">
              {Icon.chevronLeft({ size: 16 })}
            </button>
            <button
              type="button"
              className="ns-btn"
              disabled={isThisActive}
              title={isThisActive ? "Không xóa được khi đang chạy" : "Xóa hàng đợi"}
              aria-label="Xóa hàng đợi"
              onClick={() => void onDeleteQueue(queue.id)}
            >
              {Icon.trash({ size: 14 })}
            </button>
            <button
              type="button"
              className="ns-btn ns-btn-primary"
              disabled={!isThisActive && !isThisPaused && (isThisPending || startableCount === 0)}
              title={
                isThisActive
                  ? "Tạm dừng toàn bộ hàng đợi"
                  : isThisPaused
                    ? "Tiếp tục lịch hàng đợi đã lưu"
                    : isThisPending
                    ? "Đã xếp sau hàng đợi đang chạy"
                    : "Bắt đầu chạy"
              }
              onClick={() => {
                if (isThisActive) {
                  void onPauseQueue().then((result) => {
                    if (!result.ok) throw new Error(result.error);
                  }).catch((error: unknown) => {
                    const details = errorDetails(error);
                    notify.error({ title: "Không tạm dừng được", message: compactNotificationMessage(details, "Thử lại."), details });
                  });
                  return;
                }
                void (isThisPaused ? onResumeQueue() : onStartQueue()).then((res) => {
                  if (!res.ok) {
                    if (res.code === "FULL_AUTO_REQUIRED") {
                      setFullAutoRequired(true);
                      return;
                    }
                    notify.error({
                      title: "Chưa chạy được",
                      message: compactNotificationMessage(res.error, "Thử lại."),
                      details: res.error,
                    });
                    return;
                  }
                  setFullAutoRequired(false);
                  if (res.mode === "scheduled") {
                    notify.info({
                      title: "Đã xếp vào hàng chờ",
                      message: "Sẽ bắt đầu khi xong lô đang chạy (và các lô chờ trước).",
                    });
                  } else if (res.mode === "already_scheduled") {
                    notify.info({
                      title: "Đã nằm trong hàng chờ",
                      message: "Lô này sẽ chạy sau khi các lô trước xong.",
                    });
                  } else if (res.mode === "already_running") {
                    notify.info({
                      title: "Đang chạy",
                      message: "Lô này đang được dựng.",
                    });
                  }
                }).catch((error: unknown) => {
                  const details = errorDetails(error);
                  notify.error({ title: "Chưa chạy được", message: compactNotificationMessage(details, "Thử lại."), details });
                });
              }}
            >
              <StableButtonLabel reserve={["Tạm dừng toàn bộ", "Tiếp tục", "Đã xếp chờ", "Bắt đầu"]}>
                {isThisActive ? "Tạm dừng toàn bộ" : isThisPaused ? "Tiếp tục" : isThisPending ? "Đã xếp chờ" : "Bắt đầu"}
              </StableButtonLabel>
            </button>
          </div>
        }
      />

      {fullAutoRequired || (isThisPaused && queueStatus.paused?.kind === "full_auto_required") ? (
        <div className="ns-queue-full-auto" role="alert">
          <span>Hàng đợi cần tắt các bước duyệt tay để có thể chạy unattended.</span>
          <button
            type="button"
            className="ns-btn ns-btn-primary"
            onClick={() => {
              void onEnableFullAutoAndStart()
                .then((result) => {
                  if (!result.ok) throw new Error(result.error);
                  setFullAutoRequired(false);
                })
                .catch((error: unknown) => {
                  const details = errorDetails(error);
                  notify.error({ title: "Không bật được Full auto", message: compactNotificationMessage(details, "Thử lại."), details });
                });
            }}
          >
            Bật Full auto và bắt đầu
          </button>
        </div>
      ) : null}

      {isThisPaused && queueStatus.paused?.kind !== "full_auto_required" ? (
        <div className="ns-queue-full-auto" role="alert">
          <span>{queueStatus.paused?.message ?? "Hàng đợi đang tạm dừng."}</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {queueStatus.paused?.kind === "voice_provider" ? (
              <button type="button" className="ns-btn" onClick={onOpenVoiceSettings}>Mở cài đặt giọng</button>
            ) : null}
            <button
              type="button"
              className="ns-btn ns-btn-primary"
              onClick={() => {
                void onResumeQueue().then((result) => {
                  if (!result.ok) throw new Error(result.error);
                }).catch((error: unknown) => {
                  const details = errorDetails(error);
                  notify.error({ title: "Chưa tiếp tục được", message: compactNotificationMessage(details, "Kiểm tra cài đặt rồi thử lại."), details });
                });
              }}
            >
              Tiếp tục toàn bộ
            </button>
          </div>
        </div>
      ) : null}

      <div
        className={`ns-card ns-create-card${dragOver ? " is-dragging" : ""}`}
        onDragEnter={(event) => {
          if (!onImportImageBytes) return;
          event.preventDefault();
          dragDepth.current += 1;
          setDragOver(true);
        }}
        onDragOver={(event) => { if (onImportImageBytes) event.preventDefault(); }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragOver(false);
        }}
        onDrop={(event) => {
          dragDepth.current = 0;
          setDragOver(false);
          const files = Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith("image/"));
          if (files.length > 0) {
            event.preventDefault();
            importFiles(files);
          }
        }}
      >
        <div className="ns-create-flow">
          <div className="ns-composer">
            <textarea
              ref={textareaRef}
              aria-label="Prompt video"
              className="ns-composer-input"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              onPaste={(event) => {
                const items = Array.from(event.clipboardData.items)
                  .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
                  .map((item) => item.getAsFile())
                  .filter((file): file is File => file !== null);
                if (items.length > 0) {
                  event.preventDefault();
                  importFiles(items);
                }
              }}
              placeholder="Prompt hoặc link…"
              rows={2}
            />
            <StagedImageStrip images={images} onRemove={removeImage} />
            <div className="ns-composer-bar">
              <div className="ns-composer-bar-leading">
                {onPickImages ? (
                  <button type="button" className="ns-btn-attach" onClick={pickImages} title="Thêm ảnh" aria-label="Thêm ảnh">
                    {Icon.plus({ size: 16 })}<span className="ns-btn-attach-label">Ảnh</span>
                  </button>
                ) : null}
                {!inputValid && raw.trim() !== "" ? (
                  <span className="ns-validation-warning">Nội dung chưa hợp lệ.</span>
                ) : null}
              </div>
              <div className="ns-composer-bar-actions">
                {smokeRenderEnabled && (
                  <button
                    type="button"
                    className="ns-create-smoke"
                    disabled={adding}
                    title="Thêm smoke vào list"
                    aria-label="Thêm smoke vào list"
                    onClick={() => addJob(true)}
                  >
                    {Icon.play({ size: 16 })}
                  </button>
                )}
                <button
                  type="button"
                  className="ns-create-send"
                  onClick={() => addJob(false)}
                  disabled={!inputValid || adding}
                  title="Thêm vào list"
                  aria-label="Thêm vào list"
                >
                  {adding ? <span className="ns-create-send-spin" aria-hidden /> : Icon.plus({ size: 18 })}
                </button>
              </div>
            </div>
          </div>

          <div className="ns-create-knobs" role="group" aria-label="Cấu hình">
            <KnobButton
              icon={Icon.clock({ size: 14 })}
              title="Thời lượng"
              value={durationTier}
              open={openKnob === "duration"}
              onToggle={() => setOpenKnob((k) => (k === "duration" ? null : "duration"))}
              onClose={() => setOpenKnob(null)}
              onChange={setDurationTier}
              options={[
                { value: 1, label: "0:45" },
                { value: 2, label: "1:30" },
                { value: 3, label: "2:30" },
                { value: 4, label: "3:30" },
              ]}
            />
            <KnobButton
              icon={Icon.globe({ size: 14 })}
              title="Ngôn ngữ"
              value={videoLanguage}
              open={openKnob === "language"}
              onToggle={() => setOpenKnob((k) => (k === "language" ? null : "language"))}
              onClose={() => setOpenKnob(null)}
              onChange={(next) => {
                const selection = applyVideoLanguageSelection(next, voiceProvider);
                setVideoLanguage(selection.videoLanguage);
                setVoiceProvider(selection.voiceProvider);
              }}
              options={languageOptionsForProvider(voiceProvider)}
            />
            <KnobButton
              icon={Icon.spark({ size: 14 })}
              title="Giọng đọc"
              value={voiceProvider}
              open={openKnob === "voice"}
              onToggle={() => setOpenKnob((k) => (k === "voice" ? null : "voice"))}
              onClose={() => setOpenKnob(null)}
              onChange={(next) => {
                const selection = applyVoiceProviderSelection(next, videoLanguage);
                setVideoLanguage(selection.videoLanguage);
                setVoiceProvider(selection.voiceProvider);
              }}
              options={[
                { value: "vivibe", label: "Vivibe" },
                { value: "elevenlabs", label: "ElevenLabs" },
              ]}
            />
            {onBgmSelect && onBgmAdd && onBgmRemove ? (
              <BgmPicker
                className="ns-create-bgm"
                bgm={bgm}
                selected={bgmSelected}
                busy={adding}
                onAdd={onBgmAdd}
                onRemove={onBgmRemove}
                onSelect={onBgmSelect}
              />
            ) : null}
          </div>
        </div>
      </div>

      <div className="ns-card ns-queue-jobs-card">
        <div className="ns-queue-jobs-head">
          <h3>Trong hàng đợi</h3>
          {isThisActive && progress.n > 0 ? (
            <span className="ns-queue-progress" aria-live="polite">
              Đang chạy {progress.k}/{progress.n}
            </span>
          ) : pendingHint ? (
            <span className="ns-queue-progress-muted" aria-live="polite">
              {pendingHint}
            </span>
          ) : queue.jobs.length > 0 ? (
            <span className="ns-queue-progress-muted">{queue.jobs.length} video</span>
          ) : null}
        </div>
        {queue.jobs.length === 0 ? (
          <p className="ns-queue-jobs-empty">Chưa có prompt. Bấm + để thêm.</p>
        ) : (
          <ol className="ns-queue-jobs">
            {queue.jobs.map((job, i) => {
              const menuOpen = menuJobId === job.id;
              return (
                <li key={job.id} className={`ns-queue-job${menuOpen ? " is-menu-open" : ""}`}>
                  <span className="ns-queue-job-idx" aria-hidden>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span
                    className="ns-queue-job-dot"
                    style={{ background: jobStatusColor(job.status) }}
                    title={jobStatusLabel(job.status)}
                    aria-label={jobStatusLabel(job.status)}
                  />
                  <span className="ns-queue-job-body">
                    <span className="ns-queue-job-title">{jobDisplayName(job)}</span>
                    <span className="ns-queue-job-meta">
                      {jobStatusLabel(job.status)}
                      {job.smoke ? " · smoke" : ""}
                      {job.images?.length ? ` · ${job.images.length} ảnh` : ""}
                      {" · "}
                      {job.videoLanguage === "en" ? "EN" : "VI"}
                      {!job.smoke ? ` · tier ${job.durationTier}` : ""}
                      {job.error ? ` · ${job.error}` : ""}
                    </span>
                  </span>
                  <div className="ns-queue-job-more" ref={menuOpen ? menuRef : undefined}>
                    <button
                      ref={menuOpen ? menuTriggerRef : undefined}
                      type="button"
                      className={`ns-queue-job-more-btn${menuOpen ? " is-open" : ""}`}
                      title="Tuỳ chọn"
                      aria-label={`Tuỳ chọn video ${i + 1}`}
                      aria-haspopup="menu"
                      aria-expanded={menuOpen}
                      onClick={() => setMenuJobId(menuOpen ? null : job.id)}
                    >
                      {Icon.more({ size: 16 })}
                    </button>
                    {menuOpen && (
                      <div ref={menuSurfaceRef} className="ns-queue-job-menu" role="menu" onKeyDown={jobMenu.onKeyDown}>
                        {job.status === "queued" && (
                          <>
                            <button
                              type="button"
                              role="menuitem"
                              className="ns-queue-job-menu-item"
                              onClick={() => {
                                jobMenu.close(false);
                                menuTriggerRef.current?.focus();
                                setEditJob(job);
                              }}
                            >
                              Sửa
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              className="ns-queue-job-menu-item danger"
                              onClick={() => {
                                jobMenu.close();
                                void onDeleteJob(job.id).catch((error: unknown) => {
                                  const details = errorDetails(error);
                                  notify.error({
                                    title: "Không xóa được",
                                    message: compactNotificationMessage(details, "Thử lại."),
                                    details,
                                  });
                                });
                              }}
                            >
                              Xóa
                            </button>
                          </>
                        )}
                        {job.status === "running" && (
                          <button
                            type="button"
                            role="menuitem"
                            className="ns-queue-job-menu-item"
                            onClick={() => {
                              jobMenu.close();
                              void onCancelJob(job.id).catch((error: unknown) => {
                                const details = errorDetails(error);
                                notify.error({
                                  title: "Không dừng được",
                                  message: compactNotificationMessage(details, "Thử lại."),
                                  details,
                                });
                              });
                            }}
                          >
                            Dừng
                          </button>
                        )}
                        {(job.status === "done" || job.status === "failed" || job.status === "cancelled") && (
                          <button
                            type="button"
                            role="menuitem"
                            className="ns-queue-job-menu-item danger"
                            onClick={() => {
                              jobMenu.close();
                              void onDeleteJob(job.id).catch((error: unknown) => {
                                const details = errorDetails(error);
                                notify.error({
                                  title: "Không xóa được",
                                  message: compactNotificationMessage(details, "Thử lại."),
                                  details,
                                });
                              });
                            }}
                          >
                            Xóa
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {editJob && (
        <JobEditDialog
          job={editJob}
          bgm={bgm}
          onBgmAdd={onBgmAdd}
          onBgmRemove={onBgmRemove}
          onPickImages={onPickImages}
          onClose={() => setEditJob(null)}
          onSave={async (patch) => {
            await onUpdateJob(editJob.id, patch);
            setEditJob(null);
          }}
        />
      )}
    </div>
  );
};

const JobEditDialog: React.FC<{
  job: QueueJobVM;
  bgm: BgmTrackVM[];
  onBgmAdd?: () => void;
  onBgmRemove?: (name: string) => Promise<void>;
  onPickImages?: () => Promise<PickImagesResult>;
  onClose: () => void;
  onSave: (patch: QueueJobUpdateInput) => Promise<void>;
}> = ({ job, bgm, onBgmAdd, onBgmRemove, onPickImages, onClose, onSave }) => {
  const notify = useNotifications();
  const [raw, setRaw] = useState(job.raw);
  const [durationTier, setDurationTier] = useState<DurationTierChoice>(job.durationTier);
  const [videoLanguage, setVideoLanguage] = useState<VideoLanguageChoice>(job.videoLanguage);
  const [voiceProvider, setVoiceProvider] = useState<VoiceProviderChoice>(job.voiceProvider);
  const [bgmSelected, setBgmSelected] = useState<string | null>(job.bgm);
  const [images, setImages] = useState<StagedImageRef[]>(job.images ?? []);
  const [openKnob, setOpenKnob] = useState<"duration" | "language" | "voice" | null>(null);
  const [saving, setSaving] = useState(false);
  const valid = validateCreateInput({ raw });
  const panelRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const closeDialog = (): void => { if (!saving) onClose(); };
  useModalFocus(true, panelRef, closeDialog, promptRef);

  return (
    <div className="ns-queue-edit-overlay" role="presentation" onMouseDown={closeDialog}>
      <div ref={panelRef} className="ns-card ns-queue-edit-panel" role="dialog" aria-modal="true" aria-label="Sửa video trong hàng đợi" onMouseDown={(event) => event.stopPropagation()} tabIndex={-1}>
        <div className="ns-queue-edit-head">
          <strong>Sửa video</strong>
          <button type="button" className="ns-btn" onClick={closeDialog}>
            Đóng
          </button>
        </div>
        <textarea
          ref={promptRef}
          className="ns-composer-input"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          rows={3}
          aria-label="Prompt"
        />
        {!job.smoke && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            {images.map((image) => (
              <span key={image.ref} className="ns-queue-image-ref">
                {image.ref.split("/").pop()}
                <button type="button" aria-label="Bỏ ảnh" onClick={() => setImages((current) => current.filter((item) => item.ref !== image.ref))}>×</button>
              </span>
            ))}
            {onPickImages ? (
              <button
                type="button"
                className="ns-btn"
                onClick={() => {
                  void onPickImages().then((result) => {
                    setImages((current) => {
                      const refs = new Set(current.map((image) => image.ref));
                      return [...current, ...result.staged.filter((image) => !refs.has(image.ref)).map(({ ref, width, height }) => ({ ref, width, height }))];
                    });
                  }).catch((error: unknown) => {
                    const details = errorDetails(error);
                    notify.error({ title: "Không nạp được ảnh", message: compactNotificationMessage(details, "Thử lại."), details });
                  });
                }}
              >
                Thêm ảnh
              </button>
            ) : null}
          </div>
        )}
        {!job.smoke && (
          <div className="ns-create-knobs" style={{ marginTop: 12 }}>
            <KnobButton
              icon={Icon.clock({ size: 14 })}
              title="Thời lượng"
              value={durationTier}
              open={openKnob === "duration"}
              onToggle={() => setOpenKnob((k) => (k === "duration" ? null : "duration"))}
              onClose={() => setOpenKnob(null)}
              onChange={setDurationTier}
              options={[
                { value: 1, label: "0:45" },
                { value: 2, label: "1:30" },
                { value: 3, label: "2:30" },
                { value: 4, label: "3:30" },
              ]}
            />
            <KnobButton
              icon={Icon.globe({ size: 14 })}
              title="Ngôn ngữ"
              value={videoLanguage}
              open={openKnob === "language"}
              onToggle={() => setOpenKnob((k) => (k === "language" ? null : "language"))}
              onClose={() => setOpenKnob(null)}
              onChange={(next) => {
                const selection = applyVideoLanguageSelection(next, voiceProvider);
                setVideoLanguage(selection.videoLanguage);
                setVoiceProvider(selection.voiceProvider);
              }}
              options={languageOptionsForProvider(voiceProvider)}
            />
            <KnobButton
              icon={Icon.spark({ size: 14 })}
              title="Giọng đọc"
              value={voiceProvider}
              open={openKnob === "voice"}
              onToggle={() => setOpenKnob((k) => (k === "voice" ? null : "voice"))}
              onClose={() => setOpenKnob(null)}
              onChange={(next) => {
                const selection = applyVoiceProviderSelection(next, videoLanguage);
                setVideoLanguage(selection.videoLanguage);
                setVoiceProvider(selection.voiceProvider);
              }}
              options={[
                { value: "vivibe", label: "Vivibe" },
                { value: "elevenlabs", label: "ElevenLabs" },
              ]}
            />
            {onBgmAdd && onBgmRemove ? (
              <BgmPicker
                className="ns-create-bgm"
                bgm={bgm}
                selected={bgmSelected}
                busy={saving}
                onAdd={onBgmAdd}
                onRemove={onBgmRemove}
                onSelect={setBgmSelected}
              />
            ) : null}
          </div>
        )}
        <div className="ns-queue-edit-actions">
          <button type="button" className="ns-btn" onClick={closeDialog} disabled={saving}>
            Huỷ
          </button>
          <button
            type="button"
            className="ns-btn ns-btn-primary"
            disabled={saving || !valid.ok}
            onClick={() => {
              setSaving(true);
              void onSave({
                raw: raw.trim(),
                ...(job.smoke
                  ? {}
                  : {
                      durationTier,
                      videoLanguage,
                      voiceProvider,
                      bgm: bgmSelected,
                      images,
                    }),
              })
                .catch((error: unknown) => {
                  const details = errorDetails(error);
                  notify.error({
                    title: "Không lưu được",
                    message: compactNotificationMessage(details, "Thử lại."),
                    details,
                  });
                })
                .finally(() => setSaving(false));
            }}
          >
            <StableButtonLabel reserve={["Đang lưu…", "Lưu"]}>{saving ? "Đang lưu…" : "Lưu"}</StableButtonLabel>
          </button>
        </div>
      </div>
    </div>
  );
};
