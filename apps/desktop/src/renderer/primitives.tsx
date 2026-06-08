import React from "react";
import type { AiAccountState, FriendlyStatus, GatewayState, ProjectCardVM } from "../shared/types.js";
import { FRIENDLY_LABELS } from "../shared/friendly-status.js";
import { Icon } from "./icons.js";

/**
 * Shared UI primitives (the app's small design-system layer): status helpers,
 * page header, status pill, project grid, empty state, spinner, and settings
 * field/toggle/card. Screen components compose these so layout values + look
 * stay consistent and inline-style sprawl is contained here.
 */

/** Navigation screens. */
export type Screen = "home" | "projects" | "settings" | "workspace";

export function aiStatus(gateway: GatewayState, account: AiAccountState): { color: string; text: string; sub?: string } {
  if (gateway.kind === "starting") return { color: "var(--muted-foreground)", text: "Đang khởi động AI…" };
  if (gateway.kind === "unavailable") return { color: "var(--danger)", text: "AI chưa khởi động được" };
  if (account.kind !== "connected" || account.accounts.length === 0)
    return { color: "var(--warn)", text: "Chưa kết nối AI" };
  return {
    color: "var(--good)",
    text: account.accounts[0]?.label ?? "Đã kết nối",
    sub: account.selectedModel?.id,
  };
}

export const STATUS_COLOR: Record<FriendlyStatus, string> = {
  building: "var(--warn)",
  "draft-ready": "var(--brand)",
  done: "var(--good)",
  error: "var(--danger)",
};

export const PageHeader: React.FC<{ title: string; subtitle?: string; action?: React.ReactNode }> = ({ title, subtitle, action }) => (
  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 }}>
    <div>
      <h1 style={{ margin: 0, fontSize: 24 }}>{title}</h1>
      {subtitle && <p style={{ margin: "6px 0 0", color: "var(--muted-foreground)", fontSize: 14 }}>{subtitle}</p>}
    </div>
    {action}
  </div>
);

export const StatusPill: React.FC<{ status: FriendlyStatus }> = ({ status }) => (
  <span className="ns-pill" style={{ alignSelf: "flex-start", background: "color-mix(in srgb, transparent 84%, " + STATUS_COLOR[status] + ")", color: STATUS_COLOR[status] }}>
    <span style={{ width: 6, height: 6, borderRadius: 999, background: STATUS_COLOR[status], flexShrink: 0 }} />
    {FRIENDLY_LABELS[status]}
  </span>
);

export const ProjectGrid: React.FC<{
  cards: ProjectCardVM[];
  onOpen: (id: string) => void;
  onDelete?: (id: string) => void;
  onReveal?: (id: string) => void;
}> = ({ cards, onOpen, onDelete, onReveal }) => (
  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 16 }}>
    {cards.map((c) => (
      <div key={c.projectId} className="ns-card ns-project" role="button" tabIndex={0} onClick={() => onOpen(c.projectId)}
        onKeyDown={(e) => { if (e.key === "Enter") onOpen(c.projectId); }}>
        <div style={{ height: 140, background: c.thumbnailPath ? `center/cover #14161b url(${c.thumbnailPath})` : "linear-gradient(135deg, #1a1d24, #14161b)", display: "grid", placeItems: "center", color: "#3a3f49" }}>
          {!c.thumbnailPath && Icon.film({ size: 30 })}
        </div>
        <div style={{ padding: 14 }}>
          <strong className="ns-project-title" title={c.title} style={{ marginBottom: 10, fontSize: 14 }}>{c.title}</strong>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <StatusPill status={c.status} />
            <span style={{ color: "var(--muted-foreground)", fontSize: 12 }}>{c.createdAtLabel}</span>
          </div>
          {(onReveal || onDelete) && (
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              {onReveal && (
                <button className="ns-btn" title="Mở thư mục dự án" style={{ padding: "6px 10px" }}
                  onClick={(e) => { e.stopPropagation(); onReveal(c.projectId); }}>{Icon.folder({ size: 15 })}</button>
              )}
              {onDelete && (
                <button className="ns-btn" title="Xoá dự án" style={{ padding: "6px 10px", color: "var(--danger)" }}
                  onClick={(e) => { e.stopPropagation(); onDelete(c.projectId); }}>{Icon.trash({ size: 15 })}</button>
              )}
            </div>
          )}
        </div>
      </div>
    ))}
  </div>
);

export const EmptyState: React.FC<{ icon: React.ReactNode; title: string; hint: string; action?: React.ReactNode }> = ({ icon, title, hint, action }) => (
  <div className="ns-card" style={{ padding: 48, textAlign: "center", display: "grid", placeItems: "center", gap: 8 }}>
    <div style={{ color: "var(--muted-foreground)" }}>{icon}</div>
    <h3 style={{ margin: 0 }}>{title}</h3>
    <p style={{ margin: 0, color: "var(--muted-foreground)", maxWidth: 360 }}>{hint}</p>
    {action && <div style={{ marginTop: 8 }}>{action}</div>}
  </div>
);

export const Spinner: React.FC = () => (
  <span style={{ display: "inline-block", width: 16, height: 16, border: "2px solid var(--muted)", borderTopColor: "var(--brand)", borderRadius: 999, animation: "ns-spin 0.8s linear infinite" }} />
);

/** A labelled settings field: bold label, control, optional helper text. */
export const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <div style={{ marginBottom: 20 }}>
    <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 7 }}>{label}</label>
    {children}
    {hint && <p style={{ margin: "7px 0 0", fontSize: 12, color: "var(--muted-foreground)", lineHeight: 1.5 }}>{hint}</p>}
  </div>
);

/** Enterprise-style toggle row: title + description on the left, switch on the right. */
export const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; title: string; desc?: string }> = ({ checked, onChange, title, desc }) => (
  <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "14px 0", borderTop: "1px solid var(--border)", cursor: "pointer" }}>
    <span style={{ minWidth: 0 }}>
      <span style={{ display: "block", fontSize: 14, fontWeight: 600 }}>{title}</span>
      {desc && <span style={{ display: "block", fontSize: 12, color: "var(--muted-foreground)", marginTop: 3, lineHeight: 1.5 }}>{desc}</span>}
    </span>
    <span className="ns-switch" style={{ flexShrink: 0 }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="ns-switch-track" />
    </span>
  </label>
);

export const SettingsCard: React.FC<{ title: string; desc?: string; children: React.ReactNode }> = ({ title, desc, children }) => (
  <section className="ns-card" style={{ padding: 24 }}>
    <div style={{ marginBottom: 20 }}>
      <h3 style={{ margin: 0, fontSize: 16 }}>{title}</h3>
      {desc && <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--muted-foreground)" }}>{desc}</p>}
    </div>
    {children}
  </section>
);
