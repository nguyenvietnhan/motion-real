import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

type JsonRecord = Record<string, unknown>;

type ToolExecution = {
  readonly signal: AbortSignal;
  readonly agent?: { readonly session: { readonly header: { readonly cwd?: string } } };
};

type ToolDefinition = {
  name: string;
  description: string;
  parameters: JsonRecord;
  output: {
    schema: JsonRecord;
    render(args: unknown, value: unknown): Array<{ type: "text"; text: string }>;
  };
  execute(args: unknown, execution: ToolExecution): Promise<unknown>;
};

type HarnessContext = {
  tools: { register(definition: ToolDefinition): () => void };
};

const RESULT_SCHEMA: JsonRecord = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "status", "request_revision"],
  properties: {
    kind: { type: "string", enum: ["assets", "brief"] },
    status: { type: "string", enum: ["submitted", "unchanged"] },
    request_revision: { type: "integer" },
  },
};

export const name = "motionreal-submission-tools";
export const inject = ["tools"];

export function apply(ctx: HarnessContext): void {
  ctx.tools.register(assetTool());
  ctx.tools.register(briefTool());
}

function assetTool(): ToolDefinition {
  return {
    name: "motionreal_submit_assets",
    description: "Submit the completed MotionReal asset manifest for the current request. Use only after every image has been downloaded into assets/.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["job_id", "request_revision", "items"],
      properties: {
        job_id: { type: "string", description: "Exact job_id from handoff/assets-request.json" },
        request_revision: { type: "integer", description: "Exact request_revision from handoff/assets-request.json" },
        items: {
          type: "array",
          minItems: 1,
          maxItems: 30,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "path", "source_url", "label"],
            properties: {
              id: { type: "string" },
              path: { type: "string", description: "Relative path below assets/" },
              source_url: { type: "string" },
              label: { type: "string" },
            },
          },
        },
      },
    },
    output: submissionOutput("assets"),
    async execute(args, execution) {
      const root = await currentWorkspace(execution);
      const input = requireRecord(args, "Asset submission");
      const request = await readRequest(root, "assets-request.json");
      const jobId = requiredText(input.job_id, "job_id", 128);
      const requestRevision = requiredRevision(input.request_revision);
      assertCurrentRequest(request, jobId, requestRevision);
      const items = await validateAssets(root, input.items, execution.signal);
      const payload = { version: 1, job_id: jobId, request_revision: requestRevision, items };
      const status = await writeOnce(root, "assets.json", payload, execution.signal);
      return { kind: "assets", status, request_revision: requestRevision };
    },
  };
}

function briefTool(): ToolDefinition {
  return {
    name: "motionreal_submit_brief",
    description: "Submit the completed 9:16 MotionReal creation brief for the current approved asset request.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["job_id", "request_revision", "prompt", "duration_tier", "video_language", "voice_provider", "selected_asset_ids"],
      properties: {
        job_id: { type: "string", description: "Exact job_id from handoff/brief-request.json" },
        request_revision: { type: "integer", description: "Exact request_revision from handoff/brief-request.json" },
        prompt: { type: "string", description: "Complete narrative and visual brief used by the MotionReal Create Flow" },
        duration_tier: { type: "integer", enum: [1, 2, 3, 4] },
        video_language: { type: "string", enum: ["vi", "en"] },
        voice_provider: { type: "string", enum: ["vivibe", "elevenlabs", "vieneu"] },
        selected_asset_ids: { type: "array", items: { type: "string" } },
      },
    },
    output: submissionOutput("brief"),
    async execute(args, execution) {
      const root = await currentWorkspace(execution);
      const input = requireRecord(args, "Brief submission");
      const request = await readRequest(root, "brief-request.json");
      const jobId = requiredText(input.job_id, "job_id", 128);
      const requestRevision = requiredRevision(input.request_revision);
      assertCurrentRequest(request, jobId, requestRevision);
      const requestedBrief = requireRecord(request.brief, "brief trong request");
      const selectedAssetIds = uniqueIds(input.selected_asset_ids, "selected_asset_ids");
      const expectedIds = uniqueIds(request.selected_asset_ids, "selected_asset_ids trong request");
      if (!sameIds(selectedAssetIds, expectedIds)) throw new Error("selected_asset_ids không khớp asset đã được duyệt.");
      const videoLanguage = enumValue(input.video_language, "video_language", ["vi", "en"] as const);
      const voiceProvider = enumValue(input.voice_provider, "voice_provider", ["vivibe", "elevenlabs", "vieneu"] as const);
      if (videoLanguage === "en" && voiceProvider !== "elevenlabs") throw new Error("Brief tiếng Anh phải dùng ElevenLabs.");
      const durationTier = input.duration_tier;
      if (!Number.isSafeInteger(durationTier) || ![1, 2, 3, 4].includes(Number(durationTier))) {
        throw new Error("duration_tier không hợp lệ.");
      }
      const payload = {
        version: 1,
        job_id: jobId,
        request_revision: requestRevision,
        brief_revision: 1,
        title: requiredText(requestedBrief.title, "title trong request", 160),
        prompt: requiredText(input.prompt, "prompt", 20_000, 20),
        format: "tiktok",
        duration_tier: Number(durationTier),
        video_language: videoLanguage,
        voice_provider: voiceProvider,
        selected_asset_ids: selectedAssetIds,
      };
      const status = await writeOnce(root, "brief.json", payload, execution.signal);
      return { kind: "brief", status, request_revision: requestRevision };
    },
  };
}

function submissionOutput(kind: "assets" | "brief"): ToolDefinition["output"] {
  return {
    schema: RESULT_SCHEMA,
    render: (_args, value) => {
      const status = requireRecord(value, "Submission result").status;
      return [{
        type: "text",
        text: status === "unchanged"
          ? `MotionReal đã nhận ${kind} này trước đó; hãy chờ bước duyệt.`
          : `Đã gửi ${kind} cho MotionReal kiểm tra; hãy chờ bước duyệt.`,
      }];
    },
  };
}

async function currentWorkspace(execution: ToolExecution): Promise<string> {
  execution.signal.throwIfAborted();
  const cwd = execution.agent?.session.header.cwd;
  const draftsRoot = process.env.MOTIONREAL_AGENT_DRAFTS_ROOT;
  if (!cwd || !isAbsolute(cwd) || !draftsRoot || !isAbsolute(draftsRoot)) {
    throw new Error("Tool chỉ dùng được trong MotionReal Agent workspace.");
  }
  const [root, workspace] = await Promise.all([realpath(draftsRoot), realpath(cwd)]);
  const rel = relative(root, workspace);
  if (!/^agent-[0-9a-f-]{36}$/i.test(rel) || rel.includes("\\") || rel.includes("/")) {
    throw new Error("Tool từ chối workspace không thuộc MotionReal.");
  }
  return workspace;
}

async function readRequest(root: string, file: string): Promise<JsonRecord> {
  let value: unknown;
  try {
    value = JSON.parse((await readFile(join(root, "handoff", file), "utf8")).replace(/^\uFEFF/, ""));
  } catch (_error) {
    throw new Error(`Không đọc được handoff/${file}.`);
  }
  const request = requireRecord(value, file);
  if (request.version !== 1) throw new Error(`${file} không được hỗ trợ.`);
  return request;
}

function assertCurrentRequest(request: JsonRecord, jobId: string, requestRevision: number): void {
  if (request.job_id !== jobId || request.request_revision !== requestRevision) {
    throw new Error("Submission đã cũ hoặc không thuộc job hiện tại; hãy đọc lại request mới nhất.");
  }
}

async function validateAssets(root: string, value: unknown, signal: AbortSignal): Promise<JsonRecord[]> {
  if (!Array.isArray(value) || value.length < 1 || value.length > 30) throw new Error("items phải có từ 1 đến 30 asset.");
  const seen = new Set<string>();
  const output: JsonRecord[] = [];
  const assetsRoot = await realpath(join(root, "assets"));
  for (const raw of value) {
    signal.throwIfAborted();
    const item = requireRecord(raw, "Asset");
    const id = requiredText(item.id, "asset id", 128);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id) || seen.has(id)) throw new Error("Asset id thiếu, trùng hoặc không hợp lệ.");
    seen.add(id);
    const path = requiredText(item.path, `path của ${id}`, 1_024);
    if (isAbsolute(path)) throw new Error(`Asset ${id} phải dùng đường dẫn tương đối trong assets/.`);
    const target = resolve(root, path);
    const rel = relative(assetsRoot, await realpath(target));
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`Asset ${id} nằm ngoài assets/.`);
    if (!(await stat(target)).isFile()) throw new Error(`Asset ${id} không phải file.`);
    const sourceUrl = validHttpUrl(item.source_url, `source_url của ${id}`);
    const label = requiredText(item.label, `label của ${id}`, 200);
    output.push({ id, path: path.replaceAll("\\", "/"), source_url: sourceUrl, label });
  }
  return output;
}

async function writeOnce(
  root: string,
  file: string,
  payload: JsonRecord,
  signal: AbortSignal,
): Promise<"submitted" | "unchanged"> {
  signal.throwIfAborted();
  const handoff = join(root, "handoff");
  const target = join(handoff, file);
  const existing = await readOptionalJson(target);
  if (existing && existing.job_id === payload.job_id && existing.request_revision === payload.request_revision) {
    if (isDeepStrictEqual(existing, payload)) return "unchanged";
    throw new Error("Request revision này đã có submission khác; hãy yêu cầu MotionReal tạo revision mới.");
  }
  await mkdir(handoff, { recursive: true });
  const temp = join(handoff, `.${file}.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", signal });
    signal.throwIfAborted();
    await rename(temp, target);
    return "submitted";
  } finally {
    await rm(temp, { force: true }).catch((_error) => undefined);
  }
}

async function readOptionalJson(path: string): Promise<JsonRecord | undefined> {
  try {
    const value: unknown = JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, ""));
    return requireRecord(value, "Existing submission");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw new Error("Submission hiện có không đọc được; MotionReal cần xử lý trước khi thử lại.");
  }
}

function requireRecord(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} không hợp lệ.`);
  return value as JsonRecord;
}

function requiredRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error("request_revision không hợp lệ.");
  return Number(value);
}

function requiredText(value: unknown, label: string, max: number, min = 1): string {
  if (typeof value !== "string") throw new Error(`${label} không hợp lệ.`);
  const text = value.trim();
  if (text.length < min || text.length > max) throw new Error(`${label} không hợp lệ.`);
  return text;
}

function uniqueIds(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id))) {
    throw new Error(`${label} không hợp lệ.`);
  }
  const ids = [...new Set(value as string[])];
  if (ids.length !== value.length) throw new Error(`${label} có id trùng.`);
  return ids;
}

function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id) => right.includes(id));
}

function enumValue<const T extends readonly string[]>(value: unknown, label: string, allowed: T): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) throw new Error(`${label} không hợp lệ.`);
  return value as T[number];
}

function validHttpUrl(value: unknown, label: string): string {
  const text = requiredText(value, label, 2_048);
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("protocol");
    return url.href;
  } catch (_error) {
    throw new Error(`${label} không hợp lệ.`);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
