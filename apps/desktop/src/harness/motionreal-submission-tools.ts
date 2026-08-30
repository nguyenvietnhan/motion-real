import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { MAX_IMAGE_BYTES, MAX_IMAGE_DIM, sniffImage } from "../../../../packages/pipeline/src/assets/import-image.js";
import { enableExaSearch, type HarnessSearchContext } from "./harness-search.js";

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
    kind: { type: "string", enum: ["assets", "brief", "authoring"] },
    status: { type: "string", enum: ["submitted", "unchanged"] },
    request_revision: { type: "integer" },
  },
};

export const name = "motionreal-submission-tools";
export const inject = ["tools", "systemPrompt"];

export async function apply(ctx: HarnessContext, config?: { exa?: { harnessCliPath: string } }): Promise<void> {
  ctx.tools.register(assetTool());
  ctx.tools.register(briefTool());
  ctx.tools.register(authoringTool());
  if (config?.exa) await enableExaSearch(ctx as HarnessContext & HarnessSearchContext, config.exa.harnessCliPath);
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
            required: ["id", "path", "source_url", "label", "role"],
            properties: {
              id: { type: "string" },
              path: { type: "string", description: "Relative path below assets/" },
              source_url: { type: "string" },
              label: { type: "string" },
              role: { type: "string", enum: ["hero", "support", "logo", "icon"] },
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
    description: "Submit the content brief for the current approved asset request. The user chooses duration and voice after reviewing it.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["job_id", "request_revision", "title", "prompt", "video_language", "selected_asset_ids"],
      properties: {
        job_id: { type: "string", description: "Exact job_id from handoff/brief-request.json" },
        request_revision: { type: "integer", description: "Exact request_revision from handoff/brief-request.json" },
        title: { type: "string", description: "Concise proposed title for the video" },
        prompt: { type: "string", description: "Content brief: audience, facts, narrative arc, visual direction, and intended asset use. Do not prescribe duration, scene count, or voice." },
        video_language: { type: "string", enum: ["vi", "en"] },
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
      const selectedAssetIds = uniqueIds(input.selected_asset_ids, "selected_asset_ids");
      const expectedIds = uniqueIds(request.selected_asset_ids, "selected_asset_ids trong request");
      if (!sameIds(selectedAssetIds, expectedIds)) throw new Error("selected_asset_ids không khớp asset đã được duyệt.");
      const videoLanguage = enumValue(input.video_language, "video_language", ["vi", "en"] as const);
      const payload = {
        version: 1,
        job_id: jobId,
        request_revision: requestRevision,
        brief_revision: 1,
        title: requiredText(input.title, "title", 160),
        prompt: requiredText(input.prompt, "prompt", 20_000, 20),
        format: "tiktok",
        video_language: videoLanguage,
        selected_asset_ids: selectedAssetIds,
      };
      const status = await writeOnce(root, "brief.generated.json", payload, execution.signal);
      return { kind: "brief", status, request_revision: requestRevision };
    },
  };
}

function authoringTool(): ToolDefinition {
  return {
    name: "motionreal_submit_authoring",
    description: "Submit scene code for validation/still rendering, or complete one bounded visual_refine pass after inspecting current stills. Follow the current authoring-request revision.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["job_id", "request_revision", "scene_ids", "used_asset_ids"],
      properties: {
        job_id: { type: "string", description: "Exact job_id from handoff/authoring-request.json" },
        request_revision: { type: "integer", description: "Exact request_revision from handoff/authoring-request.json" },
        scene_ids: { type: "array", minItems: 1, maxItems: 30, items: { type: "string" } },
        used_asset_ids: { type: "array", items: { type: "string" }, description: "Asset ids actually referenced by scene.image.ref" },
        reviewed_scene_ids: { type: "array", items: { type: "string" }, description: "Required during visual_refine: every scene whose current PNG was opened with read_image" },
        review_notes: { type: "string", description: "Required during review: observations of the current PNGs, changes and remaining issues" },
      },
    },
    output: submissionOutput("authoring"),
    async execute(args, execution) {
      const root = await currentWorkspace(execution);
      const input = requireRecord(args, "Authoring submission");
      const request = await readRequest(root, "authoring-request.json");
      const jobId = requiredText(input.job_id, "job_id", 128);
      const requestRevision = requiredRevision(input.request_revision);
      assertCurrentRequest(request, jobId, requestRevision);
      const sceneIds = uniqueIds(input.scene_ids, "scene_ids");
      if (sceneIds.length < 1 || sceneIds.length > 30) throw new Error("scene_ids phải có từ 1 đến 30 cảnh.");
      const usedAssetIds = uniqueIds(input.used_asset_ids, "used_asset_ids");
      await validateAuthoredProject(root, request, sceneIds, usedAssetIds, execution.signal);
      const visualRefine = request.phase === "visual_refine";
      const reviewedSceneIds = visualRefine ? uniqueIds(input.reviewed_scene_ids, "reviewed_scene_ids") : [];
      const requestedReviewIds = visualRefine && Array.isArray(request.review_scene_ids)
        ? uniqueIds(request.review_scene_ids, "review_scene_ids trong request")
        : sceneIds;
      if (visualRefine && (requestedReviewIds.some((id) => !sceneIds.includes(id)) || !sameIds(reviewedSceneIds, requestedReviewIds))) {
        throw new Error("Visual refine phải mở đủ still trong phạm vi được yêu cầu.");
      }
      const reviewNotes = visualRefine ? requiredText(input.review_notes, "review_notes", 4_000, 10) : undefined;
      const payload = {
        version: 1,
        job_id: jobId,
        request_revision: requestRevision,
        scene_ids: sceneIds,
        used_asset_ids: usedAssetIds,
        ...(visualRefine ? { reviewed_scene_ids: reviewedSceneIds, review_notes: reviewNotes } : {}),
      };
      const status = await writeOnce(root, "authoring.json", payload, execution.signal);
      return { kind: "authoring", status, request_revision: requestRevision };
    },
  };
}

function submissionOutput(kind: "assets" | "brief" | "authoring"): ToolDefinition["output"] {
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

async function validateAuthoredProject(
  root: string,
  request: JsonRecord,
  sceneIds: string[],
  usedAssetIds: string[],
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  if (request.manifest !== "project/manifest.json" || request.authored_dir !== "project/authored") {
    throw new Error("Authoring request có project path không được hỗ trợ.");
  }
  const manifest = requireRecord(JSON.parse(await readFile(join(root, "project", "manifest.json"), "utf8")), "Project manifest");
  if (!Array.isArray(manifest.scenes) || manifest.scenes.length < 1 || manifest.scenes.length > 30) {
    throw new Error("Project manifest phải có từ 1 đến 30 cảnh.");
  }
  const manifestSceneIds = manifest.scenes.map((scene) => requiredText(requireRecord(scene, "Manifest scene").id, "scene id", 128));
  if (!isDeepStrictEqual(manifestSceneIds, sceneIds)) throw new Error("scene_ids không khớp thứ tự cảnh trong project/manifest.json.");
  const expectedAssets = Array.isArray(request.assets) ? request.assets.map((asset) => requireRecord(asset, "Request asset")) : [];
  const expectedIds = expectedAssets.map((asset) => requiredText(asset.id, "request asset id", 128));
  if (new Set(usedAssetIds).size !== usedAssetIds.length || usedAssetIds.some((id) => !expectedIds.includes(id))) {
    throw new Error("used_asset_ids phải là tập con không trùng của asset đã duyệt.");
  }
  const sceneImages = manifest.scenes.flatMap((scene) => {
    const manifestScene = requireRecord(scene, "Manifest scene");
    const image = manifestScene.image;
    if (image === undefined) return [];
    const value = requireRecord(image, "Scene image");
    return [{
      sceneId: requiredText(manifestScene.id, "scene id", 128),
      ref: requiredText(value.ref, "scene image ref", 1_024),
      role: value.role,
    }];
  });
  const approvedRefs = new Set<string>();
  const usedRefs = new Set<string>();
  for (const asset of expectedAssets) {
    const assetId = requiredText(asset.id, "request asset id", 128);
    const ref = requiredText(asset.ref, "request asset ref", 1_024);
    approvedRefs.add(ref);
    if (usedAssetIds.includes(assetId)) usedRefs.add(ref);
    if (!usedAssetIds.includes(assetId)) continue;
    const matches = sceneImages.filter((image) => image.ref === ref);
    if (matches.length === 0) throw new Error(`Asset ${String(asset.id)} chưa được tham chiếu bởi scene.image.ref.`);
    if (asset.role !== undefined) {
      const role = enumValue(asset.role, `role của ${String(asset.id)}`, ["hero", "support", "logo", "icon"] as const);
      if (matches.some((image) => image.role !== role)) {
        throw new Error(`Asset ${String(asset.id)} phải giữ scene.image.role="${role}" trong mọi cảnh sử dụng.`);
      }
    }
  }
  for (const image of sceneImages) {
    if (!approvedRefs.has(image.ref)) throw new Error(`${image.sceneId} dùng scene.image.ref chưa được duyệt.`);
    if (!usedRefs.has(image.ref)) throw new Error(`${image.sceneId} dùng asset chưa khai báo trong used_asset_ids.`);
  }

  // Admission maps registerComponent ids to files; filenames need not equal ids.
  const modules = (await readdir(join(root, "project", "authored"), { withFileTypes: true }))
    .filter((file) => file.isFile() && file.name.endsWith(".tsx") && !file.name.startsWith("_"));
  if (modules.length < 1) throw new Error("Project chưa có module authored/*.tsx.");
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
    const bytes = await readFile(target);
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error(`Asset ${id} vượt giới hạn 10 MB.`);
    const image = sniffImage(bytes);
    if (!image?.dims || image.dims.width <= 0 || image.dims.height <= 0) {
      throw new Error(`Asset ${id} không phải ảnh raster được hỗ trợ.`);
    }
    if (image.dims.width > MAX_IMAGE_DIM || image.dims.height > MAX_IMAGE_DIM) {
      throw new Error(`Asset ${id} vượt giới hạn kích thước 4096 px.`);
    }
    const sourceUrl = validHttpUrl(item.source_url, `source_url của ${id}`);
    const label = requiredText(item.label, `label của ${id}`, 200);
    const role = enumValue(item.role, `role của ${id}`, ["hero", "support", "logo", "icon"] as const);
    output.push({ id, path: path.replaceAll("\\", "/"), source_url: sourceUrl, label, role });
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
