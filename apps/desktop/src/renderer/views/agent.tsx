import React, { useEffect, useState } from "react";
import type { AgentMessageVM, AgentPreflightVM, AgentProposalVM, AgentSessionVM, ProjectCardVM } from "../../shared/types.js";
import { EmptyState, PageHeader, Spinner } from "../primitives.js";
import { Icon } from "../icons.js";

export const AgentView: React.FC<{
  cards: ProjectCardVM[];
  onUseCreate: (proposal: Extract<AgentProposalVM, { kind: "create" }>) => void;
  onOpenProject: (id: string) => void;
}> = ({ cards, onUseCreate, onOpenProject }) => {
  const dash = window.dashboard;
  const [preflight, setPreflight] = useState<AgentPreflightVM>();
  const [sessions, setSessions] = useState<AgentSessionVM[]>([]);
  const [session, setSession] = useState<AgentSessionVM>();
  const [messages, setMessages] = useState<AgentMessageVM[]>([]);
  const [proposal, setProposal] = useState<AgentProposalVM | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const refresh = async (): Promise<void> => { setPreflight(await dash.agent.preflight()); setSessions(await dash.agent.listSessions()); };
  useEffect(() => { void refresh(); const off = dash.events.onAgent((event) => { if (event.sessionId !== session?.id) return; if (event.message) setMessages((current) => [...current.filter((entry) => entry.id !== event.message!.id), event.message!]); if (event.kind === "status") setBusy(!/dừng|hoàn thành/i.test(event.text)); }); return off; }, [session?.id]);
  const open = async (projectId?: string): Promise<void> => { const next = await dash.agent.openSession(projectId); setSession(next); setMessages(await dash.agent.history(next.id)); setProposal(await dash.agent.proposal(next.id)); };
  const send = async (): Promise<void> => { if (!session || !text.trim() || busy) return; const input = text; setText(""); setError(undefined); setBusy(true); try { await dash.agent.prompt(session.id, input); setMessages(await dash.agent.history(session.id)); setProposal(await dash.agent.proposal(session.id)); } catch (caught) { void caught; setError("Agent chưa gửi được yêu cầu. Không có thay đổi nào được áp dụng; hãy thử lại hoặc gửi ảnh trạng thái này."); } finally { setBusy(false); } };
  if (!preflight) return <div className="ns-page"><Spinner /></div>;
  return <div className="ns-page" style={{ maxWidth: 940 }}>
    <PageHeader title="Video Agent" subtitle="Developer Preview: nghiên cứu web và đề xuất; bạn luôn là người duyệt trước khi workflow video cũ chạy." />
    <div className="ns-card" style={{ marginBottom: 16, borderColor: preflight.state === "ready" ? "var(--good)" : "var(--warn)" }}>
      <strong>{preflight.state === "ready" ? "Sẵn sàng" : "Đang khóa an toàn"}</strong><p className="ns-page-subtitle" style={{ marginTop: 6 }}>{preflight.message}</p>
      <p className="ns-page-subtitle">Lịch sử Agent lưu cục bộ trong OpenCode, có thể gồm tin nhắn, kết quả tool và excerpt web search. Xóa lịch sử chỉ xóa Agent session, không xóa video/dự án.</p>
    </div>
    {preflight.state !== "ready" ? <EmptyState icon={Icon.spark({ size: 24 })} title="Agent chưa được bật" hint="Không khởi động sidecar cho đến khi gateway chỉ lắng nghe loopback." /> : <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        <button className="ns-btn ns-btn-primary" onClick={() => void open()}>Ý tưởng mới</button>
        {cards.slice(0, 8).map((card) => <button key={card.projectId} className="ns-btn" onClick={() => void open(card.projectId)}>{card.title}</button>)}
      </div>
      {sessions.length > 0 && <p className="ns-page-subtitle" style={{ margin: "-6px 0 16px" }}>Tiếp tục: {sessions.map((item) => <button key={item.id} className="ns-btn" style={{ marginLeft: 6 }} onClick={() => void open(item.projectId)}>{item.title}</button>)}</p>}
      {session ? <section className="ns-card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><strong>{session.title}</strong><span className="ns-page-subtitle">{busy ? "Đang xử lý…" : "Sẵn sàng"}</span></div>
        <div style={{ minHeight: 190, maxHeight: 410, overflow: "auto", margin: "16px 0" }}>
          {messages.map((message) => <div key={message.id} style={{ margin: "0 0 12px", whiteSpace: "pre-wrap" }}><strong>{message.role === "user" ? "Bạn" : "Agent"}</strong><div>{message.text}</div></div>)}
        </div>
        {error && <p role="alert" style={{ color: "var(--danger)", margin: "0 0 12px" }}>{error}</p>}
        {proposal && <div className="ns-card" style={{ marginBottom: 12, padding: 14 }}><strong>Đề xuất: {proposal.title}</strong>{proposal.sourceUrls.length > 0 && <div className="ns-page-subtitle" style={{ margin: "8px 0" }}>Nguồn/ảnh URL — quyền sử dụng chưa xác minh:{proposal.sourceUrls.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer" style={{ display: "block" }}>{url}</a>)}</div>}<div style={{ display: "flex", gap: 8 }}>{proposal.kind === "create" ? <button className="ns-btn ns-btn-primary" onClick={() => onUseCreate(proposal)}>Dùng brief trong Create</button> : <button className="ns-btn ns-btn-primary" onClick={() => void dash.agent.applyEditProposal(session.id).then((p) => { if (p.kind === "edit") onOpenProject(p.projectId); })}>Áp dụng sửa qua workflow cũ</button>}<button className="ns-btn" onClick={() => void dash.agent.forgetSession(session.id).then(() => { setSession(undefined); setMessages([]); setProposal(null); void refresh(); })}>Xóa lịch sử</button></div></div>}
        <textarea className="ns-input" value={text} onChange={(event) => setText(event.target.value)} placeholder="Hỏi về ý tưởng video, research, hoặc đề xuất sửa cảnh…" rows={4} style={{ width: "100%" }} />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}><button className="ns-btn" disabled={!busy} onClick={() => void dash.agent.abort(session.id)}>Dừng</button><button className="ns-btn ns-btn-primary" disabled={busy || !text.trim()} onClick={() => void send()}>Gửi</button></div>
      </section> : <EmptyState icon={Icon.spark({ size: 24 })} title="Bắt đầu một cuộc trao đổi" hint="Chọn Ý tưởng mới hoặc một dự án ở phía trên." />}
    </>}
  </div>;
};
