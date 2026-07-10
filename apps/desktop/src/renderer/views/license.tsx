import React, { useState } from "react";
import type { LicenseState } from "../../shared/types.js";
import logoUrl from "../../../assets/brand/logo.png";

/** First-run license activation — compact card (logo, title, key, activate). */
export const LicenseView: React.FC<{
  state: LicenseState;
  onActivate: (key: string) => void;
}> = ({ state, onActivate }) => {
  const [key, setKey] = useState("");
  const busy = state.kind === "activating";

  const status =
    state.kind === "activating"
      ? { text: "Đang kích hoạt…", tone: "brand" as const }
      : state.kind === "error"
        ? { text: "Mã không đúng. Thử lại.", tone: "danger" as const }
        : state.kind === "lapsed"
          ? { text: "Giấy phép đã hết hạn.", tone: "warn" as const }
          : state.kind === "active"
            ? { text: "Đã kích hoạt.", tone: "good" as const }
            : null;

  const submit = (): void => {
    if (busy) return;
    onActivate(key);
  };

  return (
    <div className="ns-license">
      <div className="ns-card ns-license-card">
        <img className="ns-license-logo" src={logoUrl} alt="" width={88} height={88} />
        <h1 className="ns-license-title">Motion Real</h1>
        <p className="ns-license-sub">Xưởng video ngắn</p>

        {status && (
          <p className={`ns-license-status is-${status.tone}`} role="status">
            {status.text}
          </p>
        )}

        <input
          aria-label="Mã kích hoạt"
          className="ns-input ns-license-input"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="Mã kích hoạt"
          disabled={busy}
          autoComplete="off"
          spellCheck={false}
        />

        <button
          type="button"
          className="ns-btn ns-btn-primary ns-license-submit"
          onClick={submit}
          disabled={busy || !key.trim()}
        >
          {busy ? "Đang…" : "Kích hoạt"}
        </button>

        <button
          type="button"
          className="ns-license-dev"
          onClick={() => setKey("123")}
          disabled={busy}
          title="Điền mã thử nghiệm"
        >
          Thử · 123
        </button>
      </div>
    </div>
  );
};
