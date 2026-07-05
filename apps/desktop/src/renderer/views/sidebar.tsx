import React from "react";
import type { AiAccountState, GatewayState } from "../../shared/types.js";
import { Icon } from "../icons.js";
import { activeAccount } from "../../shared/active-account.js";
import { aiStatus, type Screen } from "../primitives.js";
import logoUrl from "../../../assets/brand/taskbar-logo.png";

/** Left navigation rail + AI status card. */
export const Sidebar: React.FC<{
  active: Screen;
  gateway: GatewayState;
  account: AiAccountState;
  onNavigate: (s: Screen) => void;
}> = ({ active, gateway, account, onNavigate }) => {
  const s = aiStatus(gateway, account);
  // Mirror the settings account card: show the email's initial once connected
  // (the spark glyph only stands in while there's no account yet), so the two
  // avatars read as the same identity.
  const acct = activeAccount(account);
  const initial = acct?.label.trim().charAt(0).toUpperCase() || "";
  const NavItem = (id: Screen, label: string, icon: React.ReactNode) => (
    <button className={`ns-nav${active === id ? " active" : ""}`} onClick={() => onNavigate(id)}>
      {icon}
      {label}
    </button>
  );
  return (
    <aside className="ns-sidebar">
      <div className="ns-brand" style={{ display: "flex", alignItems: "center", gap: "12px", padding: "0 4px 10px" }}>
        <img src={logoUrl} alt="Motion Real Logo" style={{ height: "52px", width: "52px", objectFit: "contain" }} />
        <div>
          <div style={{ fontWeight: 700, fontSize: 17, letterSpacing: "-0.01em" }}>Motion Real</div>
          <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>Xưởng video ngắn</div>
        </div>
      </div>
      <nav>
        {NavItem("home", "Trang chủ", Icon.home({}))}
        {NavItem("projects", "Dự án", Icon.film({}))}
        {NavItem("settings", "Cài đặt", Icon.settings({}))}
      </nav>
      <button className="ns-account" onClick={() => onNavigate("settings")} title="Trạng thái dịch vụ AI">
        <span className="ns-account-avatar">
          {initial ? <span className="ns-avatar-initial">{initial}</span> : Icon.spark({ size: 15 })}
          <span className="ns-account-status" style={{ background: s.color }} />
        </span>
        <span className="ns-account-info">
          <span className="ns-account-name">{s.text}</span>
        </span>
      </button>
    </aside>
  );
};
