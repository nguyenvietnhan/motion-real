import React, { useState } from "react";
import type { ProjectCardVM } from "../../shared/types.js";
import { validateCreateInput } from "../../shared/create-validation.js";
import { Icon } from "../icons.js";
import { EmptyState, PageHeader, ProjectGrid } from "../primitives.js";

/** Home: create hero (chat-style brief) + recent-projects grid. */
export const HomeView: React.FC<{
  aiReady: boolean;
  load: "loading" | "empty" | "populated";
  cards: ProjectCardVM[];
  onCreate: (raw: string) => void;
  onOpen: (projectId: string) => void;
  onConnectPrompt: () => void;
  onDelete?: (id: string) => void;
  onReveal?: (id: string) => void;
  createError?: string;
}> = ({ aiReady, load, cards, onCreate, onOpen, onConnectPrompt, onDelete, onReveal, createError }) => {
  const [raw, setRaw] = useState("");
  const valid = validateCreateInput({ raw });
  const inputValid = valid.ok;
  const recent = cards.slice(0, 8);
  const reason =
    raw.trim() === ""
      ? ""
      : valid.ok
        ? ""
        : valid.reason === "too-long"
          ? "Nội dung quá dài (tối đa 20.000 ký tự)."
          : "Nội dung chưa hợp lệ.";

  return (
    <div className="ns-content">
      <PageHeader title="Trang chủ" subtitle="Mô tả video bạn muốn — như đang nhắn tin. Dán kèm link nếu có, hệ thống tự đọc." />

      {!aiReady && (
        <div className="ns-card" style={{ padding: 16, marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between", borderColor: "var(--brand)" }}>
          <span style={{ color: "var(--muted-foreground)" }}>Kết nối tài khoản AI để bắt đầu tạo video.</span>
          <button className="ns-btn ns-btn-primary" onClick={onConnectPrompt}>{Icon.spark({ size: 15 })} Kết nối AI</button>
        </div>
      )}

      {/* Create hero */}
      <div className="ns-card" style={{ padding: 24, marginBottom: 32, background: "linear-gradient(180deg, #17191f, var(--card))" }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>Tạo video mới</h2>
        <p style={{ margin: "0 0 14px", color: "var(--muted-foreground)", fontSize: 13 }}>
          Dán đường dẫn bài báo hoặc mô tả chủ đề bằng tiếng Việt. AI sẽ tự dựng kịch bản, hình ảnh và lời đọc.
        </p>
        <textarea
          aria-label="topic-input"
          className="ns-input"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="Ví dụ: “Làm video 1p30s, giọng nữ, từ link này https://vnexpress.net/… tập trung vào nguyên nhân” — hoặc chỉ một chủ đề."
          rows={3}
          style={{ width: "100%", resize: "vertical" }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14 }}>
          <button className="ns-btn ns-btn-primary" onClick={() => (aiReady ? onCreate(raw) : onConnectPrompt())} disabled={!inputValid}>
            {Icon.plus({ size: 16 })} Tạo bản nháp
          </button>
          {!aiReady && <span style={{ color: "var(--muted-foreground)", fontSize: 13 }}>Chưa sẵn sàng AI — bấm để mở Cài đặt.</span>}
          {aiReady && reason && <span style={{ color: "var(--warn)", fontSize: 13 }}>{reason}</span>}
        </div>
        {createError && <p style={{ color: "var(--danger)", fontSize: 13, margin: "10px 0 0" }}>{createError}</p>}
      </div>

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Video gần đây</h2>
        {cards.length > 0 && <span style={{ color: "var(--muted-foreground)", fontSize: 13 }}>{cards.length} dự án</span>}
      </div>

      {load === "loading" && <p style={{ color: "var(--muted-foreground)" }}>Đang tải…</p>}
      {load === "empty" && (
        <EmptyState
          icon={Icon.film({ size: 34 })}
          title="Chưa có video nào"
          hint="Tạo video đầu tiên bằng ô “Tạo video mới” ở trên — chỉ cần một chủ đề hoặc đường dẫn."
        />
      )}
      {load === "populated" && <ProjectGrid cards={recent} onOpen={onOpen} onDelete={onDelete} onReveal={onReveal} />}
    </div>
  );
};
