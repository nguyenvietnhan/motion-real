import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ProjectDiagnosticsVM } from "../../shared/types.js";
import { compactNotificationMessage, errorDetails, useNotifications } from "../notifications.js";
import { placeDiagPanel, type DiagPanelPlacement } from "./diag-panel-placement.js";

/**
 * Bounded, historical project diagnostic popover.
 * Shows fixed-language entries only — never raw logs.
 *
 * Uses position:fixed + viewport clamping. Absolute placement inside the
 * storyboard header was clipped by overflow ancestors (main / story-shell),
 * which cut off the list text and left only empty divider lines.
 */
export const ProjectDiagnosticsPanel: React.FC<{
  projectId: string;
  load: (projectId: string) => Promise<ProjectDiagnosticsVM>;
}> = ({ projectId, load }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<ProjectDiagnosticsVM | null>(null);
  const [placement, setPlacement] = useState<DiagPanelPlacement | null>(null);
  const notify = useNotifications();

  const updatePlacement = useCallback((): void => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    setPlacement(
      placeDiagPanel(rect, {
        width: window.innerWidth,
        height: window.innerHeight,
      }),
    );
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }
    updatePlacement();
  }, [open, updatePlacement, report?.entries.length]);

  useEffect(() => {
    if (!open) return;
    const onReposition = (): void => updatePlacement();
    window.addEventListener("resize", onReposition);
    // Capture scroll from any overflow ancestor (main, story-shell, …).
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, updatePlacement]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const refresh = (): void => {
    setLoading(true);
    void load(projectId)
      .then((next) => setReport(next))
      .catch((error: unknown) => {
        const details = errorDetails(error);
        notify.error({
          title: "Không tải được chi tiết xử lý",
          message: compactNotificationMessage(details, "Thử lại sau."),
          details,
        });
      })
      .finally(() => setLoading(false));
  };

  const copySummary = (): void => {
    if (!report) return;
    const lines = report.entries.map((e) => {
      const when = e.at ? new Date(e.at).toLocaleString() : "";
      const scene = e.sceneId ? ` (${e.sceneId})` : "";
      return `${when} — ${e.message}${scene}`;
    });
    const text = [
      `Chi tiết xử lý · ${report.projectId}`,
      report.truncated ? "(đã rút gọn)" : "",
      ...lines,
    ]
      .filter(Boolean)
      .join("\n");
    void navigator.clipboard?.writeText(text).catch(() => {
      notify.error({ title: "Không sao chép được", message: "Clipboard không khả dụng." });
    });
  };

  return (
    <div className="ns-diag" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="ns-btn ns-diag-trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Chi tiết xử lý dự án"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) refresh();
        }}
      >
        <span className="ns-diag-label-full">{open ? "Ẩn chi tiết" : "Chi tiết xử lý"}</span>
        <span className="ns-diag-label-short">{open ? "Ẩn" : "Chi tiết"}</span>
      </button>
      {open && placement && (
        <div
          className="ns-diag-panel ns-card"
          role="dialog"
          aria-label="Chi tiết xử lý dự án"
          style={{
            top: placement.top,
            left: placement.left,
            width: placement.width,
            maxHeight: placement.maxHeight,
          }}
        >
          <div className="ns-diag-toolbar">
            <button type="button" className="ns-btn" disabled={loading} onClick={refresh}>
              {loading ? "Đang tải…" : "Làm mới"}
            </button>
            <button
              type="button"
              className="ns-btn"
              disabled={!report || report.entries.length === 0}
              onClick={copySummary}
            >
              Sao chép tóm tắt
            </button>
            {report?.truncated && <span className="ns-diag-truncated">Đã rút gọn lịch sử</span>}
          </div>
          {!report && !loading && <p className="ns-diag-empty">Chưa có dữ liệu.</p>}
          {report && report.entries.length === 0 && (
            <p className="ns-diag-empty">Chưa ghi nhận bước xử lý nào.</p>
          )}
          {report && report.entries.length > 0 && (
            <ul className="ns-diag-list">
              {report.entries.map((e, i) => (
                <li key={`${e.at}-${i}`} className="ns-diag-item">
                  <div className="ns-diag-meta">
                    {new Date(e.at).toLocaleString()}
                    {e.sceneId ? ` · ${e.sceneId}` : ""}
                  </div>
                  <div className="ns-diag-message">{e.message}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
