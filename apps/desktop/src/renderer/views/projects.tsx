import React, { useMemo, useState } from "react";
import type { FriendlyStatus, ProjectCardVM } from "../../shared/types.js";
import { paginate, type GalleryLoad } from "../../shared/gallery-controller.js";
import { FRIENDLY_LABELS } from "../../shared/friendly-status.js";
import { Icon } from "../icons.js";
import { EmptyState, PageHeader, ProjectGrid } from "../primitives.js";

type GalleryFilter = "all" | FriendlyStatus;

const FILTERS: { id: GalleryFilter; label: string }[] = [
  { id: "all", label: "Tất cả" },
  { id: "building", label: "Đang dựng" },
  { id: "draft-ready", label: "Duyệt" },
  { id: "done", label: "Xong" },
  { id: "error", label: "Lỗi" },
];

/** Projects: the full gallery of every video, paginated 12-per-page. */
export const ProjectsView: React.FC<{
  load: GalleryLoad;
  cards: ProjectCardVM[];
  onOpen: (id: string) => void;
  onNew: () => void;
  onDelete?: (id: string) => void;
  onReveal?: (id: string) => void;
  /** Rename a project's display title. Absent ⇒ no rename affordance. */
  onRename?: (id: string, newTitle: string) => void;
  onRetry?: () => void;
}> = ({ load, cards, onOpen, onNew, onDelete, onReveal, onRename, onRetry }) => {
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<GalleryFilter>("all");

  const filtered = useMemo(
    () => (filter === "all" ? cards : cards.filter((c) => c.status === filter)),
    [cards, filter],
  );

  // `paginate` clamps the page into range, so a delete that empties the last
  // page (or a poll that shrinks the list) shows the new last page, not blank.
  const { items, page: cur, totalPages, total } = paginate(filtered, page);

  const setFilterAndReset = (next: GalleryFilter): void => {
    setFilter(next);
    setPage(1);
  };

  return (
    <div className="ns-content">
      <PageHeader
        title="Dự án"
        action={
          <button className="ns-btn ns-btn-primary" onClick={onNew}>
            {Icon.spark({ size: 15 })} Tạo video
          </button>
        }
      />
      {load === "loading" && <p style={{ color: "var(--muted-foreground)" }}>Đang tải…</p>}
      {load === "empty" && <EmptyState icon={Icon.film({ size: 34 })} title="Chưa có dự án" hint="Tạo video mới để bắt đầu." />}
      {load === "error" && (
        <EmptyState
          icon={Icon.film({ size: 34 })}
          title="Không tải được danh sách video"
          hint="Không đọc được dự án. Thử lại."
          action={onRetry && <button className="ns-btn ns-btn-primary" onClick={onRetry}>Thử lại</button>}
        />
      )}
      {load === "populated" && (
        <>
          <div className="ns-gallery-filters" role="tablist" aria-label="Lọc theo trạng thái">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filter === f.id}
                className={`ns-gallery-filter${filter === f.id ? " is-active" : ""}`}
                onClick={() => setFilterAndReset(f.id)}
                title={f.id === "all" ? "Tất cả dự án" : FRIENDLY_LABELS[f.id]}
              >
                {f.label}
              </button>
            ))}
          </div>
          {filtered.length === 0 ? (
            <EmptyState
              icon={Icon.film({ size: 34 })}
              title="Không có dự án"
              hint="Thử bộ lọc khác."
              action={
                <button type="button" className="ns-btn" onClick={() => setFilterAndReset("all")}>
                  Xem tất cả
                </button>
              }
            />
          ) : (
            <>
              <ProjectGrid cards={items} onOpen={onOpen} onDelete={onDelete} onReveal={onReveal} onRename={onRename} />
              {totalPages > 1 && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, marginTop: 18 }}>
                  <button className="ns-btn" disabled={cur <= 1} onClick={() => setPage(cur - 1)}>Trước</button>
                  <span className="ns-tabular" style={{ color: "var(--muted-foreground)", fontSize: 13, minWidth: "14ch", textAlign: "center" }}>
                    Trang {cur}/{totalPages} · {total} dự án
                  </span>
                  <button className="ns-btn" disabled={cur >= totalPages} onClick={() => setPage(cur + 1)}>Sau</button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
};
