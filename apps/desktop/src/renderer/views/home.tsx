import React, { useRef, useState } from "react";
import type { ProjectCardVM, StagedImage, PickImagesResult, DroppedImage, StylePackVM } from "../../shared/types.js";
import type { GalleryLoad } from "../../shared/gallery-controller.js";
import { validateCreateInput, extractUrls } from "../../shared/create-validation.js";
import { Icon } from "../icons.js";
import { EmptyState, InfoHint, PageHeader, ProjectGrid } from "../primitives.js";

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

/**
 * A small 9:16 CSS sketch of one style pack — NOT a rendered frame, a coarse
 * always-correct hint driven by the SAME chrome tokens the real render reads
 * (border weight/style, grid, ticks, density). When a pack changes its chrome,
 * this sketch follows with no extra work; when a new pack is registered, it gets
 * a thumbnail for free. Deliberately schematic: two title bars + a divider +
 * a caption bar, echoing the real layout's content-zone-over-caption split.
 */
const StyleThumbnail: React.FC<{ preview: StylePackVM["preview"]; large?: boolean }> = ({ preview, large = false }) => {
  const framed = preview.borderStyle !== "none";
  const scale = large ? 2.4 : 1;
  const borderW = (framed ? Math.max(1, Math.min(4, preview.borderWidth)) : 0) * (large ? 1.6 : 1);
  // Density drives how much "content" the sketch shows: airy = sparse, compact =
  // busy. Editorial sits in the middle.
  const bars = preview.density === "airy" ? 2 : preview.density === "compact" ? 4 : 3;
  // A dark-base pack flips the palette: light ink on a deep base, optionally with
  // a starfield backdrop. A light pack keeps the cream/ink editorial look.
  const dark = preview.dark;
  const base = dark ? "#0B1020" : "#F2ECDC";
  const ink = dark ? "#EAF0FF" : "#17150F";
  const subtle = dark ? "rgba(234,240,255,0.45)" : "rgba(23,21,15,0.45)";
  const radius = (preview.rounded ? 12 : 4) * (large ? 1.4 : 1);
  const px = (n: number) => n * scale;
  // Deterministic faux-stars (no Math.random — stable across renders).
  const stars = [
    [18, 14], [52, 22], [30, 40], [70, 34], [12, 58], [60, 64], [40, 78], [80, 52], [24, 90], [66, 96],
  ];
  return (
    <div
      aria-hidden
      style={{
        position: "relative",
        width: px(64),
        height: px(114), // 9:16
        borderRadius: radius,
        background: dark
          ? "radial-gradient(circle at 50% 30%, #1A2444 0%, #0B1020 70%)"
          : base,
        border: framed ? `${borderW}px solid ${ink}` : `1px solid ${dark ? "rgba(234,240,255,0.18)" : "var(--border)"}`,
        overflow: "hidden",
        flex: "0 0 auto",
      }}
    >
      {/* starfield backdrop (dark packs only) */}
      {preview.starfield && stars.map(([x, y], i) => (
        <span key={i} style={{ position: "absolute", left: `${x}%`, top: `${y}%`,
          width: i % 3 === 0 ? px(2) : px(1), height: i % 3 === 0 ? px(2) : px(1),
          borderRadius: 999, background: "#fff", opacity: i % 2 === 0 ? 0.9 : 0.5 }} />
      ))}
      {/* faint grid (only when the pack uses it) */}
      {preview.grid && (
        <div style={{ position: "absolute", inset: 0, opacity: 0.5,
          backgroundImage: "linear-gradient(90deg, rgba(23,21,15,0.08) 1px, transparent 1px), linear-gradient(0deg, rgba(23,21,15,0.08) 1px, transparent 1px)",
          backgroundSize: `${px(10)}px ${px(10)}px` }} />
      )}
      {/* corner registration ticks (only when the pack uses them) */}
      {preview.registrationTicks && [
        { top: px(3), left: px(3) }, { top: px(3), right: px(3) }, { bottom: px(3), left: px(3) }, { bottom: px(3), right: px(3) },
      ].map((pos, i) => (
        <span key={i} style={{ position: "absolute", width: px(5), height: px(5), borderTop: `1px solid ${ink}`, borderLeft: `1px solid ${ink}`, ...pos }} />
      ))}
      {/* content title bars (upper content zone) */}
      <div style={{ position: "absolute", left: px(8), right: px(8), top: px(16), display: "flex", flexDirection: "column", gap: px(5) }}>
        {Array.from({ length: bars }).map((_, i) => (
          <div key={i} style={{ height: px(i === 0 ? 7 : 4), width: i === 0 ? "85%" : `${70 - i * 12}%`,
            background: i === 0 ? ink : subtle, borderRadius: preview.rounded ? px(3) : 1 }} />
        ))}
      </div>
      {/* the divider line (drawn near the content-zone bottom, as in the real layout) */}
      <div style={{ position: "absolute", left: px(8), right: px(8), bottom: px(26), height: px(2), background: ink, opacity: 0.8, borderRadius: preview.rounded ? px(2) : 0 }} />
      {/* a caption bar below the divider */}
      <div style={{ position: "absolute", left: px(12), right: px(12), bottom: px(14), height: px(5), background: dark ? "rgba(234,240,255,0.6)" : "rgba(23,21,15,0.6)", borderRadius: preview.rounded ? px(3) : 1 }} />
    </div>
  );
};

/** Home: create hero (chat-style brief) + recent-projects grid. */
export const HomeView: React.FC<{
  aiReady: boolean;
  load: GalleryLoad;
  cards: ProjectCardVM[];
  /** Selectable design style packs (the create-screen picker); empty ⇒ picker hidden. */
  stylePacks?: StylePackVM[];
  onCreate: (raw: string, images: StagedImage[], stylePackId?: string) => void;
  onOpen: (projectId: string) => void;
  onConnectPrompt: () => void;
  /** Open the native image picker (Phase 2 Block A); resolves staged images + rejections. */
  onPickImages?: () => Promise<PickImagesResult>;
  /** Import raw bytes from a paste (Ctrl+V) or drag-drop (Phase 2 Block A); resolves staged images + rejections. */
  onImportImageBytes?: (files: DroppedImage[]) => Promise<PickImagesResult>;
  /** Free a staged image's bytes on disk when the user removes it (best-effort; the 24h sweep is the backstop). */
  onUnstageImage?: (ref: string) => void;
  onDelete?: (id: string) => void;
  onReveal?: (id: string) => void;
  onRetry?: () => void;
  createError?: string;
}> = ({ aiReady, load, cards, stylePacks = [], onCreate, onOpen, onConnectPrompt, onPickImages, onImportImageBytes, onUnstageImage, onDelete, onReveal, onRetry, createError }) => {
  const [raw, setRaw] = useState("");
  const [images, setImages] = useState<StagedImage[]>([]);
  const [rejectNote, setRejectNote] = useState("");
  const [dragOver, setDragOver] = useState(false);
  // The chosen style pack (the create-screen picker). `undefined` until the list
  // loads OR the user picks; on submit we fall back to the registry default, so
  // a user who never touches the picker gets exactly today's look.
  const [stylePackId, setStylePackId] = useState<string | undefined>(undefined);
  const [stylePickerOpen, setStylePickerOpen] = useState(false);
  const defaultPackId = stylePacks.find((p) => p.isDefault)?.id ?? stylePacks[0]?.id;
  const selectedPackId = stylePackId ?? defaultPackId;
  const selectedPack = stylePacks.find((p) => p.id === selectedPackId);
  // Drag enter/leave fire for EVERY child the cursor crosses, so a naive
  // boolean toggles on each border → flicker. Count enters minus leaves and
  // only clear the highlight when the count returns to 0 (cursor truly left).
  const dragDepth = useRef(0);
  const valid = validateCreateInput({ raw });
  const inputValid = valid.ok;
  const recent = cards.slice(0, 8);
  // Images attach to the project's image pool only when the brief carries NO
  // link (links carry their own future crawl path). Gate on extractUrls over the
  // raw text directly, so an empty/too-long brief still shows the attach UI
  // (you can drop an image before typing) — only a present link hides it.
  const hasLink = extractUrls(raw).length > 0;
  const canAttach = Boolean(onPickImages || onImportImageBytes) && !hasLink;

  /** Merge freshly-staged images into state (dedup by ref) + surface rejections. */
  const mergeResult = (res: PickImagesResult): void => {
    setImages((prev) => {
      const seen = new Set(prev.map((s) => s.ref));
      return [...prev, ...res.staged.filter((s) => !seen.has(s.ref))];
    });
    setRejectNote(
      res.rejected.length > 0
        ? `Bỏ qua ${res.rejected.length} ảnh: ${res.rejected.map((r) => REJECT_REASON[r.reason] ?? r.reason).join(", ")}.`
        : "",
    );
  };

  const pickImages = (): void => {
    if (!onPickImages) return;
    void onPickImages().then(mergeResult);
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
      .catch((err: unknown) =>
        // Surface the real reason (not a generic line) so a stale-preload "…is
        // not a function" — the classic "ran the old bundle" symptom — is visible
        // instead of silently swallowed.
        setRejectNote(`Không nạp được ảnh: ${err instanceof Error ? err.message : String(err)}`),
      );
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

  return (
    <div className="ns-content">
      <PageHeader title="Trang chủ" subtitle="Mô tả video bạn muốn — như đang nhắn tin. Dán kèm link nếu có, hệ thống tự đọc." />

      {!aiReady && (
        <div className="ns-card" style={{ padding: 16, marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between", borderColor: "var(--brand)" }}>
          <span style={{ color: "var(--muted-foreground)" }}>Kết nối tài khoản AI để bắt đầu tạo video.</span>
          <button className="ns-btn ns-btn-primary" onClick={onConnectPrompt}>{Icon.spark({ size: 15 })} Kết nối AI</button>
        </div>
      )}

      {/* Create hero — drag-drop an image anywhere onto this card (Phase 2 Block A). */}
      <div
        className="ns-card"
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        style={{ padding: 24, marginBottom: 32, background: "linear-gradient(180deg, #17191f, var(--card))",
          outline: dragOver ? "2px dashed var(--brand)" : "none", outlineOffset: -6 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, margin: "0 0 14px" }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Tạo video mới</h2>
          <InfoHint text="Dán đường dẫn bài báo hoặc mô tả chủ đề bằng tiếng Việt. AI sẽ tự dựng kịch bản, hình ảnh và lời đọc. Bạn có thể đính ảnh để AI tự chọn cảnh phù hợp." />
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
            placeholder="Ví dụ: “Làm video 1p30s, giọng nữ, từ link này https://vnexpress.net/… tập trung vào nguyên nhân” — hoặc chỉ một chủ đề."
            rows={3}
          />
          <div className="ns-composer-bar">
            {canAttach && onPickImages && (
              <button className="ns-icon-btn" aria-label="Thêm ảnh" title="Thêm ảnh" onClick={pickImages}>
                {Icon.plus({ size: 18 })}
              </button>
            )}
            {/* Style picker trigger: a small star icon-button next to "+". Opens
                a centered Canva-style modal of large preview cards (list from the
                @news/design registry via IPC, so a new pack shows up with no UI
                change). Hidden until the list loads. */}
            {stylePacks.length > 0 && (
              <button
                type="button"
                className={`ns-icon-btn${stylePickerOpen ? " is-active" : ""}`}
                aria-label="Chọn phong cách"
                aria-haspopup="dialog"
                aria-expanded={stylePickerOpen}
                title={`Phong cách: ${selectedPack?.name ?? "mặc định"}`}
                onClick={() => setStylePickerOpen(true)}
              >
                {Icon.spark({ size: 17 })}
              </button>
            )}
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
              {aiReady && reason && <span style={{ color: "var(--warn)", fontSize: 13 }}>{reason}</span>}
              <button className="ns-btn ns-btn-primary" onClick={() => (aiReady ? onCreate(raw, images, selectedPackId) : onConnectPrompt())} disabled={!inputValid}>
                {Icon.plus({ size: 16 })} Tạo bản nháp
              </button>
            </div>
          </div>
        </div>
        {rejectNote && <p style={{ color: "var(--warn)", fontSize: 12, margin: "10px 0 0" }}>{rejectNote}</p>}
        {!aiReady && <p style={{ color: "var(--muted-foreground)", fontSize: 13, margin: "10px 0 0" }}>Chưa sẵn sàng AI — bấm “Tạo bản nháp” để mở Cài đặt.</p>}
        {createError && <p style={{ color: "var(--danger)", fontSize: 13, margin: "10px 0 0" }}>{createError}</p>}
      </div>

      {/* Style picker modal (Canva-template style): a centered dialog with large
          preview cards, opened by the star button. The pack list comes from the
          @news/design registry via IPC, so a new pack appears here with no UI
          change. Each preview is a coarse CSS sketch driven by the same chrome
          tokens the real render reads — not a rendered image. */}
      {stylePickerOpen && (
        <div className="ns-modal-backdrop" onClick={() => setStylePickerOpen(false)}>
          <div
            className="ns-modal ns-style-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Chọn phong cách"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="ns-modal-head">
              <div>
                <h2 className="ns-modal-title">Chọn phong cách</h2>
                <p className="ns-modal-sub">Bộ khung hình ảnh cho video — màu, khung, nền. Nội dung do AI viết theo chủ đề của bạn.</p>
              </div>
              <button className="ns-icon-btn" aria-label="Đóng" onClick={() => setStylePickerOpen(false)}>
                {Icon.close({ size: 16 })}
              </button>
            </div>
            <div className="ns-style-modal-grid" role="radiogroup" aria-label="Phong cách">
              {stylePacks.map((pack) => {
                const active = pack.id === selectedPackId;
                return (
                  <button
                    key={pack.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`ns-style-tile${active ? " is-active" : ""}`}
                    onClick={() => {
                      setStylePackId(pack.id);
                      setStylePickerOpen(false);
                    }}
                  >
                    <StyleThumbnail preview={pack.preview} large />
                    <span className="ns-style-tile-name">{pack.name}</span>
                    <span className="ns-style-tile-desc">{pack.description}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Video gần đây</h2>
        {cards.length > 0 && <span style={{ color: "var(--muted-foreground)", fontSize: 13 }}>{cards.length} dự án</span>}
      </div>

      {load === "loading" && <p style={{ color: "var(--muted-foreground)" }}>Đang tải…</p>}
      {load === "empty" && (
        <EmptyState
          icon={Icon.film({ size: 34 })}
          title="Chưa có video nào"
          hint="Tạo video đầu tiên bằng ô “Tạo video mới” ở trên — chỉ cần một chủ đề hoặc đường dẫn."
        />
      )}
      {load === "error" && (
        <EmptyState
          icon={Icon.film({ size: 34 })}
          title="Không tải được danh sách video"
          hint="Đã xảy ra lỗi khi đọc dự án. Hãy thử lại."
          action={onRetry && <button className="ns-btn ns-btn-primary" onClick={onRetry}>Thử lại</button>}
        />
      )}
      {load === "populated" && <ProjectGrid cards={recent} onOpen={onOpen} onDelete={onDelete} onReveal={onReveal} />}
    </div>
  );
};
