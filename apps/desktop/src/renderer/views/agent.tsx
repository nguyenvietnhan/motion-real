import React, { useEffect, useState } from "react";
import type { AgentMessageVM, AgentPreflightVM, AgentProposalVM, AgentSessionRequest, AgentSessionVM, ProjectCardVM } from "../../shared/types.js";
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
  const [activity, setActivity] = useState("Sẵn sàng");
  const [error, setError] = useState<string>();
  const refresh = async (): Promise<void> => {
    const [nextPreflight, nextSessions] = await Promise.all([dash.agent.preflight(), dash.agent.listSessions()]);
    setPreflight(nextPreflight);
    setSessions(nextSessions);
  };

  useEffect(() => {
    void refresh();
    const off = dash.events.onAgent((event) => {
      if (event.sessionId !== session?.id) return;
      if (event.message) setMessages((current) => [...current.filter((entry) => entry.id !== event.message!.id), event.message!]);
      if (event.kind === "error") setError(event.text);
      if (event.code === "starting") { setBusy(true); setActivity("Đang khởi động Agent…"); }
      if (event.code === "thinking") { setBusy(true); setActivity("Agent đang suy nghĩ…"); }
      if (event.code === "websearch") { setBusy(true); setActivity("Đang research web…"); }
      if (event.code === "proposal") setActivity("Đã tạo proposal");
      if (event.code === "ready" || event.code === "aborted" || event.kind === "error") setBusy(false);
      if (event.code === "ready") setActivity("Sẵn sàng");
      if (event.code === "aborted") setActivity("Đã dừng");
    });
    return off;
  }, [session?.id]);

  const open = async (request: AgentSessionRequest): Promise<void> => {
    setError(undefined);
    try {
      const next = await dash.agent.openSession(request);
      setSession(next);
      setMessages(await dash.agent.history(next.id));
      setProposal(await dash.agent.proposal(next.id));
      setActivity(next.compatibility === "legacy" ? "Phiên cũ chỉ xem hoặc xóa" : "Sẵn sàng");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Không thể mở phiên Agent."); }
  };
  const clear = async (): Promise<void> => {
    if (!session) return;
    await dash.agent.forgetSession(session.id);
    setSession(undefined); setMessages([]); setProposal(null); setText(""); setError(undefined); setBusy(false);
    await refresh();
  };
  const send = async (): Promise<void> => {
    if (!session || session.compatibility !== "current" || !text.trim() || busy) return;
    const input = text;
    setText(""); setError(undefined); setBusy(true);
    try {
      await dash.agent.prompt(session.id, input);
      setMessages(await dash.agent.history(session.id));
      setProposal(await dash.agent.proposal(session.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Lỗi Agent chưa áp dụng thay đổi.");
    } finally { setBusy(false); }
  };
  const applyEdit = async (): Promise<void> => {
    if (!session) return;
    try {
      const accepted = await dash.agent.applyEditProposal(session.id);
      if (accepted.kind === "edit") onOpenProject(accepted.projectId);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Không thể áp dụng đề xuất."); }
  };

  if (!preflight) return <div className="ns-page"><Spinner /></div>;
  const ready = preflight.state === "ready";
  return <div className="ns-page" style={{ maxWidth: 940 }}>
    <PageHeader title="Video Agent" subtitle="Developer Preview: research web và đề xuất; bạn luôn duyệt trước khi workflow video hiện có chạy." />
    <div className="ns-card" style={{ marginBottom: 16, borderColor: ready ? "var(--good)" : "var(--warn)" }}>
      <strong>{ready ? "Sẵn sàng" : "Đang khóa an toàn"}</strong>
      <p className="ns-page-subtitle" style={{ marginTop: 6 }}>{preflight.message}</p>
      <p className="ns-page-subtitle">Lịch sử Agent lưu cục bộ trong OpenCode, có thể gồm tin nhắn, kết quả tool và excerpt web search. Xóa lịch sử chỉ xóa Agent session, không xóa video/dự án.</p>
    </div>
    {!ready ? <>
      <EmptyState icon={Icon.spark({ size: 24 })} title="Agent chưa được bật" hint="Hãy hoàn tất runtime verifier và gateway loopback trước khi chat." />
      {sessions.filter((item) => item.compatibility === "legacy").map((item) => <div className="ns-card" key={item.id} style={{ marginTop: 12 }}><strong>{item.title}</strong><p className="ns-page-subtitle">Phiên cũ không tương thích — chỉ xem hoặc xóa khi runtime sẵn sàng.</p><button className="ns-btn" onClick={() => void open({ kind: "resume", sessionId: item.id })}>Mở phiên cũ</button></div>)}
    </> : <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        <button className="ns-btn ns-btn-primary" onClick={() => void open({ kind: "new-idea" })}>Ý tưởng mới</button>
        {cards.slice(0, 8).map((card) => <button key={card.projectId} className="ns-btn" onClick={() => void open({ kind: "project", projectId: card.projectId })}>{card.title}</button>)}
      </div>
      {sessions.length > 0 && <div className="ns-page-subtitle" style={{ margin: "-6px 0 16px" }}>Tiếp tục: {sessions.map((item) => <button key={item.id} className="ns-btn" style={{ marginLeft: 6 }} onClick={() => void open({ kind: "resume", sessionId: item.id })}>{item.title}{item.compatibility === "legacy" ? " · phiên cũ" : ""}</button>)}</div>}
      {session ? <section className="ns-card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><div><strong>{session.title}</strong>{session.compatibility === "legacy" && <p className="ns-page-subtitle" style={{ margin: "4px 0 0" }}>Phiên cũ không tương thích — chỉ xem hoặc xóa.</p>}</div><div style={{ display: "flex", alignItems: "center", gap: 8 }}><span className="ns-page-subtitle">{activity}</span><button className="ns-btn" onClick={() => void clear()}>Xóa lịch sử</button></div></div>
        <div style={{ minHeight: 190, maxHeight: 410, overflow: "auto", margin: "16px 0" }}>
          {messages.map((message) => <div key={message.id} style={{ margin: "0 0 12px", whiteSpace: "pre-wrap" }}><strong>{message.role === "user" ? "Bạn" : "Agent"}</strong><div>{message.text}</div></div>)}
        </div>
        {error && <p role="alert" style={{ color: "var(--danger)", margin: "0 0 12px" }}>{error}</p>}
        {proposal && <div className="ns-card" style={{ marginBottom: 12, padding: 14 }}><strong>Đề xuất: {proposal.title}</strong>{proposal.sourceUrls.length > 0 && <div className="ns-page-subtitle" style={{ margin: "8px 0" }}>Nguồn/ảnh URL — quyền sử dụng chưa xác minh:{proposal.sourceUrls.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer" style={{ display: "block" }}>{url}</a>)}</div>}<div style={{ display: "flex", gap: 8 }}>{proposal.kind === "create" ? <button className="ns-btn ns-btn-primary" onClick={() => onUseCreate(proposal)}>Dùng brief trong Create</button> : <button className="ns-btn ns-btn-primary" onClick={() => void applyEdit()}>Áp dụng sửa qua workflow cũ</button>}</div></div>}
        {session.compatibility === "current" && <><textarea className="ns-input" value={text} onChange={(event) => setText(event.target.value)} placeholder="Hỏi về ý tưởng video, research, hoặc đề xuất sửa cảnh…" rows={4} style={{ width: "100%" }} /><div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}><button className="ns-btn" disabled={!busy} onClick={() => void dash.agent.abort(session.id)}>Dừng</button><button className="ns-btn ns-btn-primary" disabled={busy || !text.trim()} onClick={() => void send()}>Gửi</button></div></>}
      </section> : <EmptyState icon={Icon.spark({ size: 24 })} title="Bắt đầu một cuộc trao đổi" hint="Chọn Ý tưởng mới hoặc một dự án ở phía trên." />}
    </>}
  </div>;
};
