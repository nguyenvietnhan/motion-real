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
  <div className="ns-page-header">
    <div className="ns-page-header-copy">
      <h1 className="ns-page-title">{title}</h1>
      {subtitle && <p className="ns-page-subtitle">{subtitle}</p>}
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
  /** Rename a project's display title. Absent ⇒ no rename affordance. */
  onRename?: (id: string, newTitle: string) => void;
}> = ({ cards, onOpen, onDelete, onReveal, onRename }) => {
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [renameDraft, setRenameDraft] = React.useState("");

  const beginRename = (card: ProjectCardVM): void => {
    setEditingId(card.projectId);
    setRenameDraft(card.title);
  };
  const cancelRename = (): void => {
    setEditingId(null);
    setRenameDraft("");
  };
  const commitRename = (card: ProjectCardVM): void => {
    const next = renameDraft.trim();
    cancelRename();
    if (next && next !== card.title) onRename?.(card.projectId, next);
  };

  return (
    <div className="ns-project-grid">
      {cards.map((c) => {
        const editing = editingId === c.projectId;
        const statusLabel = FRIENDLY_LABELS[c.status];
        return (
          <article key={c.projectId} className="ns-card ns-project">
            <div className={`ns-project-thumb is-${c.format}`}>
              {c.thumbnailPath ? (
                <img className="ns-project-media" src={c.thumbnailPath} alt="" />
              ) : (
                <span className="ns-project-placeholder" aria-hidden="true">{Icon.film({ size: 28 })}</span>
              )}
              <span className="ns-project-dot" style={{ background: STATUS_COLOR[c.status] }} title={statusLabel} aria-hidden="true" />
            </div>
            <div className="ns-project-body">
              {editing ? (
                <input
                  className="ns-input ns-project-title-input"
                  value={renameDraft}
                  autoFocus
                  aria-label="Tên dự án"
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onBlur={() => commitRename(c)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") cancelRename();
                  }}
                />
              ) : (
                <strong className="ns-project-title" title={c.title}>{c.title}</strong>
              )}
              {c.createdAtLabel && <span className="ns-project-date">{c.createdAtLabel}</span>}
            </div>
            <button
              type="button"
              className="ns-project-open"
              onClick={() => { if (!editing) onOpen(c.projectId); }}
              aria-label={`Mở dự án ${c.title}. ${statusLabel}${c.createdAtLabel ? `. ${c.createdAtLabel}` : ""}`}
              disabled={editing}
            />
            {(onReveal || onDelete || onRename) && (
              <div className="ns-project-actions">
                {onRename && (
                  <button className="ns-project-action" title="Đổi tên dự án" aria-label={`Đổi tên dự án ${c.title}`}
                    onClick={() => beginRename(c)}>{Icon.pencil({ size: 15 })}</button>
                )}
                {onReveal && (
                  <button className="ns-project-action" title="Mở thư mục dự án" aria-label={`Mở thư mục dự án ${c.title}`}
                    onClick={() => onReveal(c.projectId)}>{Icon.folder({ size: 15 })}</button>
                )}
                {onDelete && (
                  <button className="ns-project-action danger" title="Xoá dự án" aria-label={`Xoá dự án ${c.title}`}
                    onClick={() => onDelete(c.projectId)}>{Icon.trash({ size: 15 })}</button>
                )}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
};

export const EmptyState: React.FC<{ icon: React.ReactNode; title: string; hint: string; action?: React.ReactNode }> = ({ icon, title, hint, action }) => (
  <div className="ns-card ns-empty-state">
    <div className="ns-empty-state-icon">{icon}</div>
    <h3 className="ns-empty-state-title">{title}</h3>
    <p className="ns-empty-state-hint">{hint}</p>
    {action && <div className="ns-empty-state-action">{action}</div>}
  </div>
);

export const Spinner: React.FC = () => (
  <span className="ns-spinner" />
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
    const n = Number(draft.trim());
    onChange(Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : min);
    setDraft(null);
  };
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "6px 0", paddingLeft: indent ? 16 : 0, minHeight: indent ? 40 : undefined, borderTop: indent ? "none" : "1px solid var(--border)" }}>
      <span style={{ minWidth: 0, display: "flex", alignItems: "center" }}>
        <span style={{ fontSize: 14, fontWeight: indent ? 500 : 600, color: indent ? "var(--muted-foreground)" : "var(--foreground)" }}>{title}</span>
        {desc && <InfoHint text={desc} />}
      </span>
      <input className="ns-input ns-num" type="text" inputMode="numeric" pattern="[0-9]*" value={draft ?? String(value)} aria-label={title}
        onChange={(e) => {
          const next = e.target.value;
          if (/^-?\d*$/.test(next)) setDraft(next);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setDraft(null);
        }}
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
  <section className="ns-card ns-settings-card">
    <div className="ns-settings-card-head">
      <h3 className="ns-settings-card-title">{title}</h3>
      {desc && <p className="ns-settings-card-desc">{desc}</p>}
    </div>
    {children}
  </section>
);
