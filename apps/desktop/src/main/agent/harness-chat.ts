import type {
  AgentChatEvent,
  AgentChatMessageVM,
  AgentChatPageVM,
  AgentToolActivityVM,
} from "../../shared/types.js";

const MAX_MESSAGE_CHARS = 50_000;
const MAX_DESCRIPTION_CHARS = 160;

type RecordValue = Record<string, unknown>;

export function projectHarnessHistory(value: unknown): AgentChatPageVM {
  if (!isRecord(value) || !Array.isArray(value.events) || typeof value.hasMore !== "boolean") {
    throw new Error("Harness trả history không hợp lệ.");
  }

  const items: Array<AgentChatMessageVM | AgentToolActivityVM> = [];
  const tools = new Map<string, AgentToolActivityVM>();
  let running = false;
  let beforeSeq: number | undefined;

  for (const entry of value.events) {
    if (!isRecord(entry) || !isRecord(entry.event)) continue;
    const event = entry.event;
    const seq = safeInteger(event.seq);
    const time = safeInteger(event.time);
    const type = typeof event.type === "string" ? event.type : "";
    const data = isRecord(event.data) ? event.data : {};
    if (seq !== undefined) beforeSeq = beforeSeq === undefined ? seq : Math.min(beforeSeq, seq);

    if (type === "turn/start") running = true;
    if (type === "turn/end") running = false;

    if (type === "user/message" && seq !== undefined && time !== undefined) {
      const source = isRecord(data.source) ? data.source : {};
      // Context injections, AGENTS.md and tool results are model-visible but
      // are not human chat messages. Showing only source.kind=user prevents
      // the old system-prompt-as-user bug in the native timeline.
      if (source.kind !== "user") continue;
      const text = visibleText(data.content);
      const id = typeof data.id === "string" ? data.id : `user-${seq}`;
      if (text) items.push({ kind: "message", id, seq, time, role: "user", text });
      continue;
    }

    if (type === "assistant/message" && seq !== undefined && time !== undefined) {
      const message = isRecord(data.message) ? data.message : {};
      const text = visibleText(message.content);
      const id = typeof message.id === "string" ? message.id : `assistant-${seq}`;
      if (text) {
        items.push({
          kind: "message",
          id,
          seq,
          time,
          role: "assistant",
          text,
          ...(data.interrupted === true ? { interrupted: true } : {}),
        });
      }
      continue;
    }

    if (type === "tool/call" && seq !== undefined) {
      const callId = typeof data.callId === "string" ? data.callId : undefined;
      if (!callId) continue;
      const name = safeToolName(data.name);
      const tool: AgentToolActivityVM = {
        kind: "tool",
        id: callId,
        seq,
        name,
        description: toolDescription(name, data.arguments),
        state: "running",
      };
      tools.set(callId, tool);
      items.push(tool);
      continue;
    }

    if (type === "tool/result") {
      const result = toolResult(data);
      if (!result) continue;
      const tool = tools.get(result.callId);
      if (tool) tool.state = result.isError ? "error" : "success";
    }
  }

  return {
    items: items.sort((a, b) => a.seq - b.seq),
    hasMore: value.hasMore,
    ...(beforeSeq !== undefined ? { beforeSeq } : {}),
    running,
  };
}

/** Convert one Harness mux envelope into the only live event shapes the UI accepts. */
export function projectHarnessMuxEnvelope(
  value: unknown,
  draftIdForSession: (sessionId: string) => string | undefined,
): AgentChatEvent | undefined {
  if (!isRecord(value) || !isRecord(value.payload)) return undefined;
  const frame = value.payload;
  if (frame.type === "stream/error") return undefined;
  if (frame.type !== "session/event" || typeof frame.sessionId !== "string" || !isRecord(frame.event)) return undefined;
  const draftId = draftIdForSession(frame.sessionId);
  if (!draftId) return undefined;
  const event = frame.event;
  const type = typeof event.type === "string" ? event.type : "";
  const data = isRecord(event.data) ? event.data : {};

  if (type === "assistant/chunk") {
    const chunk = isRecord(data.chunk) ? data.chunk : {};
    if (chunk.type === "text-delta" && typeof chunk.text === "string" && chunk.text) {
      return { draftId, type: "assistant-delta", text: chunk.text.slice(0, 8_000) };
    }
    if (chunk.type === "reasoning-delta" || (chunk.type === "block-start" && chunk.blockType === "reasoning")) {
      return { draftId, type: "activity" };
    }
    return undefined;
  }

  if (type === "turn/start" || type === "step/start") return { draftId, type: "activity" };
  if (type === "turn/end") {
    const reason = isRecord(data.reason) ? data.reason : {};
    return reason.kind === "error"
      ? { draftId, type: "error", code: "turn_failed" }
      : { draftId, type: "idle" };
  }
  if (type === "user/message" || type === "assistant/message" || type === "tool/call" || type === "tool/result") {
    return { draftId, type: "changed" };
  }
  return undefined;
}

function visibleText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value.flatMap((block) => isRecord(block) && block.type === "text" && typeof block.text === "string"
    ? [block.text]
    : []).join("\n").trim().slice(0, MAX_MESSAGE_CHARS);
}

function toolResult(data: RecordValue): { callId: string; isError: boolean } | undefined {
  const message = isRecord(data.message) ? data.message : {};
  if (!Array.isArray(message.content)) return undefined;
  const block = message.content.find((item) => isRecord(item) && item.type === "tool-result");
  if (!isRecord(block) || typeof block.toolCallId !== "string") return undefined;
  return { callId: block.toolCallId, isError: block.isError === true || isRecord(data.error) };
}

function toolDescription(name: string, rawArguments: unknown): string {
  if (typeof rawArguments === "string") {
    try {
      const args = JSON.parse(rawArguments) as unknown;
      if (isRecord(args) && typeof args.description === "string") {
        const description = oneLine(args.description);
        if (description) return description;
      }
    } catch (_error) {
      // Malformed tool arguments remain visible to Harness, but never cross IPC.
    }
  }
  const lower = name.toLowerCase();
  if (lower.includes("search") || lower.includes("glob")) return "Đang tìm kiếm";
  if (lower.includes("read")) return "Đang đọc dữ liệu";
  if (lower.includes("write") || lower.includes("edit")) return "Đang cập nhật tệp";
  if (lower.includes("pwsh") || lower.includes("bash") || lower.includes("terminal")) return "Đang chạy lệnh";
  return "Đang dùng công cụ";
}

function safeToolName(value: unknown): string {
  const name = typeof value === "string" ? oneLine(value).slice(0, 80) : "Tool";
  return name || "Tool";
}

function oneLine(value: string): string {
  return value
    .replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\s"']+/g, "[tệp local]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_DESCRIPTION_CHARS);
}

function safeInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) ? Number(value) : undefined;
}

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
