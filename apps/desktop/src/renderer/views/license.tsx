import React, { useState } from "react";
import type { LicenseState } from "../../shared/types.js";
import logoUrl from "../logo.png";

/** First-run license activation screen. */
export const LicenseView: React.FC<{
  state: LicenseState;
  onActivate: (key: string) => void;
}> = ({ state, onActivate }) => {
  const [key, setKey] = useState("");
  const msg: Record<string, { text: string; color: string }> = {
    unactivated: { text: "Nhập mã kích hoạt của bạn để mở khóa Motion Real.", color: "var(--muted-foreground)" },
    activating: { text: "Đang kết nối hệ thống kích hoạt…", color: "var(--brand)" },
    error: { text: "Mã kích hoạt không chính xác. Vui lòng thử lại.", color: "var(--danger)" },
    lapsed: { text: "Giấy phép sử dụng đã hết hạn.", color: "var(--warn)" },
    active: { text: "Kích hoạt thành công!", color: "var(--good)" },
  };
  const m = msg[state.kind] ?? msg.unactivated!;
  return (
    <div style={{ height: "100vh", display: "grid", placeItems: "center", padding: 24, background: "var(--background)" }}>
      <div className="ns-card" style={{ padding: "40px 32px", width: 380, maxWidth: "100%", borderRadius: "12px", boxShadow: "var(--shadow-lg)", border: "1px solid var(--border)" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginBottom: 24, textAlign: "center" }}>
          <img src={logoUrl} alt="Motion Real Logo" style={{ height: "88px", width: "88px", objectFit: "contain", marginBottom: 4 }} />
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, letterSpacing: "-0.02em" }}>Motion Real</h1>
        </div>

        <p style={{ color: m.color, margin: "0 0 20px", fontSize: 13, fontWeight: 500, textAlign: "center", lineHeight: 1.4 }}>
          {m.text}
        </p>

        <input
          aria-label="Mã kích hoạt"
          className="ns-input"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onActivate(key); }}
          placeholder="Dán mã kích hoạt tại đây..."
          style={{ width: "100%", marginBottom: 16, height: "44px", textAlign: "center", fontSize: 14 }}
        />

        <button 
          className="ns-btn ns-btn-primary" 
          onClick={() => onActivate(key)} 
          disabled={state.kind === "activating"} 
          style={{ width: "100%", justifyContent: "center", height: "44px", fontSize: 14, fontWeight: 600 }}
        >
          {state.kind === "activating" ? "Đang kích hoạt..." : "Kích hoạt phần mềm"}
        </button>

        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 6, marginTop: 24, fontSize: 12, color: "var(--muted-foreground)" }}>
          <span>Mã thử nghiệm:</span>
          <span style={{ background: "rgba(255, 255, 255, 0.08)", color: "var(--foreground)", padding: "2px 8px", borderRadius: 4, fontWeight: 600 }}>123</span>
        </div>
      </div>
    </div>
  );
};
