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
    <button
      type="button"
      className={`ns-nav${active === id ? " active" : ""}`}
      onClick={() => onNavigate(id)}
      title={label}
      aria-current={active === id ? "page" : undefined}
    >
      <span className="ns-nav-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="ns-nav-label">{label}</span>
    </button>
  );
  return (
    <aside className="ns-sidebar" aria-label="Điều hướng chính">
      <div className="ns-brand">
        <img className="ns-brand-logo" src={logoUrl} alt="" width={52} height={52} />
        <div className="ns-brand-copy">
          <div className="ns-brand-name">Motion Real</div>
          <div className="ns-brand-tag">Xưởng video ngắn</div>
        </div>
      </div>
      <nav className="ns-sidebar-nav" aria-label="Màn hình">
        {NavItem("home", "Trang chủ", Icon.home({}))}
        {NavItem("projects", "Dự án", Icon.film({}))}
        {NavItem("settings", "Cài đặt", Icon.settings({}))}
      </nav>
      <button
        type="button"
        className="ns-account"
        onClick={() => onNavigate("settings")}
        title="Trạng thái dịch vụ AI"
      >
        <span className="ns-account-avatar">
          {initial ? <span className="ns-avatar-initial">{initial}</span> : Icon.spark({ size: 15 })}
          <span className="ns-account-status" style={{ background: s.color }} />
        </span>
        <span className="ns-account-info">
          <span className="ns-account-name">{s.text}</span>
          {s.sub ? <span className="ns-account-sub">{s.sub}</span> : null}
        </span>
      </button>
    </aside>
  );
};
