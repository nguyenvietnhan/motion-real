import React, { useEffect, useRef, useState } from "react";
import type {
  BgmTrackVM,
  DurationTierChoice,
  VideoLanguageChoice,
  VoiceProviderChoice,
} from "../../shared/types.js";
import type { QueueJobUpdateInput, QueueJobVM, QueueProjectVM } from "../../shared/queue-types.js";
import { validateCreateInput } from "../../shared/create-validation.js";
import { Icon } from "../icons.js";
import { EmptyState, LoadingLine, PageHeader, STATUS_COLOR } from "../primitives.js";
import { compactNotificationMessage, errorDetails, useNotifications } from "../notifications.js";
import { useDismissable } from "../use-dismissable.js";
import { BgmPicker } from "./bgm-picker.js";
import {
  applyVideoLanguageSelection,
  applyVoiceProviderSelection,
  languageOptionsForProvider,
} from "./home.js";

function KnobButton<T extends string | number>(props: {
  icon: React.ReactNode;
  title: string;
  value: T;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onChange: (next: T) => void;
  options: readonly { value: T; label: string }[];
}): React.ReactElement {
  const current = props.options.find((o) => o.value === props.value);
  const ref = useRef<HTMLDivElement>(null);
  useDismissable(props.open, props.onClose, ref);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        className={`ns-knob-chip${props.open ? " is-open" : ""}`}
        aria-haspopup="true"
        aria-expanded={props.open}
        title={props.title}
        onClick={props.onToggle}
      >
        {props.icon}
        <span>{current?.label ?? String(props.value)}</span>
      </button>
      {props.open && (
        <div className="ns-knob-pop" role="menu" aria-label={props.title}>
          <span className="ns-knob-pop-label">{props.title}</span>
          {props.options.map((o) => {
            const active = o.value === props.value;
            return (
              <button
                key={String(o.value)}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                className={`ns-knob-opt${active ? " is-active" : ""}`}
                onClick={() => {
                  props.onChange(o.value);
                  props.onClose();
                }}
              >
                <span className="ns-knob-opt-tick">{active ? Icon.check({ size: 14 }) : null}</span>
                <span style={{ flex: 1 }}>{o.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

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

type JobInput = {
  raw: string;
  durationTier: DurationTierChoice;
  videoLanguage: VideoLanguageChoice;
  voiceProvider: VoiceProviderChoice;
  bgm: string | null;
  smoke?: boolean;
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
  onStartQueue: () => Promise<{ ok: true } | { ok: false; error: string }>;
  queueBusy?: boolean;
}> = (props) => {
  if (props.active) {
    return <QueueDetail {...props} queue={props.active} />;
  }

  const { load, queues, onCreateQueue, onOpenQueue, onDeleteQueue, onRefresh, queueBusy = false } = props;

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
          {queues.map((q) => (
            <li key={q.id} className="ns-queue-row">
              <button type="button" className="ns-queue-card" onClick={() => onOpenQueue(q.id)}>
                <span className="ns-queue-card-title">{q.title}</span>
                <span className="ns-queue-card-meta">
                  {q.jobs.length} video · {new Date(q.createdAt).toLocaleString("vi-VN")}
                </span>
              </button>
              <button
                type="button"
                className="ns-queue-delete"
                title="Xóa"
                aria-label={`Xóa ${q.title}`}
                disabled={queueBusy}
                onClick={(e) => {
                  e.stopPropagation();
                  void onDeleteQueue(q.id);
                }}
              >
                {Icon.trash({ size: 16 })}
              </button>
            </li>
          ))}
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
  onBackToList: () => void;
  onDeleteQueue: (id: string) => void | Promise<void>;
  onRenameQueue: (id: string, title: string) => Promise<void>;
  onAddJob: (input: JobInput) => Promise<void>;
  onUpdateJob: (jobId: string, patch: QueueJobUpdateInput) => Promise<void>;
  onDeleteJob: (jobId: string) => Promise<void>;
  onCancelJob: (jobId: string) => Promise<void>;
  onStartQueue: () => Promise<{ ok: true } | { ok: false; error: string }>;
  queueBusy?: boolean;
}> = ({
  queue,
  defaultVoiceProvider,
  smokeRenderEnabled = false,
  bgm = [],
  bgmSelected = null,
  onBgmAdd,
  onBgmRemove,
  onBgmSelect,
  onBackToList,
  onDeleteQueue,
  onRenameQueue,
  onAddJob,
  onUpdateJob,
  onDeleteJob,
  onCancelJob,
  onStartQueue,
  queueBusy = false,
}) => {
  const notify = useNotifications();
  const [raw, setRaw] = useState("");
  const [adding, setAdding] = useState(false);
  const [durationTier, setDurationTier] = useState<DurationTierChoice>(1);
  const [videoLanguage, setVideoLanguage] = useState<VideoLanguageChoice>("vi");
  const [voiceProvider, setVoiceProvider] = useState<VoiceProviderChoice>(defaultVoiceProvider);
  const [openKnob, setOpenKnob] = useState<"duration" | "language" | "voice" | null>(null);
  const [menuJobId, setMenuJobId] = useState<string | null>(null);
  const [editJob, setEditJob] = useState<QueueJobVM | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState(queue.title);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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

  const valid = validateCreateInput({ raw });
  const inputValid = valid.ok;
  const queuedCount = queue.jobs.filter((j) => j.status === "queued").length;
  const progress = queueProgress(queue.jobs);

  const addJob = (smoke: boolean): void => {
    if (adding || queueBusy) return;
    if (!smoke && !inputValid) return;
    setAdding(true);
    void onAddJob({
      raw: smoke ? raw.trim() || "Smoke test — video ngắn 10 giây, không tiếng." : raw.trim(),
      durationTier: smoke ? 1 : durationTier,
      videoLanguage,
      voiceProvider,
      bgm: smoke ? null : bgmSelected,
      ...(smoke ? { smoke: true } : {}),
    })
      .then(() => setRaw(""))
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
          <span className="ns-queue-title-row">
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
            <button
              type="button"
              className="ns-project-action"
              title="Đổi tên"
              aria-label="Đổi tên hàng đợi"
              disabled={queueBusy || renaming}
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
              disabled={queueBusy}
              title="Xóa hàng đợi"
              aria-label="Xóa hàng đợi"
              onClick={() => void onDeleteQueue(queue.id)}
            >
              {Icon.trash({ size: 14 })}
            </button>
            <button
              type="button"
              className="ns-btn ns-btn-primary"
              disabled={queueBusy || queuedCount === 0}
              title={queueBusy ? "Đang chạy…" : "Bắt đầu chạy"}
              onClick={() => {
                void onStartQueue().then((res) => {
                  if (res.ok) {
                    notify.success({ title: "Đã bắt đầu", message: "Chạy lần lượt các video đang chờ." });
                  } else {
                    notify.error({
                      title: "Chưa chạy được",
                      message: compactNotificationMessage(res.error, "Thử lại."),
                      details: res.error,
                    });
                  }
                });
              }}
            >
              {queueBusy ? "Đang chạy…" : "Bắt đầu"}
            </button>
          </div>
        }
      />

      <div className="ns-card ns-create-card">
        <div className="ns-create-flow">
          <div className="ns-composer">
            <textarea
              ref={textareaRef}
              aria-label="Prompt video"
              className="ns-composer-input"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder="Prompt hoặc link…"
              rows={2}
            />
            <div className="ns-composer-bar">
              <div className="ns-composer-bar-leading">
                {!inputValid && raw.trim() !== "" ? (
                  <span className="ns-validation-warning">Nội dung chưa hợp lệ.</span>
                ) : null}
              </div>
              <div className="ns-composer-bar-actions">
                {smokeRenderEnabled && (
                  <button
                    type="button"
                    className="ns-create-smoke"
                    disabled={adding || queueBusy}
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
                  disabled={!inputValid || adding || queueBusy}
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
                busy={adding || queueBusy}
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
          {queueBusy && progress.n > 0 ? (
            <span className="ns-queue-progress" aria-live="polite">
              Đang chạy {progress.k}/{progress.n}
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
                      {" · "}
                      {job.videoLanguage === "en" ? "EN" : "VI"}
                      {!job.smoke ? ` · tier ${job.durationTier}` : ""}
                      {job.error ? ` · ${job.error}` : ""}
                    </span>
                  </span>
                  <div className="ns-queue-job-more" ref={menuOpen ? menuRef : undefined}>
                    <button
                      type="button"
                      className={`ns-queue-job-more-btn${menuOpen ? " is-open" : ""}`}
                      title="Tuỳ chọn"
                      aria-label={`Tuỳ chọn video ${i + 1}`}
                      aria-expanded={menuOpen}
                      onClick={() => setMenuJobId(menuOpen ? null : job.id)}
                    >
                      {Icon.more({ size: 16 })}
                    </button>
                    {menuOpen && (
                      <div className="ns-queue-job-menu" role="menu">
                        {job.status === "queued" && (
                          <>
                            <button
                              type="button"
                              role="menuitem"
                              className="ns-queue-job-menu-item"
                              onClick={() => {
                                setMenuJobId(null);
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
                                setMenuJobId(null);
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
                              setMenuJobId(null);
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
                              setMenuJobId(null);
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
  onClose: () => void;
  onSave: (patch: QueueJobUpdateInput) => Promise<void>;
}> = ({ job, bgm, onBgmAdd, onBgmRemove, onClose, onSave }) => {
  const notify = useNotifications();
  const [raw, setRaw] = useState(job.raw);
  const [durationTier, setDurationTier] = useState<DurationTierChoice>(job.durationTier);
  const [videoLanguage, setVideoLanguage] = useState<VideoLanguageChoice>(job.videoLanguage);
  const [voiceProvider, setVoiceProvider] = useState<VoiceProviderChoice>(job.voiceProvider);
  const [bgmSelected, setBgmSelected] = useState<string | null>(job.bgm);
  const [openKnob, setOpenKnob] = useState<"duration" | "language" | "voice" | null>(null);
  const [saving, setSaving] = useState(false);
  const valid = validateCreateInput({ raw });

  return (
    <div className="ns-queue-edit-overlay" role="dialog" aria-modal="true" aria-label="Sửa video trong hàng đợi">
      <div className="ns-card ns-queue-edit-panel">
        <div className="ns-queue-edit-head">
          <strong>Sửa video</strong>
          <button type="button" className="ns-btn" onClick={onClose}>
            Đóng
          </button>
        </div>
        <textarea
          className="ns-composer-input"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          rows={3}
          aria-label="Prompt"
        />
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
          <button type="button" className="ns-btn" onClick={onClose} disabled={saving}>
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
            {saving ? "Đang lưu…" : "Lưu"}
          </button>
        </div>
      </div>
    </div>
  );
};
