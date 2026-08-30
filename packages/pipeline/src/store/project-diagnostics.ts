/**
 * Safe, bounded projection of events.ndjson for desktop diagnostics UI.
 * Never returns raw prompts, paths, hashes, stack traces, or free-form errors.
 */

import { open, readFile, stat } from "node:fs/promises";
import { assertSafeProjectId, projectPaths } from "./store.js";
import type { ProjectDiagnosticEntry, ProjectDiagnostics, ProjectEvent } from "../types.js";

const DEFAULT_ENTRY_CAP = 80;
const DEFAULT_BYTE_CAP = 256 * 1024;

const LIFECYCLE_MESSAGES: Record<string, string> = {
  "authored.admitted": "Đã nạp scene đã viết",
  "tts.done": "Đã tạo giọng đọc",
  "lock.written": "Đã khóa thời lượng video",
  "build.ok": "Kiểm tra build đạt",
  "scene.runtime_probe": "Đã kiểm tra runtime scene",
  "determinism.ok": "Kiểm tra tính xác định đạt",
  "render.cached": "Dùng bản render đã lưu",
  "render.done": "Đã render xong",
  "render.oracles": "Đã chạy kiểm tra render",
  "render.oracle_failed": "Cần sửa lỗi render trước khi hoàn tất",
  "project.done": "Dự án hoàn tất",
  "render.cancelled": "Đã hủy render",
  "project.scaffolded": "Đã tạo khung dự án",
};

const REPAIR_MESSAGES: Record<string, { kind: ProjectDiagnosticEntry["kind"]; state: ProjectDiagnosticEntry["state"]; message: string }> = {
  "repair.attempted": { kind: "repair", state: "info", message: "Đã thử chỉnh" },
  "repair.resolved": { kind: "repair", state: "resolved", message: "Đã áp dụng trong bản nháp hiện tại" },
  "repair.reverted": { kind: "repair", state: "reverted", message: "Đã hoàn nguyên bản nháp trước" },
  "repair.unresolved": { kind: "repair", state: "error", message: "Chưa áp dụng được chỉnh sửa" },
  "repair.cancelled": { kind: "repair", state: "warning", message: "Đã hủy trong lúc chỉnh" },
};

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function safeSceneId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const id = value.trim();
  if (!/^scene-\d{2}$/.test(id)) return undefined;
  return id;
}

function mapEvent(raw: ProjectEvent): ProjectDiagnosticEntry | undefined {
  if (!isIsoDate(raw.at) || typeof raw.type !== "string") return undefined;
  const type = raw.type;

  if (type === "error") {
    return { at: raw.at, kind: "error", state: "error", message: "Đã gặp lỗi xử lý" };
  }

  if (type === "authoring.failure") {
    const level = raw.level === "warning" ? "warning" : "error";
    return {
      at: raw.at,
      kind: "authoring",
      state: level,
      message: level === "warning" ? "Cảnh báo khi soạn nội dung" : "Lỗi khi soạn nội dung",
    };
  }

  const repair = REPAIR_MESSAGES[type];
  if (repair) {
    return {
      at: raw.at,
      kind: repair.kind,
      state: repair.state,
      message: repair.message,
      ...(safeSceneId(raw.sceneId) ? { sceneId: safeSceneId(raw.sceneId) } : {}),
    };
  }

  const lifecycle = LIFECYCLE_MESSAGES[type];
  if (lifecycle) {
    return { at: raw.at, kind: "lifecycle", state: "info", message: lifecycle };
  }

  return undefined;
}

async function readTailBytes(path: string, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  try {
    const size = (await stat(path)).size;
    if (size <= maxBytes) {
      return { text: await readFile(path, "utf8"), truncated: false };
    }
    const handle = await open(path, "r");
    try {
      const buf = Buffer.alloc(maxBytes);
      await handle.read(buf, 0, maxBytes, size - maxBytes);
      return { text: buf.toString("utf8"), truncated: true };
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { text: "", truncated: false };
    throw error;
  }
}

function parseLines(text: string, skipPartialFirst: boolean): ProjectEvent[] {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  const start = skipPartialFirst && lines.length > 0 ? 1 : 0;
  const out: ProjectEvent[] = [];
  for (let i = start; i < lines.length; i += 1) {
    try {
      const parsed = JSON.parse(lines[i]!) as ProjectEvent;
      if (parsed && typeof parsed === "object") out.push(parsed);
    } catch {
      // tolerate malformed lines
    }
  }
  return out;
}

export type ReadProjectDiagnosticsOptions = {
  limit?: number;
  maxBytes?: number;
};

/**
 * Tail and project a safe diagnostics list for one project.
 * Newest entries first. Never throws for missing/malformed event files.
 */
export async function readProjectDiagnostics(
  projectId: string,
  options: ReadProjectDiagnosticsOptions = {},
): Promise<ProjectDiagnostics> {
  assertSafeProjectId(projectId);
  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_ENTRY_CAP, DEFAULT_ENTRY_CAP));
  const maxBytes = options.maxBytes ?? DEFAULT_BYTE_CAP;
  const paths = projectPaths(projectId);

  let truncated = false;
  const events: ProjectEvent[] = [];

  try {
    const primary = await readTailBytes(paths.events, maxBytes);
    truncated = primary.truncated;
    events.push(...parseLines(primary.text, primary.truncated));

    if (events.length < limit) {
      try {
        const rotated = await readTailBytes(`${paths.events}.1`, maxBytes);
        if (rotated.text) {
          truncated = truncated || rotated.truncated;
          events.push(...parseLines(rotated.text, rotated.truncated));
        }
      } catch {
        // optional rotated file
      }
    }
  } catch {
    return { projectId, entries: [], truncated: false };
  }

  const mapped: ProjectDiagnosticEntry[] = [];
  for (const event of events) {
    const entry = mapEvent(event);
    if (entry) mapped.push(entry);
  }

  mapped.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const capped = mapped.slice(0, limit);
  if (mapped.length > limit) truncated = true;

  return { projectId, entries: capped, truncated };
}
