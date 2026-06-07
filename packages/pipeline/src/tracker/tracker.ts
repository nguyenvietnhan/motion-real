import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { PipelineError } from "../errors.js";
import { trackerPath } from "../store/store.js";

/**
 * Tracker work queue (tool-productization R5). A persisted list of items the
 * bulk loop reduces over; status transitions are the resume mechanism. Lives at
 * a stable location (VIDEO_TOOL_HOME/tracker.json by default, or a CSV the
 * operator points at) — never the repo root (R9.4). It is a queue, NOT a
 * planner: it only records items + status (design §5).
 */

export type TrackerStatus = "pending" | "in-progress" | "done" | "failed" | "paused-resumable";

export type TrackerItem = {
  id: string;
  url: string;
  title: string;
  source: string;
  status: TrackerStatus;
  /** Failure / pause detail. */
  reason?: string;
  /** Link to the produced project. */
  projectId?: string;
  updatedAt: string;
};

/** Column order for CSV serialization (stable). */
const CSV_COLUMNS = ["id", "url", "title", "source", "status", "reason", "projectId", "updatedAt"] as const;

/** A field is treated as CSV iff the path ends in .csv (case-insensitive). */
function isCsvPath(path: string): boolean {
  return /\.csv$/i.test(path);
}

/** RFC4180-style escape: quote when the value carries a comma, quote, or newline. */
function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Parse RFC4180 CSV text into rows of string cells (handles quoted commas/newlines). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += c;
    i++;
  }
  // Flush a trailing field/row when the text does not end in a newline.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function itemsToCsv(items: TrackerItem[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const item of items) {
    const cells = CSV_COLUMNS.map((col) => {
      const v = (item as Record<string, unknown>)[col];
      return csvEscape(v === undefined || v === null ? "" : String(v));
    });
    lines.push(cells.join(","));
  }
  return `${lines.join("\n")}\n`;
}

function csvToItems(text: string): TrackerItem[] {
  const rows = parseCsv(text).filter((r) => !(r.length === 1 && r[0] === ""));
  if (rows.length === 0) return [];
  const header = rows[0]!.map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const out: TrackerItem[] = [];
  for (const row of rows.slice(1)) {
    const cell = (name: string): string | undefined => {
      const at = idx(name);
      if (at < 0) return undefined;
      const v = row[at];
      return v === undefined || v === "" ? undefined : v;
    };
    const item: TrackerItem = {
      id: cell("id") ?? "",
      url: cell("url") ?? "",
      title: cell("title") ?? "",
      source: cell("source") ?? "",
      status: (cell("status") as TrackerStatus) ?? "pending",
      updatedAt: cell("updatedAt") ?? "",
      ...(cell("reason") !== undefined ? { reason: cell("reason") } : {}),
      ...(cell("projectId") !== undefined ? { projectId: cell("projectId") } : {}),
    };
    out.push(item);
  }
  return out;
}

/**
 * Read the tracker from `path` (defaults to VIDEO_TOOL_HOME/tracker.json).
 * A missing file is an empty queue. A malformed file raises a
 * `PipelineError(stage: "config")` rather than silently losing the queue.
 */
export async function readTracker(path: string = trackerPath()): Promise<TrackerItem[]> {
  if (!existsSync(path)) return [];
  const text = await readFile(path, "utf8");
  if (isCsvPath(path)) {
    return csvToItems(text);
  }
  if (text.trim() === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new PipelineError({
      stage: "config",
      cause: `malformed tracker JSON at ${path}: ${reason}`,
      remediation: "Fix or remove the tracker file; it must be a JSON array of tracker items.",
    });
  }
  if (!Array.isArray(parsed)) {
    throw new PipelineError({
      stage: "config",
      cause: `malformed tracker at ${path}: expected a JSON array of items`,
      remediation: "The tracker file must contain a top-level JSON array.",
    });
  }
  return parsed as TrackerItem[];
}

/**
 * Write the tracker to `path` (defaults to VIDEO_TOOL_HOME/tracker.json),
 * choosing CSV vs JSON by the file extension. Creates the directory if needed.
 */
export async function writeTracker(items: TrackerItem[], path: string = trackerPath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const body = isCsvPath(path) ? itemsToCsv(items) : `${JSON.stringify(items, null, 2)}\n`;
  await writeFile(path, body, "utf8");
}

/**
 * Insert or update an item by id (pure; returns a new list). When the id
 * exists, the patch is merged over it; otherwise the patch is appended (it must
 * carry a full item's fields). `updatedAt` is set by the caller/patch.
 */
export function upsertItem(items: TrackerItem[], patch: Partial<TrackerItem> & { id: string }): TrackerItem[] {
  const at = items.findIndex((it) => it.id === patch.id);
  if (at < 0) {
    return [...items, patch as TrackerItem];
  }
  const next = items.slice();
  next[at] = { ...next[at]!, ...patch };
  return next;
}
