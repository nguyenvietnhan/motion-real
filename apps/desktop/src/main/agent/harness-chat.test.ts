import { describe, expect, it } from "vitest";
import { projectHarnessHistory, projectHarnessMuxEnvelope } from "./harness-chat.js";

function entry(seq: number, type: string, data: Record<string, unknown>) {
  return { event: { seq, time: 1_700_000_000_000 + seq, type, data } };
}

describe("Harness chat renderer-safe projection", () => {
  it("shows human/final text and tool lifecycle without context injection or reasoning", () => {
    const page = projectHarnessHistory({
      hasMore: true,
      events: [
        entry(1, "user/message", { id: "context", source: { kind: "context" }, content: [{ type: "text", text: "SECRET SYSTEM" }] }),
        entry(2, "user/message", { id: "u1", source: { kind: "user", rpcId: "rpc" }, content: [{ type: "text", text: "Tạo video Gemini" }] }),
        entry(3, "turn/start", { turn: 1 }),
        entry(4, "assistant/message", {
          turn: 1,
          step: 1,
          message: {
            id: "a1",
            content: [
              { type: "reasoning", text: "hidden chain" },
              { type: "text", text: "Tôi sẽ tìm tư liệu." },
              { type: "tool-call", id: "call-1", name: "Pwsh", arguments: "{}" },
            ],
          },
        }),
        entry(5, "tool/call", { callId: "call-1", name: "Write", arguments: JSON.stringify({ description: "Tải logo Gemini", file_path: "assets/gemini.png" }) }),
        entry(6, "tool/result", {
          message: { content: [{ type: "tool-result", toolCallId: "call-1", content: [{ type: "text", text: "raw output" }] }] },
        }),
        entry(7, "turn/end", { turn: 1, reason: { kind: "completed" } }),
      ],
    });

    expect(page).toEqual({
      hasMore: true,
      beforeSeq: 1,
      running: false,
      items: [
        expect.objectContaining({ kind: "message", id: "u1", role: "user", text: "Tạo video Gemini" }),
        expect.objectContaining({ kind: "message", id: "a1", role: "assistant", text: "Tôi sẽ tìm tư liệu." }),
        expect.objectContaining({ kind: "tool", id: "call-1", name: "Write", description: "Tải logo Gemini", target: "assets/gemini.png", state: "success" }),
      ],
    });
    expect(JSON.stringify(page)).not.toMatch(/SECRET SYSTEM|hidden chain|raw output/);
  });

  it("only projects relative non-traversing tool file targets", () => {
    const page = projectHarnessHistory({
      hasMore: false,
      events: [
        entry(1, "tool/call", { callId: "safe", name: "Read", arguments: JSON.stringify({ file_path: "notes/research.md" }) }),
        entry(2, "tool/call", { callId: "traversal", name: "Read", arguments: JSON.stringify({ file_path: "../secret.txt" }) }),
        entry(3, "tool/call", { callId: "absolute", name: "Read", arguments: JSON.stringify({ file_path: "C:\\secret.txt" }) }),
      ],
    });
    expect(page.items).toEqual([
      expect.objectContaining({ id: "safe", target: "notes/research.md" }),
      expect.not.objectContaining({ target: expect.anything() }),
      expect.not.objectContaining({ target: expect.anything() }),
    ]);
  });

  it("keeps an unmatched turn running and rejects malformed history", () => {
    expect(projectHarnessHistory({ hasMore: false, events: [entry(4, "turn/start", { turn: 2 })] })).toMatchObject({ running: true });
    expect(() => projectHarnessHistory({ events: [] })).toThrow(/history không hợp lệ/);
  });

  it("maps only safe mux events for known sessions", () => {
    const lookup = (sessionId: string) => sessionId === "session-1" ? "agent-1" : undefined;
    expect(projectHarnessMuxEnvelope({ payload: {
      type: "session/event",
      sessionId: "session-1",
      event: { type: "assistant/chunk", data: { chunk: { type: "text-delta", text: "Xin chào" } } },
    } }, lookup)).toEqual({ draftId: "agent-1", type: "assistant-delta", text: "Xin chào" });
    expect(projectHarnessMuxEnvelope({ payload: {
      type: "session/event",
      sessionId: "session-1",
      event: { type: "assistant/chunk", data: { chunk: { type: "reasoning-delta", text: "hidden" } } },
    } }, lookup)).toEqual({ draftId: "agent-1", type: "activity" });
    expect(projectHarnessMuxEnvelope({ payload: {
      type: "session/event",
      sessionId: "session-1",
      event: { type: "turn/end", data: { reason: { kind: "error", error: { message: "secret" } } } },
    } }, lookup)).toEqual({ draftId: "agent-1", type: "error", code: "turn_failed" });
    expect(projectHarnessMuxEnvelope({ payload: {
      type: "session/event",
      sessionId: "other",
      event: { type: "assistant/message", data: {} },
    } }, lookup)).toBeUndefined();
  });
});
