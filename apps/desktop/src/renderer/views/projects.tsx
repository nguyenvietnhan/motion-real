import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FriendlyStatus, ProjectCardVM } from "../../shared/types.js";
import { paginate, type GalleryLoad } from "../../shared/gallery-controller.js";
import { FRIENDLY_LABELS, FRIENDLY_SHORT_LABELS, FRIENDLY_STATUSES } from "../../shared/friendly-status.js";
import { Icon } from "../icons.js";
import { EmptyState, LoadingLine, PageHeader, ProjectGrid, StableButtonLabel } from "../primitives.js";
import { useDismissable } from "../use-dismissable.js";
import { useMenuNavigation } from "../use-menu-navigation.js";

/** Scroll the shell main pane to top (gallery lives inside `.ns-main`). */
function scrollGalleryToTop(): void {
  const main = document.querySelector(".ns-main");
  if (main instanceof HTMLElement) main.scrollTo({ top: 0, behavior: "auto" });
}

type GalleryFilter = "all" | FriendlyStatus;

const FILTERS: { id: GalleryFilter; label: string }[] = [
  { id: "all", label: "Tất cả" },
  ...FRIENDLY_STATUSES.map((id) => ({ id, label: FRIENDLY_SHORT_LABELS[id] })),
];

/** Compact filter: icon + "Lọc" + current value, dropdown options. */
const GalleryFilterMenu: React.FC<{
  value: GalleryFilter;
  onChange: (next: GalleryFilter) => void;
}> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const current = FILTERS.find((f) => f.id === value) ?? FILTERS[0]!;
  const close = useCallback(() => setOpen(false), []);
  useDismissable(open, close, ref);
  const menu = useMenuNavigation(open, close, triggerRef, menuRef);

  return (
    <div ref={ref} className="ns-gallery-filter-wrap">
      <button
        ref={triggerRef}
        type="button"
        className={`ns-gallery-filter-trigger${open ? " is-open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Lọc: ${current.label}`}
        onClick={() => setOpen((v) => !v)}
      >
        {Icon.film({ size: 14 })}
        <span className="ns-gallery-filter-caption">Lọc</span>
        <span className="ns-gallery-filter-value">
          <StableButtonLabel reserve={FILTERS.map((filter) => filter.label)}>{current.label}</StableButtonLabel>
        </span>
      </button>
      {open && (
        <div ref={menuRef} className="ns-gallery-filter-menu" role="listbox" aria-label="Lọc theo trạng thái" onKeyDown={menu.onKeyDown}>
          {FILTERS.map((f) => {
            const active = f.id === value;
            return (
              <button
                key={f.id}
                type="button"
                role="option"
                aria-selected={active}
                className={`ns-gallery-filter-opt${active ? " is-active" : ""}`}
                onClick={() => {
                  onChange(f.id);
                  menu.close();
                }}
                title={f.id === "all" ? "Tất cả dự án" : FRIENDLY_LABELS[f.id]}
              >
                <span className="ns-gallery-filter-tick">{active ? Icon.check({ size: 14 }) : null}</span>
                <span>{f.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

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

  // New page content starts at the top of the list, not at the old scroll offset.
  useEffect(() => {
    scrollGalleryToTop();
  }, [cur]);

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
      {load === "loading" && <LoadingLine />}
      {load === "empty" && <EmptyState icon={Icon.film({ size: 34 })} title="Chưa có dự án" hint="Tạo video mới để bắt đầu." />}
      {load === "error" && (
        <EmptyState
          icon={Icon.film({ size: 34 })}
          title="Không tải được danh sách"
          hint="Thử lại sau giây lát."
          action={onRetry && <button className="ns-btn ns-btn-primary" onClick={onRetry}>Thử lại</button>}
        />
      )}
      {load === "populated" && (
        <>
          <div className="ns-gallery-toolbar">
            <GalleryFilterMenu value={filter} onChange={setFilterAndReset} />
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
                <div
                  className="ns-gallery-pager"
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, marginTop: 18 }}
                >
                  <button
                    type="button"
                    className="ns-btn ns-btn-icon-only"
                    disabled={cur <= 1}
                    aria-label="Trang trước"
                    title="Trang trước"
                    onClick={() => setPage(cur - 1)}
                  >
                    {Icon.chevronLeft({ size: 18 })}
                  </button>
                  <span className="ns-tabular" style={{ color: "var(--muted-foreground)", fontSize: 13, minWidth: "14ch", textAlign: "center" }}>
                    Trang {cur}/{totalPages} · {total} dự án
                  </span>
                  <button
                    type="button"
                    className="ns-btn ns-btn-icon-only"
                    disabled={cur >= totalPages}
                    aria-label="Trang sau"
                    title="Trang sau"
                    onClick={() => setPage(cur + 1)}
                  >
                    {Icon.chevronRight({ size: 18 })}
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
};
