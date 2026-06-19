import React from "react";
import type { AiAccountState, FriendlyStatus, GatewayState, ProjectCardVM } from "../shared/types.js";
import { FRIENDLY_LABELS } from "../shared/friendly-status.js";
import { activeAccount } from "../shared/active-account.js";
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
    text: activeAccount(account)?.label ?? "Đã kết nối",
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
  /** Rename a project's display title (H2/R9.4). Absent ⇒ no rename affordance. */
  onRename?: (id: string, newTitle: string) => void;
}> = ({ cards, onOpen, onDelete, onReveal, onRename }) => (
  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(232px, 1fr))", gap: 16 }}>
    {cards.map((c) => (
      <div key={c.projectId} className="ns-card ns-project" role="button" tabIndex={0} onClick={() => onOpen(c.projectId)}
        onKeyDown={(e) => { if (e.key === "Enter") onOpen(c.projectId); }}>
        <div className="ns-project-thumb" style={c.thumbnailPath ? { backgroundImage: `url(${c.thumbnailPath})` } : undefined}>
          {!c.thumbnailPath && Icon.film({ size: 28 })}
          {(onReveal || onDelete || onRename) && (
            <div className="ns-project-actions">
              {onRename && (
                <button className="ns-project-action" title="Đổi tên dự án"
                  onClick={(e) => {
                    e.stopPropagation();
                    // UI tạm (D-UI): a native prompt is enough to retitle; the
                    // gallery re-reads the manifest on its next list poll.
                    const next = window.prompt("Đổi tên dự án", c.title)?.trim();
                    if (next && next.length > 0 && next !== c.title) onRename(c.projectId, next);
                  }}>{Icon.pencil({ size: 15 })}</button>
              )}
              {onReveal && (
                <button className="ns-project-action" title="Mở thư mục dự án"
                  onClick={(e) => { e.stopPropagation(); onReveal(c.projectId); }}>{Icon.folder({ size: 15 })}</button>
              )}
              {onDelete && (
                <button className="ns-project-action danger" title="Xoá dự án"
                  onClick={(e) => { e.stopPropagation(); onDelete(c.projectId); }}>{Icon.trash({ size: 15 })}</button>
              )}
            </div>
          )}
          <span className="ns-project-dot" style={{ background: STATUS_COLOR[c.status] }} title={FRIENDLY_LABELS[c.status]} aria-label={FRIENDLY_LABELS[c.status]} />
        </div>
        <div className="ns-project-body">
          <strong className="ns-project-title" title={c.title}>{c.title}</strong>
          {c.createdAtLabel && <span className="ns-project-date">{c.createdAtLabel}</span>}
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

/** An (i) glyph that reveals a short explanation on hover/focus — keeps setting
 * rows clean while the detail stays one pointer away. */
export const InfoHint: React.FC<{ text: string }> = ({ text }) => (
  <span className="ns-info" tabIndex={0} role="note" aria-label={text}>
    {Icon.info({ size: 13 })}
    <span className="ns-info-tip">{text}</span>
  </span>
);

/** A labelled settings field: bold label (with an optional (i) explanation), control. */
export const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <div style={{ marginBottom: 18 }}>
    <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
      <label style={{ fontSize: 13, fontWeight: 600 }}>{label}</label>
      {hint && <InfoHint text={hint} />}
    </div>
    {children}
  </div>
);

/** Enterprise-style toggle row: title (+ optional (i) explanation) left, switch
 * right. `indent` nests the row under a parent toggle (sub-setting); the title
 * then reads lighter so the parent stays the visual anchor. */
export const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; title: string; desc?: string; indent?: boolean }> = ({ checked, onChange, title, desc, indent }) => (
  <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: indent ? "6px 0" : "12px 0", paddingLeft: indent ? 16 : 0, minHeight: indent ? 40 : undefined, borderTop: indent ? "none" : "1px solid var(--border)", cursor: "pointer" }}>
    <span style={{ minWidth: 0, display: "flex", alignItems: "center" }}>
      <span style={{ fontSize: 14, fontWeight: indent ? 500 : 600, color: indent ? "var(--muted-foreground)" : "var(--foreground)" }}>{title}</span>
      {desc && <InfoHint text={desc} />}
    </span>
    <span className="ns-switch" style={{ flexShrink: 0 }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="ns-switch-track" />
    </span>
  </label>
);

/** A numeric setting laid out as a row (title + optional (i) left, compact
 * stepper right) so it sits in the same column rhythm as `Toggle` rows. The
 * field holds a DRAFT string while focused so you can clear it and type an
 * intermediate value (e.g. wipe "2" then type "5"); it clamps into [min, max]
 * and commits only on blur / Enter. `indent` nests it as a sub-setting (lighter
 * title, no divider, fixed row height so it lines up with an indented
 * `Toggle`), matching `Toggle`'s indent. */
export const NumberRow: React.FC<{ value: number; onChange: (v: number) => void; min: number; max: number; title: string; desc?: string; indent?: boolean }> = ({ value, onChange, min, max, title, desc, indent }) => {
  const [draft, setDraft] = React.useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = Number(draft);
    onChange(Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : value);
    setDraft(null);
  };
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "6px 0", paddingLeft: indent ? 16 : 0, minHeight: indent ? 40 : undefined, borderTop: indent ? "none" : "1px solid var(--border)" }}>
      <span style={{ minWidth: 0, display: "flex", alignItems: "center" }}>
        <span style={{ fontSize: 14, fontWeight: indent ? 500 : 600, color: indent ? "var(--muted-foreground)" : "var(--foreground)" }}>{title}</span>
        {desc && <InfoHint text={desc} />}
      </span>
      <input className="ns-input ns-num" type="number" min={min} max={max} value={draft ?? value} aria-label={title}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        style={{ flexShrink: 0, width: 56, padding: "8px 0", textAlign: "center" }} />
    </div>
  );
};

/**
 * A parent toggle that also OWNS a group of sub-settings: the switch on the
 * right flips the feature on/off, while clicking anywhere else on the row
 * expands/collapses the children (a chevron signals the affordance). The two
 * targets are deliberately split — `onChange` fires only from the switch, so a
 * user can peek at the sub-settings without flipping the feature, and flip the
 * feature without the row jumping. Children render only when `expanded`.
 */
export const ExpandableToggle: React.FC<{
  checked: boolean;
  onChange: (v: boolean) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  title: string;
  desc?: string;
  children?: React.ReactNode;
}> = ({ checked, onChange, expanded, onToggleExpanded, title, desc, children }) => {
  // With the feature off there are no sub-settings to reveal, so the row is a
  // plain header: no disclosure role, no click/keyboard handler, no pointer
  // cursor, and the chevron disappears (never spins on a dead target).
  const hasChildren = !!children;
  return (
  <div style={{ borderTop: "1px solid var(--border)" }}>
    <div
      role={hasChildren ? "button" : undefined}
      tabIndex={hasChildren ? 0 : undefined}
      aria-expanded={hasChildren ? expanded : undefined}
      onClick={hasChildren ? onToggleExpanded : undefined}
      onKeyDown={hasChildren ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggleExpanded(); } } : undefined}
      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "12px 0", cursor: hasChildren ? "pointer" : "default" }}
    >
      <span style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 6 }}>
        {hasChildren && (
          <span style={{ display: "inline-flex", color: "var(--muted-foreground)", transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.12s" }}>
            {Icon.chevronRight({ size: 16 })}
          </span>
        )}
        <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
        {desc && <InfoHint text={desc} />}
      </span>
      {/* The switch is its OWN click target. It must be a <label> (not a span)
          so a click on the visually-sized track actually toggles the 0-size
          checkbox inside — same trick the plain `Toggle` row relies on. The
          `stopPropagation` then keeps that click from also reaching the row's
          expand handler, so flipping the feature never toggles the disclosure. */}
      <label className="ns-switch" style={{ flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={checked} aria-label={title} onChange={(e) => onChange(e.target.checked)} />
        <span className="ns-switch-track" />
      </label>
    </div>
    {expanded && children && <div style={{ paddingBottom: 6 }}>{children}</div>}
  </div>
  );
};

/** A read-only info row (label left, value right, optional (i) note + mono
 * value) — the "Giới thiệu" tab's line item, matching the toggle/number rhythm. */
export const InfoRow: React.FC<{ label: string; value: string; hint?: string; mono?: boolean }> = ({ label, value, hint, mono }) => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "14px 0", borderTop: "1px solid var(--border)" }}>
    <span style={{ minWidth: 0, display: "flex", alignItems: "center" }}>
      <span style={{ fontSize: 14, fontWeight: 600 }}>{label}</span>
      {hint && <InfoHint text={hint} />}
    </span>
    <span style={{ flexShrink: 0, fontSize: 13, color: "var(--muted-foreground)", textAlign: "right", wordBreak: "break-all", ...(mono ? { fontFamily: "var(--font-mono, monospace)" } : {}) }}>{value}</span>
  </div>
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
