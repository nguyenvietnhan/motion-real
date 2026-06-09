import React from "react";
import type { ProjectCardVM } from "../../shared/types.js";
import type { GalleryLoad } from "../../shared/gallery-controller.js";
import { Icon } from "../icons.js";
import { EmptyState, PageHeader, ProjectGrid } from "../primitives.js";

/** Projects: the full gallery of every video. */
export const ProjectsView: React.FC<{
  load: GalleryLoad;
  cards: ProjectCardVM[];
  onOpen: (id: string) => void;
  onNew: () => void;
  onDelete?: (id: string) => void;
  onReveal?: (id: string) => void;
  onRetry?: () => void;
}> = ({ load, cards, onOpen, onNew, onDelete, onReveal, onRetry }) => (
  <div className="ns-content">
    <PageHeader
      title="Dự án"
      subtitle="Tất cả video của bạn."
      action={<button className="ns-btn ns-btn-primary" onClick={onNew}>{Icon.plus({ size: 16 })} Tạo video</button>}
    />
    {load === "loading" && <p style={{ color: "var(--muted-foreground)" }}>Đang tải…</p>}
    {load === "empty" && <EmptyState icon={Icon.film({ size: 34 })} title="Chưa có dự án" hint="Bấm “Tạo video” để bắt đầu." />}
    {load === "error" && (
      <EmptyState
        icon={Icon.film({ size: 34 })}
        title="Không tải được danh sách video"
        hint="Đã xảy ra lỗi khi đọc dự án. Hãy thử lại."
        action={onRetry && <button className="ns-btn ns-btn-primary" onClick={onRetry}>Thử lại</button>}
      />
    )}
    {load === "populated" && <ProjectGrid cards={cards} onOpen={onOpen} onDelete={onDelete} onReveal={onReveal} />}
  </div>
);
