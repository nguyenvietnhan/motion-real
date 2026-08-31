import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

type ReviewEvent = { seq: number; type: string; data: Record<string, unknown> };
type ReadPage = (beforeSeq?: number) => Promise<unknown>;

export class HarnessImageReadEvidenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HarnessImageReadEvidenceError";
  }
}

/** Native session.history is paged by messages, not event count. Keep raw data in Main only. */
export async function readHarnessReviewHistory(readPage: ReadPage, afterSeq?: number): Promise<{
  events: ReviewEvent[]; lastSeq: number;
}> {
  const events: ReviewEvent[] = [];
  let beforeSeq: number | undefined;
  let lastSeq = -1;
  for (;;) {
    const page = await readPage(beforeSeq);
    if (!record(page) || !Array.isArray(page.events) || typeof page.hasMore !== "boolean") {
      throw new Error("Không đọc được bằng chứng ảnh từ session.history.");
    }
    let firstSeq = beforeSeq ?? Infinity;
    for (const entry of page.events) {
      const event = record(entry) ? entry.event : undefined;
      if (!record(event) || !Number.isSafeInteger(event.seq) || Number(event.seq) < 0
        || typeof event.type !== "string" || !record(event.data)
        || (beforeSeq !== undefined && Number(event.seq) >= beforeSeq)) {
        throw new Error("session.history có event/cursor không hợp lệ.");
      }
      const seq = Number(event.seq);
      firstSeq = Math.min(firstSeq, seq);
      lastSeq = Math.max(lastSeq, seq);
      if (seq > (afterSeq ?? -1) && ["tool/call", "tool/result", "assistant/message"].includes(event.type)) {
        events.push({ seq, type: event.type, data: event.data });
      }
    }
    // No cutoff means one tail page only, to capture the pre-request sequence.
    if (afterSeq === undefined || !page.hasMore || firstSeq <= afterSeq) break;
    if (!Number.isFinite(firstSeq) || firstSeq === beforeSeq) throw new Error("session.history không tiến qua trang cũ.");
    beforeSeq = firstSeq;
  }
  return { events: events.sort((a, b) => a.seq - b.seq), lastSeq };
}

/** Execution/attachment evidence, not proof of visual comprehension or motion quality. */
export async function assertHarnessImageReads(input: {
  root: string; stills: unknown; maxStills: number; afterSeq: unknown; events: readonly ReviewEvent[];
}): Promise<void> {
  if (!Number.isSafeInteger(input.afterSeq) || Number(input.afterSeq) < -1) {
    throw new Error("Lượt review cũ thiếu mốc đọc ảnh; cần request review mới.");
  }
  if (!Number.isSafeInteger(input.maxStills) || input.maxStills < 1) {
    throw new Error("Giới hạn still của lượt review không hợp lệ.");
  }
  if (!Array.isArray(input.stills) || input.stills.length === 0
    || input.stills.some((path) => typeof path !== "string") || new Set(input.stills).size !== input.stills.length) {
    throw new Error("Lượt review thiếu danh sách still riêng cho mọi cảnh.");
  }
  if (input.stills.length > input.maxStills) {
    throw new Error(`Lượt review có ${input.stills.length} still, vượt phạm vi tối đa ${input.maxStills}.`);
  }
  const expected = await Promise.all((input.stills as string[]).map(async (path) => {
    const rel = relative(input.root, resolve(input.root, path));
    if (isAbsolute(path) || !rel || rel.startsWith("..") || isAbsolute(rel) || !path.startsWith("project/")) {
      throw new Error("Đường dẫn still review không hợp lệ.");
    }
    return realpath(resolve(input.root, path));
  }));
  const events = input.events.filter((event) => event.seq > Number(input.afterSeq));
  // Reads and submission in the same model step do not prove the model received the image.
  const lastAssistantSeq = events.filter((event) => event.type === "assistant/message"
    && event.data.interrupted !== true).at(-1)?.seq ?? -1;
  const calls = new Map<string, { seq: number; path: string }>();
  const seen = new Set<string>();
  for (const event of events) {
    if (event.seq >= lastAssistantSeq) break;
    const data = event.data;
    if (event.type === "tool/call" && data.name === "read_image" && typeof data.callId === "string") {
      let args: unknown;
      // Malformed arguments cannot prove which image was read; reject that evidence.
      try { args = JSON.parse(String(data.arguments)); } catch (_error) { continue; }
      if (record(args) && typeof args.file_path === "string") calls.set(data.callId, { seq: event.seq, path: args.file_path });
    }
    if (event.type !== "tool/result" || data.error !== undefined || !record(data.message)
      || !Array.isArray(data.message.content)) continue;
    for (const block of data.message.content) {
      if (!record(block) || block.type !== "tool-result" || block.isError === true
        || typeof block.toolCallId !== "string" || !Array.isArray(block.content)) continue;
      const call = calls.get(block.toolCallId);
      if (!call || call.seq >= event.seq || !block.content.some(isImageAttachment)) continue;
      // Native args may use the project junction, its resolved path, or a relative path.
      const path = await realpath(resolve(input.root, call.path)).catch((_error) => undefined);
      if (path && expected.includes(path)) seen.add(path);
    }
  }
  const missing = (input.stills as string[]).filter((_path, index) => !seen.has(expected[index]!));
  if (missing.length) {
    throw new HarnessImageReadEvidenceError(`Chưa có read_image thành công trước lượt nhận xét cho: ${missing.join(", ")}. Mở các PNG này bằng read_image rồi submit lại ở lượt model tiếp theo.`);
  }
}

function isImageAttachment(value: unknown): boolean {
  if (!record(value) || value.type !== "image" || !record(value.attachment)) return false;
  const image = value.attachment;
  return typeof image.attachmentId === "string" && image.attachmentId.length > 0
    && ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(String(image.mediaType))
    && [image.bytes, image.width, image.height].every((number) => Number.isSafeInteger(number) && Number(number) > 0);
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
