import React, { useState } from "react";
import type { CrawledImageVM } from "../../shared/types.js";
import { Icon } from "../icons.js";
import { StableButtonLabel } from "../primitives.js";

/**
 * Image review (crawled-image review): a blocking screen shown BEFORE authoring when a
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
    <div className="ns-image-review">
      <div className="ns-card ns-image-review-bar">
        <p className="ns-image-review-help">
          Chọn ảnh đưa vào video. AI tự xếp cảnh. Ảnh đề xuất đã tick sẵn.
        </p>
        <div className="ns-image-review-actions">
          <button type="button" className="ns-btn" onClick={() => submit([])} disabled={submitting}>
            Bỏ qua ảnh
          </button>
          <button
            type="button"
            className="ns-btn ns-btn-primary"
            onClick={() => submit(selectedRefs)}
            disabled={submitting || count === 0}
            title={count === 0 ? "Chọn ảnh, hoặc bấm Bỏ qua ảnh." : undefined}
          >
            <StableButtonLabel reserve={["Đang xử lý…", "Dùng ảnh (99)"]}>
              {submitting ? "Đang xử lý…" : `Dùng ảnh (${count})`}
            </StableButtonLabel>
          </button>
        </div>
      </div>

      <div className="ns-image-review-grid">
        {images.map((img) => {
          const on = checked[img.ref] ?? false;
          return (
            <button
              key={img.ref}
              type="button"
              className={`ns-image-tile${on ? " is-selected" : ""}`}
              onClick={() => toggle(img.ref)}
              aria-pressed={on}
              title={img.sourceUrl}
            >
              <span
                className="ns-image-tile-media"
                style={{ backgroundImage: `url(${img.previewUrl})` }}
              />
              <span className={`ns-image-tile-check${on ? " is-on" : ""}`} aria-hidden="true">
                {on ? "✓" : ""}
              </span>
              {img.suggested && <span className="ns-image-tile-badge">AI đề xuất</span>}
              <span className="ns-image-tile-caption">
                {host(img.sourceUrl)} · {img.width}×{img.height}
              </span>
            </button>
          );
        })}
      </div>

      {images.length === 0 && (
        <p className="ns-image-review-empty">
          {Icon.info({ size: 16 })} Không tìm thấy ảnh phù hợp. Video sẽ dựng bằng chữ.
        </p>
      )}
    </div>
  );
};
