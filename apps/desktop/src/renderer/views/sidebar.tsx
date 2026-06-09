import React from "react";
import type { AiAccountState, GatewayState } from "../../shared/types.js";
import { Icon } from "../icons.js";
import { aiStatus, type Screen } from "../primitives.js";

/** Left navigation rail + AI status card. */
export const Sidebar: React.FC<{
  active: Screen;
  gateway: GatewayState;
  account: AiAccountState;
  onNavigate: (s: Screen) => void;
}> = ({ active, gateway, account, onNavigate }) => {
  const s = aiStatus(gateway, account);
  const NavItem = (id: Screen, label: string, icon: React.ReactNode) => (
    <button className={`ns-nav${active === id ? " active" : ""}`} onClick={() => onNavigate(id)}>
      {icon}
      {label}
    </button>
  );
  return (
    <aside className="ns-sidebar">
      <div className="ns-brand">
        <span className="ns-brand-dot">{Icon.spark({ size: 15 })}</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>News Studio</div>
          <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>Xưởng video tin tức</div>
        </div>
      </div>
      <nav>
        {NavItem("home", "Trang chủ", Icon.home({}))}
        {NavItem("projects", "Dự án", Icon.film({}))}
        {NavItem("settings", "Cài đặt", Icon.settings({}))}
      </nav>
      <button className="ns-statuscard" onClick={() => onNavigate("settings")} title="Trạng thái dịch vụ AI">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: s.color, flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: "var(--foreground)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.text}</span>
        </div>
        {s.sub && <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.sub}</div>}
      </button>
    </aside>
  );
};
