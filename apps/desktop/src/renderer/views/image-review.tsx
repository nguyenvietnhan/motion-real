import React, { useState } from "react";
import type { CrawledImageVM } from "../../shared/types.js";
import { Icon } from "../icons.js";

/**
 * Image review (Phase 2 Block B): a blocking screen shown BEFORE authoring when a
 * brief link yielded crawled article images. The user confirms which images the
 * AI may place; AI-suggested ones are pre-ticked. Submitting the selection (even
 * empty — "Bỏ qua ảnh") resumes the flow: the AI writes the script around exactly
 * the approved set, deciding which scene each image lands on (≤1/scene). The grid
 * (N9/N14/N15) still guards overflow/placement, so this screen is purely "which
 * images", never "where they go".
 */
export const ImageReviewView: React.FC<{
  images: CrawledImageVM[];
  /** Confirm the selected refs; empty array ⇒ author with no images. */
  onSubmit: (selectedRefs: string[]) => void;
}> = ({ images, onSubmit }) => {
  // Pre-tick the AI-suggested images (when the AI-filter ran); otherwise nothing
  // is checked and the user opts images in.
  const [checked, setChecked] = useState<Record<string, boolean>>(
    Object.fromEntries(images.map((img) => [img.ref, img.suggested])),
  );
  const [submitting, setSubmitting] = useState(false);

  const selectedRefs = images.filter((img) => checked[img.ref]).map((img) => img.ref);
  const count = selectedRefs.length;
  const toggle = (ref: string): void => setChecked((c) => ({ ...c, [ref]: !c[ref] }));
  const submit = (refs: string[]): void => {
    if (submitting) return;
    setSubmitting(true);
    onSubmit(refs);
  };
  const host = (url: string): string => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  };

  return (
    <>
      <div className="ns-card" style={{ padding: 16, marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <span style={{ color: "var(--muted-foreground)", fontSize: 14 }}>
          Chọn các ảnh phù hợp để AI đưa vào video. AI sẽ tự quyết đặt ảnh ở cảnh nào. Ảnh được đề xuất đã tick sẵn.
        </span>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button className="ns-btn" onClick={() => submit([])} disabled={submitting}>Bỏ qua ảnh</button>
          <button
            className="ns-btn ns-btn-primary"
            onClick={() => submit(selectedRefs)}
            disabled={submitting || count === 0}
            title={count === 0 ? "Chưa chọn ảnh nào. Bấm vào ảnh để chọn, hoặc dùng nút Bỏ qua ảnh." : undefined}
          >
            {submitting ? "Đang xử lý…" : `Dùng ảnh đã chọn (${count}) →`}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
        {images.map((img) => {
          const on = checked[img.ref] ?? false;
          return (
            <button
              key={img.ref}
              onClick={() => toggle(img.ref)}
              aria-pressed={on}
              title={img.sourceUrl}
              style={{
                position: "relative",
                padding: 0,
                cursor: "pointer",
                borderRadius: 10,
                overflow: "hidden",
                border: on ? "2px solid var(--brand)" : "1px solid var(--border)",
                background: "#0c0e12",
                aspectRatio: "9 / 16",
                display: "block",
              }}
            >
              <div style={{ position: "absolute", inset: 0, background: `center/contain no-repeat #0c0e12 url(${img.previewUrl})` }} />
              {/* Selection check badge (top-right). */}
              <span
                style={{
                  position: "absolute", right: 6, top: 6, width: 22, height: 22, borderRadius: 999,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: on ? "var(--brand)" : "rgba(0,0,0,0.55)", color: "#fff", fontSize: 12,
                  border: on ? "none" : "1px solid rgba(255,255,255,0.4)",
                }}
              >
                {on ? "✓" : ""}
              </span>
              {/* AI-suggested ribbon (bottom-left). */}
              {img.suggested && (
                <span style={{ position: "absolute", left: 6, top: 6, fontSize: 10, fontWeight: 800, color: "#fff",
                  background: "rgba(0,0,0,0.6)", borderRadius: 5, padding: "1px 6px", lineHeight: "16px" }}>AI đề xuất</span>
              )}
              <span style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "4px 8px", fontSize: 11,
                color: "#fff", background: "linear-gradient(transparent, rgba(0,0,0,0.75))", textAlign: "left",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {host(img.sourceUrl)} · {img.width}×{img.height}
              </span>
            </button>
          );
        })}
      </div>

      {images.length === 0 && (
        <p style={{ color: "var(--muted-foreground)", marginTop: 16, display: "flex", alignItems: "center", gap: 8 }}>
          {Icon.info({ size: 16 })} Không tìm thấy ảnh phù hợp trong bài. Video sẽ dựng bằng chữ.
        </p>
      )}
    </>
  );
};
