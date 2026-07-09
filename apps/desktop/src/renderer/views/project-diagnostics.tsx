import React, { useState } from "react";
import type { ProjectDiagnosticsVM } from "../../shared/types.js";
import { compactNotificationMessage, errorDetails, useNotifications } from "../notifications.js";

/**
 * Bounded, historical project diagnostic drawer.
 * Shows fixed-language entries only — never raw logs.
 */
export const ProjectDiagnosticsPanel: React.FC<{
  projectId: string;
  load: (projectId: string) => Promise<ProjectDiagnosticsVM>;
}> = ({ projectId, load }) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<ProjectDiagnosticsVM | null>(null);
  const notify = useNotifications();

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
    <div className="ns-diag" style={{ marginTop: 12 }}>
      <button
        type="button"
        className="ns-btn"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) refresh();
        }}
      >
        {open ? "Ẩn chi tiết xử lý" : "Chi tiết xử lý"}
      </button>
      {open && (
        <div
          className="ns-card"
          style={{ marginTop: 10, padding: 12, maxHeight: 280, overflow: "auto" }}
          role="region"
          aria-label="Chi tiết xử lý dự án"
        >
          <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
            <button type="button" className="ns-btn" disabled={loading} onClick={refresh}>
              {loading ? "Đang tải…" : "Làm mới"}
            </button>
            <button type="button" className="ns-btn" disabled={!report || report.entries.length === 0} onClick={copySummary}>
              Sao chép tóm tắt
            </button>
            {report?.truncated && (
              <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>Đã rút gọn lịch sử</span>
            )}
          </div>
          {!report && !loading && <p style={{ margin: 0, color: "var(--muted-foreground)" }}>Chưa có dữ liệu.</p>}
          {report && report.entries.length === 0 && (
            <p style={{ margin: 0, color: "var(--muted-foreground)" }}>Chưa ghi nhận bước xử lý nào.</p>
          )}
          {report && report.entries.length > 0 && (
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
              {report.entries.map((e, i) => (
                <li key={`${e.at}-${i}`} style={{ borderBottom: "1px solid var(--border)", paddingBottom: 6 }}>
                  <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
                    {new Date(e.at).toLocaleString()}
                    {e.sceneId ? ` · ${e.sceneId}` : ""}
                  </div>
                  <div style={{ fontSize: 14 }}>{e.message}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
