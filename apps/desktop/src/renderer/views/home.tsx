import React, { useEffect, useRef, useState } from "react";
import type { ProjectCardVM, StagedImage, PickImagesResult, DroppedImage, VideoFormatChoice, DurationTierChoice, VideoLanguageChoice, VoiceProviderChoice } from "../../shared/types.js";
import type { GalleryLoad } from "../../shared/gallery-controller.js";
import { validateCreateInput, extractUrls } from "../../shared/create-validation.js";
import { Icon } from "../icons.js";
import { EmptyState, PageHeader, ProjectGrid } from "../primitives.js";
import { compactNotificationMessage, errorDetails, useNotifications } from "../notifications.js";

/** Read a File's bytes and base64-encode them (stable across the IPC boundary). */
async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

/** Plain-Vietnamese reason for a rejected image pick (never a raw error token). */
const REJECT_REASON: Record<string, string> = {
  "unsupported-format": "định dạng không hỗ trợ",
  "too-large": "ảnh quá lớn (>10MB)",
  "dimensions-too-large": "kích thước quá lớn (>4096px)",
  "decode-failed": "không đọc được ảnh",
  empty: "tệp rỗng",
};

function rejectedImageDetails(rejected: PickImagesResult["rejected"]): string {
  return rejected.map((r) => REJECT_REASON[r.reason] ?? r.reason).join(", ");
}

/**
 * A compact delivery-knob button (freeform-engine G3): a short pill showing an
 * icon + the current value, sitting inline next to the "+" attach button. Click
 * it to open a small popover of mutually-exclusive options; the choice closes the
 * popover. Generic over the option value so format / tier / video-language stay
 * type-safe. `open`/`onToggle` are lifted to the parent so only ONE knob popover
 * is open at a time. Keeping each knob a separate button (rather than one big
 * "Tùy chỉnh" panel) means a non-technical user only ever sees three tidy chips.
 */
function KnobButton<T extends string | number>(props: {
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
  // Close on an outside click / Escape so a popover never lingers over the page.
  useEffect(() => {
    if (!props.open) return;
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) props.onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") props.onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [props]);
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

export function applyVideoLanguageSelection(
  next: VideoLanguageChoice,
  currentProvider: VoiceProviderChoice,
): { videoLanguage: VideoLanguageChoice; voiceProvider: VoiceProviderChoice } {
  return next === "en"
    ? { videoLanguage: "en", voiceProvider: "elevenlabs" }
    : { videoLanguage: "vi", voiceProvider: currentProvider };
}

export const VIDEO_LANGUAGE_OPTIONS = [
  { value: "vi", label: "Việt" },
  { value: "en", label: "Anh", warn: "Video tiếng Anh sử dụng ElevenLabs." },
] as const satisfies readonly { value: VideoLanguageChoice; label: string; warn?: string }[];

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
  aiReady: boolean;
  load: GalleryLoad;
  cards: ProjectCardVM[];
  onCreate: (
    raw: string,
    images: StagedImage[],
    choices: { format: VideoFormatChoice; durationTier: DurationTierChoice; videoLanguage: VideoLanguageChoice; voiceProvider: VoiceProviderChoice },
  ) => void | Promise<void>;
  onOpen: (projectId: string) => void;
  onConnectPrompt: () => void;
  defaultVoiceProvider: VoiceProviderChoice;
  /** Open the native image picker (Phase 2 Block A); resolves staged images + rejections. */
  onPickImages?: () => Promise<PickImagesResult>;
  /** Import raw bytes from a paste (Ctrl+V) or drag-drop (Phase 2 Block A); resolves staged images + rejections. */
  onImportImageBytes?: (files: DroppedImage[]) => Promise<PickImagesResult>;
  /** Free a staged image's bytes on disk when the user removes it (best-effort; the 24h sweep is the backstop). */
  onUnstageImage?: (ref: string) => void;
  onDelete?: (id: string) => void;
  onReveal?: (id: string) => void;
  /** Rename a project's display title (H2/R9.4). Absent ⇒ no rename affordance. */
  onRename?: (id: string, newTitle: string) => void;
  onRetry?: () => void;
}> = ({ aiReady, load, cards, onCreate, onOpen, onConnectPrompt, defaultVoiceProvider, onPickImages, onImportImageBytes, onUnstageImage, onDelete, onReveal, onRename, onRetry }) => {
  const [raw, setRaw] = useState("");
  const [images, setImages] = useState<StagedImage[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const notify = useNotifications();
  // The three delivery knobs the user picks at create time (freeform-engine
  // R7/R9). The backend threads these into the prompt + spec — the model never
  // chooses them. Defaults: TikTok / tier 1 / Vietnamese video. (Crude temporary
  // UI per D-UI; not styled.)
  const [format, setFormat] = useState<VideoFormatChoice>("tiktok");
  const [durationTier, setDurationTier] = useState<DurationTierChoice>(1);
  const [videoLanguage, setVideoLanguage] = useState<VideoLanguageChoice>("vi");
  const [voiceProvider, setVoiceProvider] = useState<VoiceProviderChoice>(defaultVoiceProvider);
  const [creating, setCreating] = useState(false);
  // Which delivery-knob popover is open (only one at a time); null = all closed.
  // Each knob is its own inline chip next to "+", revealing its options on click.
  const [openKnob, setOpenKnob] = useState<null | "format" | "duration" | "language" | "voice">(null);
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
    void Promise.all(
      files.map(async (f) => ({ name: f.name || "pasted-image", dataBase64: await fileToBase64(f) })),
    )
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
   * ITEM (not in `.files`), so read image items via `getAsFile()` and fall back
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
  const submitCreate = (): void => {
    if (!inputValid || creating) return;
    if (!aiReady) {
      onConnectPrompt();
      return;
    }
    setCreating(true);
    try {
      void Promise.resolve(onCreate(raw, images, { format, durationTier, videoLanguage, voiceProvider })).finally(() => setCreating(false));
    } catch (error) {
      setCreating(false);
      throw error;
    }
  };

  return (
    <div className="ns-content">
      <PageHeader title="Trang chủ" />

      {!aiReady && (
        <div className="ns-card ns-connect-banner">
          <span style={{ color: "var(--muted-foreground)" }}>Kết nối tài khoản AI để bắt đầu tạo video.</span>
          <button className="ns-btn ns-btn-primary" onClick={onConnectPrompt}>{Icon.spark({ size: 15 })} Kết nối AI</button>
        </div>
      )}

      {/* Create hero — drag-drop an image anywhere onto this card (Phase 2 Block A). */}
      <div
        className={`ns-card ns-create-card${dragOver ? " is-dragging" : ""}`}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <div className="ns-create-heading">
          <h2>Tạo video mới</h2>
        </div>
        {/* Chat-style composer: the textarea sits in a bordered box with a small
            inline "+" attach button (Gemini/ChatGPT style). Pick a file, paste
            (Ctrl+V into the textarea), or drag-drop onto the card. */}
        <div className="ns-composer">
          {/* Thumbnail strip of the attached pool, above the input like a chat draft. */}
          {images.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "12px 12px 0" }}>
              {images.map((img) => (
                <div key={img.ref} style={{ position: "relative", width: 56, height: 74, borderRadius: 6, overflow: "hidden",
                  border: "1px solid var(--border)", background: `center/cover no-repeat #101216 url(${img.previewUrl})` }}>
                  <button aria-label={`Bỏ ảnh ${img.name}`} onClick={() => removeImage(img.ref)}
                    style={{ position: "absolute", right: 2, top: 2, width: 16, height: 16, padding: 0, border: "none", borderRadius: 999,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: "rgba(0,0,0,0.65)", color: "#fff", cursor: "pointer" }}>
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M5 5l14 14M19 5L5 19" /></svg>
                  </button>
                </div>
              ))}
            </div>
          )}
          <textarea
            aria-label="Mô tả video hoặc đường dẫn bài báo"
            className="ns-composer-input"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            onPaste={onPaste}
            placeholder="Mô tả ý tưởng, dán đường link bài báo hoặc thêm ảnh…"
            rows={3}
          />
          <div className="ns-composer-bar">
            {canAttach && onPickImages && (
              <button className="ns-icon-btn" aria-label="Thêm ảnh" title="Thêm ảnh" onClick={pickImages}>
                {Icon.plus({ size: 18 })}
              </button>
            )}
            {/* Delivery-knob chips inline with "+": format / duration /
                video-language / voice provider. Each is a compact pill showing
                its current value; clicking opens a small popover of options. Only
                one popover is open at a time. The backend threads these into the
                prompt + spec; the model never picks them. */}
            <div className="ns-knob-row">
              <KnobButton
                icon={Icon.ratio({ size: 15 })}
                title="Định dạng"
                value={format}
                open={openKnob === "format"}
                onToggle={() => setOpenKnob((k) => (k === "format" ? null : "format"))}
                onClose={() => setOpenKnob(null)}
                onChange={setFormat}
                options={[
                  { value: "tiktok", label: "TikTok 9:16" },
                  { value: "youtube", label: "YouTube 16:9", warn: "Video ngang dài hơn nên thời gian dựng và lượng quota tiêu thụ sẽ cao hơn TikTok." },
                ]}
              />
              <KnobButton
                icon={Icon.clock({ size: 15 })}
                title="Thời lượng"
                value={durationTier}
                open={openKnob === "duration"}
                onToggle={() => setOpenKnob((k) => (k === "duration" ? null : "duration"))}
                onClose={() => setOpenKnob(null)}
                onChange={setDurationTier}
                options={
                  format === "youtube"
                    ? [
                        { value: 1, label: "5:00" },
                        { value: 2, label: "7:30" },
                        { value: 3, label: "10:00" },
                      ]
                    : [
                        { value: 1, label: "0:45" },
                        { value: 2, label: "1:30" },
                        { value: 3, label: "2:30" },
                      ]
                }
              />
              <KnobButton
                icon={Icon.globe({ size: 15 })}
                title="Ngôn ngữ video"
                value={videoLanguage}
                open={openKnob === "language"}
                onToggle={() => setOpenKnob((k) => (k === "language" ? null : "language"))}
                onClose={() => setOpenKnob(null)}
                onChange={(next) => {
                  const selection = applyVideoLanguageSelection(next, voiceProvider);
                  setVideoLanguage(selection.videoLanguage);
                  setVoiceProvider(selection.voiceProvider);
                }}
                options={VIDEO_LANGUAGE_OPTIONS}
              />
              <KnobButton
                icon={Icon.spark({ size: 15 })}
                title="Nhà cung cấp giọng đọc"
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
                  { value: "vivibe", label: "Vivibe", warn: "Vivibe chỉ hỗ trợ tiếng Việt." },
                  { value: "elevenlabs", label: "ElevenLabs" },
                ]}
              />
            </div>
            <div className="ns-create-submit-area">
              {aiReady && reason && <span style={{ color: "var(--warn)", fontSize: 13 }}>{reason}</span>}
              <button
                className="ns-btn ns-btn-primary ns-create-submit"
                onClick={submitCreate}
                disabled={!inputValid || creating}
              >
                {Icon.spark({ size: 16 })} {creating ? "Đang tạo…" : "Tạo bản nháp"}
              </button>
            </div>
          </div>
          {/* Crawled-image and AI-readiness hints below. */}
        </div>
        {hasLink && (
          <p style={{ color: "var(--muted-foreground)", fontSize: 12, margin: "10px 0 0" }}>
            Phát hiện {linkCount} link: app sẽ đọc nội dung và cào ảnh từ bài báo; ảnh bạn tự đính kèm vẫn được đưa cho AI.
          </p>
        )}
        {!aiReady && <p style={{ color: "var(--muted-foreground)", fontSize: 13, margin: "10px 0 0" }}>Chưa sẵn sàng AI. Bấm “Tạo bản nháp” để mở Cài đặt.</p>}
      </div>

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Video gần đây</h2>
        {cards.length > 0 && <span style={{ color: "var(--muted-foreground)", fontSize: 13 }}>{cards.length} dự án</span>}
      </div>

      {load === "loading" && <p style={{ color: "var(--muted-foreground)" }}>Đang tải…</p>}
      {load === "empty" && (
        <EmptyState
          icon={Icon.film({ size: 34 })}
          title="Chưa có video nào"
          hint="Tạo video đầu tiên bằng ô “Tạo video mới”. Chỉ cần một chủ đề hoặc đường dẫn."
        />
      )}
      {load === "error" && (
        <EmptyState
          icon={Icon.film({ size: 34 })}
          title="Không tải được danh sách video"
          hint="Không đọc được dự án. Thử lại."
          action={onRetry && <button className="ns-btn ns-btn-primary" onClick={onRetry}>Thử lại</button>}
        />
      )}
      {load === "populated" && <ProjectGrid cards={recent} onOpen={onOpen} onDelete={onDelete} onReveal={onReveal} onRename={onRename} />}
    </div>
  );
};
