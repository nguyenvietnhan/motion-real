import React, { useState } from "react";
import type { LicenseState } from "../../shared/types.js";
import { Icon } from "../icons.js";

/** First-run license activation screen. */
export const LicenseView: React.FC<{
  state: LicenseState;
  onActivate: (key: string) => void;
}> = ({ state, onActivate }) => {
  const [key, setKey] = useState("");
  const msg: Record<string, { text: string; color: string }> = {
    unactivated: { text: "Nhập mã kích hoạt để bắt đầu dùng News Studio.", color: "var(--muted-foreground)" },
    activating: { text: "Đang kích hoạt…", color: "var(--muted-foreground)" },
    error: { text: "Mã không hợp lệ. Hãy kiểm tra lại và thử lại.", color: "var(--danger)" },
    lapsed: { text: "Giấy phép đã hết hiệu lực.", color: "var(--warn)" },
    active: { text: "Đã kích hoạt.", color: "var(--good)" },
  };
  const m = msg[state.kind] ?? msg.unactivated!;
  return (
    <div style={{ height: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div className="ns-card" style={{ padding: 32, width: 420, maxWidth: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <span className="ns-brand-dot" style={{ width: 32, height: 32 }}>{Icon.spark({ size: 18 })}</span>
          <h1 style={{ margin: 0, fontSize: 20 }}>News Studio</h1>
        </div>
        <p style={{ color: m.color, marginTop: 0 }}>{m.text}</p>
        <input
          aria-label="Mã kích hoạt"
          className="ns-input"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onActivate(key); }}
          placeholder="Mã kích hoạt"
          style={{ width: "100%", marginBottom: 12 }}
        />
        <button className="ns-btn ns-btn-primary" onClick={() => onActivate(key)} disabled={state.kind === "activating"} style={{ width: "100%", justifyContent: "center" }}>
          Kích hoạt
        </button>
        <p style={{ color: "var(--muted-foreground)", fontSize: 12, marginBottom: 0, marginTop: 14, textAlign: "center" }}>
          Bản dev: dùng mã <strong style={{ color: "var(--foreground)" }}>123</strong>.
        </p>
      </div>
    </div>
  );
};
