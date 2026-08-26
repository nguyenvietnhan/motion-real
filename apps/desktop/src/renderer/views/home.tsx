import React, { useEffect, useRef, useState } from "react";
import type {
  ProjectCardVM,
  StagedImage,
  PickImagesResult,
  DroppedImage,
  DurationTierChoice,
  VideoLanguageChoice,
  VoiceProviderChoice,
  AiAccountState,
  GatewayState,
  SettingsModel,
  BgmTrackVM,
} from "../../shared/types.js";
import type { GalleryLoad } from "../../shared/gallery-controller.js";
import { validateCreateInput, extractUrls } from "../../shared/create-validation.js";
import {
  createPathReadiness,
  settingsTabForCreatePath,
  settingsTabForCreatePathStep,
  voicePresenceFromSettings,
  type CreatePathSettingsTab,
} from "../../shared/create-path-readiness.js";
import { Icon } from "../icons.js";
import { EmptyState, LoadingLine, PageHeader, ProjectGrid, StableButtonLabel } from "../primitives.js";
import { compactNotificationMessage, errorDetails, useNotifications } from "../notifications.js";
import { useDismissable } from "../use-dismissable.js";
import { useMenuNavigation } from "../use-menu-navigation.js";
import { BgmPicker } from "./bgm-picker.js";

/** Read a File's bytes and base64-encode them (stable across the IPC boundary). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Không đọc được ảnh."));
    reader.onabort = () => reject(new Error("Đã dừng đọc ảnh."));
    reader.onload = () => {
      const result = reader.result;
      const comma = typeof result === "string" ? result.indexOf(",") : -1;
      if (typeof result !== "string" || !result.startsWith("data:") || comma < 0) {
        reject(new Error("Dữ liệu ảnh không hợp lệ."));
        return;
      }
      resolve(result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

/** Keep paste/drop memory bounded while preserving the user's file order. */
export async function filesToDroppedImages(files: readonly File[]): Promise<DroppedImage[]> {
  const dropped: DroppedImage[] = [];
  for (const file of files) {
    dropped.push({ name: file.name || "pasted-image", dataBase64: await fileToBase64(file) });
  }
  return dropped;
}

/** Plain-Vietnamese reason for a rejected image pick (never a raw error token). */
const REJECT_REASON: Record<string, string> = {
  "unsupported-format": "định dạng không hỗ trợ",
  "too-large": "ảnh quá lớn (>10MB)",
  "dimensions-too-large": "kích thước quá lớn (>4096px)",
  "decode-failed": "không đọc được ảnh",
  empty: "tệp rỗng",
};

export function rejectedImageDetails(rejected: PickImagesResult["rejected"]): string {
  return rejected.map((r) => REJECT_REASON[r.reason] ?? r.reason).join(", ");
}

export const StagedImageStrip: React.FC<{ images: StagedImage[]; onRemove: (ref: string) => void }> = ({ images, onRemove }) => (
  images.length > 0 ? (
    <div className="ns-attached-images-strip">
      {images.map((img) => (
        <div key={img.ref} className="ns-attached-image-thumb" style={{ backgroundImage: `url(${img.previewUrl})` }}>
          <button type="button" aria-label={`Bỏ ảnh ${img.name}`} onClick={() => onRemove(img.ref)} className="ns-attached-image-remove">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M5 5l14 14M19 5L5 19" /></svg>
          </button>
        </div>
      ))}
    </div>
  ) : null
);

/**
 * A compact delivery-knob button : a short pill showing an
 * icon + the current value, sitting inline next to the "+" attach button. Click
 * it to open a small popover of mutually-exclusive options; the choice closes the
 * popover. Generic over the option value so duration / language / voice stay
 * type-safe. `open`/`onToggle` are lifted so only ONE knob popover is open at a time.
 */
export function KnobButton<T extends string | number>(props: {
  icon: React.ReactNode;
  title: string;
  value: T;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onChange: (next: T) => void;
  options: readonly { value: T; label: string; warn?: string }[];
}): React.ReactElement {
  const current = props.options.find((o) => o.value === props.value);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menu = useMenuNavigation(props.open, props.onClose, triggerRef, menuRef);
  // Close on outside click / Escape so a popover never lingers over the page.
  useDismissable(props.open, props.onClose, ref);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        ref={triggerRef}
        type="button"
        className={`ns-knob-chip${props.open ? " is-open" : ""}`}
        aria-haspopup="true"
        aria-expanded={props.open}
        title={props.title}
        onClick={props.onToggle}
      >
        {props.icon}
        <StableButtonLabel reserve={props.options.map((option) => option.label)}>
          {current?.label ?? String(props.value)}
        </StableButtonLabel>
      </button>
      {props.open && (
        <div ref={menuRef} className="ns-knob-pop" role="menu" aria-label={props.title} onKeyDown={menu.onKeyDown}>
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
                  menu.close();
                }}
              >
                <span className="ns-knob-opt-tick">{active ? Icon.check({ size: 14 }) : null}</span>
                <span style={{ flex: 1 }}>{o.label}</span>
                {o.warn && (
                  <span className="ns-warn-hint" tabIndex={0} role="note" aria-label={o.warn}>
                    {Icon.warn({ size: 15 })}
                    <span className="ns-warn-tip">{o.warn}</span>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Language options depend on voice: Vivibe is Vietnamese-only, so English is
 * hidden (no yellow warn, no silent switch to ElevenLabs when picking EN).
 */
export function languageOptionsForProvider(
  provider: VoiceProviderChoice,
): readonly { value: VideoLanguageChoice; label: string }[] {
  return provider === "vivibe"
    ? [{ value: "vi", label: "Việt" }]
    : [
        { value: "vi", label: "Việt" },
        { value: "en", label: "Anh" },
      ];
}

/** Picking a language never changes provider; EN is only offered under ElevenLabs. */
export function applyVideoLanguageSelection(
  next: VideoLanguageChoice,
  currentProvider: VoiceProviderChoice,
): { videoLanguage: VideoLanguageChoice; voiceProvider: VoiceProviderChoice } {
  if (currentProvider === "vivibe") {
    return { videoLanguage: "vi", voiceProvider: "vivibe" };
  }
  return { videoLanguage: next, voiceProvider: currentProvider };
}

/** Vivibe forces Vietnamese; ElevenLabs keeps the current language. */
export function applyVoiceProviderSelection(
  next: VoiceProviderChoice,
  currentLanguage: VideoLanguageChoice,
): { videoLanguage: VideoLanguageChoice; voiceProvider: VoiceProviderChoice } {
  return next === "vivibe"
    ? { videoLanguage: "vi", voiceProvider: "vivibe" }
    : { videoLanguage: currentLanguage, voiceProvider: "elevenlabs" };
}

/** Home: create hero (chat-style brief) + recent-projects grid. */
export const HomeView: React.FC<{
  gateway: GatewayState;
  account: AiAccountState;
  /** Public voice presence fields from settings (no secrets). */
  voiceCredentials: SettingsModel["voiceCredentials"];
  vivibeVoiceId?: string;
  elevenLabsVoiceId?: string;
  load: GalleryLoad;
  cards: ProjectCardVM[];
  onCreate: (
    raw: string,
    images: StagedImage[],
    choices: {
      durationTier: DurationTierChoice;
      videoLanguage: VideoLanguageChoice;
      voiceProvider: VoiceProviderChoice;
      /** Library track name, or null for no music (written before authoring). */
      bgm: string | null;
    },
  ) => void | Promise<void>;
  onOpen: (projectId: string) => void;
  /** Open Settings; optional tab deep-link (ai | voice) from create-path steps. */
  onConnectPrompt: (tab?: CreatePathSettingsTab) => void;
  defaultVoiceProvider: VoiceProviderChoice;
  /** Open the native image picker (create-time image staging); resolves staged images + rejections. */
  onPickImages?: () => Promise<PickImagesResult>;
  /** Import raw bytes from a paste (Ctrl+V) or drag-drop (create-time image staging); resolves staged images + rejections. */
  onImportImageBytes?: (files: DroppedImage[]) => Promise<PickImagesResult>;
  /** Free a staged image's bytes on disk when the user removes it (best-effort; the 24h sweep is the backstop). */
  onUnstageImage?: (ref: string) => void;
  onDelete?: (id: string) => void;
  onReveal?: (id: string) => void;
  /** Rename a project's display title. Absent ⇒ no rename affordance. */
  onRename?: (id: string, newTitle: string) => void;
  onRetry?: () => void;
  /** Per-machine BGM library for create-time pick (skip_edit auto-full needs this). */
  bgm?: BgmTrackVM[];
  bgmSelected?: string | null;
  onBgmAdd?: () => void;
  onBgmRemove?: (name: string) => Promise<void>;
  onBgmSelect?: (name: string | null) => void;
  /** When true (Settings → Render smoke), show the round smoke test button. */
  smokeRenderEnabled?: boolean;
  /** Same create path as send, but project "test", ~10s, no TTS. May queue when busy. */
  onRenderSmoke?: (opts: {
    raw: string;
    videoLanguage: VideoLanguageChoice;
  }) => Promise<
    | { ok: true; kind: "started"; projectId: string }
    | { ok: true; kind: "queued"; queueId: string; jobId: string }
    | { ok: false; error: string }
  >;
}> = ({
  gateway,
  account,
  voiceCredentials,
  vivibeVoiceId,
  elevenLabsVoiceId,
  load,
  cards,
  onCreate,
  onOpen,
  onConnectPrompt,
  defaultVoiceProvider,
  onPickImages,
  onImportImageBytes,
  onUnstageImage,
  onDelete,
  onReveal,
  onRename,
  onRetry,
  bgm = [],
  bgmSelected = null,
  onBgmAdd,
  onBgmRemove,
  onBgmSelect,
  smokeRenderEnabled = false,
  onRenderSmoke,
}) => {
  const [raw, setRaw] = useState("");
  const [smokeLoading, setSmokeLoading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [raw]);
  const [images, setImages] = useState<StagedImage[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const notify = useNotifications();
  // Short-form only: duration tier (TikTok pacing) + language + voice.
  // Format is always 9:16 on the backend (no YouTube option).
  const [durationTier, setDurationTier] = useState<DurationTierChoice>(1);
  const [videoLanguage, setVideoLanguage] = useState<VideoLanguageChoice>("vi");
  const [voiceProvider, setVoiceProvider] = useState<VoiceProviderChoice>(defaultVoiceProvider);
  const [creating, setCreating] = useState(false);
  // Recompute when the create-knob voice provider changes (credentials are per provider).
  const createPath = createPathReadiness({
    gateway,
    account,
    voice: voicePresenceFromSettings({
      voiceProvider,
      voiceCredentials,
      vivibeVoiceId,
      elevenLabsVoiceId,
    }),
  });
  const createPathOk = createPath.ok;
  // Which delivery-knob popover is open (only one at a time); null = all closed.
  // Each knob is its own inline chip next to "+", revealing its options on click.
  const [openKnob, setOpenKnob] = useState<null | "duration" | "language" | "voice">(null);
  useEffect(() => {
    const selection = applyVoiceProviderSelection(defaultVoiceProvider, videoLanguage);
    setVoiceProvider(selection.voiceProvider);
    setVideoLanguage(selection.videoLanguage);
  }, [defaultVoiceProvider]);
  // Drag enter/leave fire for EVERY child the cursor crosses, so a naive
  // boolean toggles on each border → flicker. Count enters minus leaves and
  // only clear the highlight when the count returns to 0 (cursor truly left).
  const dragDepth = useRef(0);
  const valid = validateCreateInput({ raw });
  const inputValid = valid.ok;
  const recent = cards.slice(0, 8);
  // A brief may mix links + user-provided images: links trigger the article crawl,
  // while attached images are still forwarded as an explicit user-approved pool.
  const linkCount = extractUrls(raw).length;
  const hasLink = linkCount > 0;
  const canAttach = Boolean(onPickImages || onImportImageBytes);

  /** Merge freshly-staged images into state (dedup by ref) + surface rejections. */
  const mergeResult = (res: PickImagesResult): void => {
    setImages((prev) => {
      const seen = new Set(prev.map((s) => s.ref));
      return [...prev, ...res.staged.filter((s) => !seen.has(s.ref))];
    });
    if (res.rejected.length > 0) {
      notify.warning({
        title: "Một số ảnh bị bỏ qua",
        message: `${res.rejected.length} ảnh không hợp lệ.`,
        details: rejectedImageDetails(res.rejected),
      });
    }
  };

  const pickImages = (): void => {
    if (!onPickImages) return;
    void onPickImages()
      .then(mergeResult)
      .catch((err: unknown) => {
        const details = errorDetails(err);
        notify.error({
          title: "Không nạp được ảnh",
          message: compactNotificationMessage(details, "Kiểm tra tệp rồi thử lại."),
          details,
        });
      });
  };

  /**
   * Read dropped/pasted File objects into BASE64 and import them over IPC. We
   * encode to base64 (not a raw Uint8Array) because a typed array can arrive
   * mangled across the contextBridge/IPC boundary, whereas a string is stable.
   */
  const importFiles = (files: File[]): void => {
    if (!onImportImageBytes || files.length === 0) return;
    void filesToDroppedImages(files)
      .then((dropped) => onImportImageBytes(dropped))
      .then(mergeResult)
      .catch((err: unknown) => {
        const details = errorDetails(err);
        notify.error({
          title: "Không nạp được ảnh",
          message: compactNotificationMessage(details, "Kiểm tra tệp rồi thử lại."),
          details,
        });
      });
  };

  /**
   * Clipboard paste (Ctrl+V): a screenshot/copied bitmap shows up as a clipboard
   * ITEM (not in `.files`), so read image items via `getAsFile` and fall back
   * to `.files` for a copied image file.
   */
  const onPaste = (e: React.ClipboardEvent): void => {
    if (!canAttach || !onImportImageBytes) return;
    const fromItems = Array.from(e.clipboardData.items)
      .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
      .map((it) => it.getAsFile())
      .filter((f): f is File => f !== null);
    const fromFiles = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
    const files = fromItems.length > 0 ? fromItems : fromFiles;
    if (files.length > 0) {
      e.preventDefault(); // don't paste a filename string into the textarea
      importFiles(files);
    }
  };

  /** Drag highlight via a depth counter (enter/leave fire per child → flicker). */
  const onDragEnter = (e: React.DragEvent): void => {
    if (!canAttach) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragOver(true);
  };
  const onDragLeave = (): void => {
    if (!canAttach) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOver(false);
  };
  const onDragOver = (e: React.DragEvent): void => {
    if (canAttach) e.preventDefault(); // allow the drop
  };

  /** Drag-drop onto the create card: import image files, ignore other drags. */
  const onDrop = (e: React.DragEvent): void => {
    dragDepth.current = 0;
    setDragOver(false);
    if (!canAttach) return;
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
    if (files.length > 0) {
      e.preventDefault();
      importFiles(files);
    }
  };

  // Drop from the on-screen pool AND delete the staged file on disk. Without the
  // second step the bytes linger in the staging dir until the 24h startup sweep —
  // pick-then-replace would quietly accumulate dead files. Best-effort: a failed
  // delete never blocks the UI (the sweep is the backstop).
  const removeImage = (ref: string): void => {
    setImages((prev) => prev.filter((s) => s.ref !== ref));
    onUnstageImage?.(ref);
  };
  const reason =
    raw.trim() === ""
      ? ""
      : valid.ok
        ? ""
        : valid.reason === "too-long"
          ? "Nội dung quá dài (tối đa 20.000 ký tự)."
          : "Nội dung chưa hợp lệ.";
  const firstBlocked = createPath.steps.find((s) => !s.ok);
  const sendTitle = creating
    ? "Đang tạo…"
    : !createPathOk
      ? firstBlocked?.hint ?? "Hoàn tất thiết lập trong Cài đặt trước khi tạo."
      : !inputValid
        ? "Nhập mô tả video để tạo."
        : "Tạo video";

  const submitCreate = (): void => {
    if (!inputValid || creating) return;
    if (!createPathOk) {
      onConnectPrompt(settingsTabForCreatePath(createPath));
      return;
    }
    setCreating(true);
    try {
      void Promise.resolve(
        onCreate(raw, images, { durationTier, videoLanguage, voiceProvider, bgm: bgmSelected }),
      ).finally(() => setCreating(false));
    } catch (error) {
      setCreating(false);
      throw error;
    }
  };

  return (
    <div className="ns-content">
      <PageHeader title="Trang chủ" />

      {/* Create hero — drag-drop an image anywhere onto this card (create-time image staging). */}
      <div
        className={`ns-card ns-create-card${dragOver ? " is-dragging" : ""}`}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <div className="ns-create-heading">
          <h2>Tạo video</h2>
        </div>

        <div className="ns-create-flow">
          {/* Top: Composer */}
          <div className="ns-composer">
            <textarea
              ref={textareaRef}
              aria-label="Mô tả video hoặc đường dẫn bài báo"
              className="ns-composer-input"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              onPaste={onPaste}
              placeholder="Mô tả video, dán link hoặc kéo thả ảnh…"
              rows={2}
            />
            
            <StagedImageStrip images={images} onRemove={removeImage} />

            <div className="ns-composer-bar">
              <div className="ns-composer-bar-leading">
                {canAttach && onPickImages && (
                  <button type="button" className="ns-btn-attach" onClick={pickImages} title="Thêm ảnh" aria-label="Thêm ảnh">
                    {Icon.plus({ size: 16 })}
                    <span className="ns-btn-attach-label">Ảnh</span>
                  </button>
                )}
                {hasLink && (
                  <span className="ns-link-detected-badge">
                    {Icon.globe({ size: 14 })} {linkCount} link
                  </span>
                )}
                {createPathOk && reason ? <span className="ns-validation-warning">{reason}</span> : null}
              </div>
              <div className="ns-composer-bar-actions">
                {smokeRenderEnabled && onRenderSmoke && (
                  <button
                    type="button"
                    className="ns-create-smoke"
                    disabled={smokeLoading || creating}
                    title="Smoke: tạo project test ~10s, không TTS (path như tạo video)"
                    aria-label="Smoke: tạo project test ~10s, không TTS"
                    onClick={() => {
                      setSmokeLoading(true);
                      void onRenderSmoke({ raw, videoLanguage })
                        .then((res) => {
                          if (!res.ok) {
                            notify.error({
                              title: "Smoke thất bại",
                              message: compactNotificationMessage(res.error, "Không tạo được project smoke."),
                              details: res.error,
                            });
                          }
                          // ok → App opens workspace like create
                        })
                        .catch((error: unknown) => {
                          const details = errorDetails(error);
                          notify.error({
                            title: "Smoke thất bại",
                            message: compactNotificationMessage(details, "Không tạo được project smoke."),
                            details,
                          });
                        })
                        .finally(() => setSmokeLoading(false));
                    }}
                  >
                    {smokeLoading ? (
                      <span className="ns-create-send-spin ns-create-smoke-spin" aria-hidden />
                    ) : (
                      Icon.play({ size: 16 })
                    )}
                  </button>
                )}
                <button
                  type="button"
                  className="ns-create-send"
                  onClick={submitCreate}
                  disabled={!inputValid || creating || !createPathOk}
                  title={sendTitle}
                  aria-label={sendTitle}
                >
                  {creating ? (
                    <span className="ns-create-send-spin" aria-hidden />
                  ) : (
                    Icon.spark({ size: 18 })
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Compact delivery knobs — one tight row, no empty column stretch */}
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
                busy={creating}
                onAdd={onBgmAdd}
                onRemove={onBgmRemove}
                onSelect={onBgmSelect}
              />
            ) : null}
          </div>
        </div>
      </div>

      {/* Below the prompt so setup never shoves the composer down. */}
      {!createPathOk && (
        <div className="ns-card ns-create-readiness" style={{ padding: 16, marginTop: 16, marginBottom: 20, borderColor: "var(--brand)" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div style={{ minWidth: 0, flex: "1 1 220px" }}>
              <div style={{ fontWeight: 600, marginBottom: 10 }}>Hoàn tất thiết lập để tạo video</div>
              <ul
                className="ns-create-readiness-list"
                style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}
                aria-label="Các bước thiết lập trước khi tạo"
              >
                {createPath.steps.map((step) => {
                  const tone = step.ok ? "var(--good, #16a34a)" : "var(--warn, #ca8a04)";
                  const body = (
                    <>
                      <span style={{ color: tone, display: "inline-flex", flexShrink: 0, marginTop: 2 }} aria-hidden>
                        {step.ok ? Icon.check({ size: 14 }) : Icon.warn({ size: 14 })}
                      </span>
                      <span style={{ minWidth: 0, textAlign: "left" }}>
                        <span style={{ fontWeight: 500 }}>{step.label}</span>
                        {!step.ok && step.hint ? (
                          <span style={{ display: "block", color: "var(--muted-foreground)", marginTop: 2 }}>{step.hint}</span>
                        ) : null}
                      </span>
                    </>
                  );
                  if (step.ok) {
                    return (
                      <li key={step.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13 }}>
                        {body}
                      </li>
                    );
                  }
                  return (
                    <li key={step.id} style={{ listStyle: "none" }}>
                      <button
                        type="button"
                        className="ns-create-readiness-step"
                        onClick={() => onConnectPrompt(settingsTabForCreatePathStep(step.id))}
                        title={step.hint}
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 8,
                          fontSize: 13,
                          width: "100%",
                          margin: 0,
                          padding: "4px 6px",
                          border: "none",
                          borderRadius: 8,
                          background: "transparent",
                          color: "inherit",
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        {body}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
            <button
              type="button"
              className="ns-btn ns-btn-primary"
              onClick={() => onConnectPrompt(settingsTabForCreatePath(createPath))}
              style={{ flexShrink: 0 }}
            >
              {Icon.spark({ size: 15 })} Mở Cài đặt
            </button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Gần đây</h2>
      </div>

      {load === "loading" && <LoadingLine />}
      {load === "empty" && (
        <EmptyState
          icon={Icon.film({ size: 34 })}
          title="Chưa có video"
          hint="Nhập ý tưởng hoặc dán link ở trên để bắt đầu."
        />
      )}
      {load === "error" && (
        <EmptyState
          icon={Icon.film({ size: 34 })}
          title="Không tải được danh sách"
          hint="Thử lại sau giây lát."
          action={onRetry && <button className="ns-btn ns-btn-primary" onClick={onRetry}>Thử lại</button>}
        />
      )}
      {load === "populated" && <ProjectGrid cards={recent} onOpen={onOpen} onDelete={onDelete} onReveal={onReveal} onRename={onRename} />}
    </div>
  );
};
