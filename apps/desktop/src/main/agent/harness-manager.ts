import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { createLogger } from "@motionreal/pipeline";
import type { AgentDraftVM } from "../../shared/types.js";
import { sanitizedChildEnvironment } from "../security/runtime-security.js";

const METADATA_FILE = "motionreal-agent.json";
const CREATE_REQUEST_FILE = "motionreal.create.json";
const HARNESS_HOME = ".harness";
const AGENTS_FILE = "AGENTS.md";
// A brand-new DSH_HOME initializes the web profile on its first launch. The
// checked-in Harness build needs roughly 30s on this Windows machine, so 20s
// was a false failure even though the child was about to become healthy.
const START_TIMEOUT_MS = 60_000;
const PROCESS_OUTPUT_LIMIT = 4_096;
const log = createLogger("harness");

export type { AgentDraftVM } from "../../shared/types.js";

type DraftRecord = Omit<AgentDraftVM, "harnessUrl" | "createReady">;

export type AgentCreateRequest = {
  draftId: string;
  prompt: string;
  imagePaths: string[];
};

type HarnessRpcResponse = {
  result?: { ok?: boolean; value?: unknown; error?: { message?: unknown } };
};

export type HarnessManagerDeps = {
  draftsRoot: string;
  harnessCliPath: string;
  spawn?: typeof spawn;
  fetch?: typeof fetch;
  findPort?: () => Promise<number>;
  now?: () => Date;
  nodeExecutable?: string;
};

/**
 * One DeepSeek Harness runtime per video draft. DSH stores sessions, messages,
 * tool history, and workspace state under DSH_HOME, so keeping it below the
 * draft lets a normal draft deletion remove all of that state atomically.
 */
export class HarnessManager {
  private active: { id: string; child: ChildProcess; url: string } | null = null;
  private readonly spawnChild: typeof spawn;
  private readonly fetchImpl: typeof fetch;
  private readonly findPort: () => Promise<number>;
  private readonly now: () => Date;
  private readonly nodeExecutable: string;

  constructor(private readonly deps: HarnessManagerDeps) {
    this.spawnChild = deps.spawn ?? spawn;
    this.fetchImpl = deps.fetch ?? fetch;
    this.findPort = deps.findPort ?? findLoopbackPort;
    this.now = deps.now ?? (() => new Date());
    // DeepSeek Harness is a Node CLI. process.execPath inside Electron points to
    // MotionReal.exe, whose embedded Node does not resolve this source checkout's
    // linked workspace packages correctly on Windows.
    this.nodeExecutable = deps.nodeExecutable ?? "node";
  }

  async list(): Promise<AgentDraftVM[]> {
    if (!existsSync(this.deps.draftsRoot)) return [];
    const entries = await readdir(this.deps.draftsRoot, { withFileTypes: true });
    const drafts: AgentDraftVM[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !isSafeDraftId(entry.name)) continue;
      const record = await this.readRecord(entry.name).catch((_error) => null);
      if (!record) continue;
      drafts.push(await this.toVm(record));
    }
    return drafts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async createDraft(title: string): Promise<AgentDraftVM> {
    const normalized = title.trim().slice(0, 120);
    if (!normalized) throw new Error("Hãy đặt tên video trước khi mở Agent.");
    const id = `agent-${randomUUID()}`;
    const root = this.rootOf(id);
    const record: DraftRecord = { id, title: normalized, createdAt: this.now().toISOString() };
    await mkdir(join(root, "assets"), { recursive: true });
    await mkdir(join(root, HARNESS_HOME), { recursive: true });
    await writeFile(join(root, METADATA_FILE), `${JSON.stringify(record, null, 2)}\n`, "utf8");
    await writeFile(join(root, AGENTS_FILE), agentInstructions(normalized), "utf8");
    await writeFile(join(root, HARNESS_HOME, "settings.yaml"), harnessSettings(), "utf8");
    return this.toVm(record);
  }

  async activate(id: string, apiKey: string): Promise<AgentDraftVM> {
    const record = await this.mustReadRecord(id);
    if (!apiKey.trim()) throw new Error("Chưa lấy được khóa nội bộ của 9router để khởi động Harness.");
    if (this.active?.id === id) return this.toVm(record);
    await this.dispose();
    if (!existsSync(this.deps.harnessCliPath)) {
      throw new Error("Chưa tìm thấy DeepSeek Harness. Cài/built Harness hoặc đặt MOTIONREAL_DSH_CLI.");
    }

    const root = this.rootOf(id);
    const port = await this.findPort();
    const url = `http://127.0.0.1:${port}/`;
    const child = this.spawnChild(
      this.nodeExecutable,
      [this.deps.harnessCliPath, "web", "--host", "127.0.0.1", "--port", String(port), "--no-open"],
      {
        cwd: root,
        env: {
          ...sanitizedChildEnvironment(),
          DSH_HOME: join(root, HARNESS_HOME),
          NINEROUTER_API_KEY: apiKey,
        },
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
      },
    );
    let stderrTail = "";
    let startupFailure: Error | null = null;
    let started = false;
    let stopping = false;
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderrTail = `${stderrTail}${String(chunk)}`.slice(-PROCESS_OUTPUT_LIMIT);
    });
    child.once("error", (error) => {
      startupFailure = new Error(`Không chạy được Node cho DeepSeek Harness: ${error.message}`);
      if (this.active?.child === child) this.active = null;
    });
    child.once("close", (code, signal) => {
      if (!started && !stopping) {
        startupFailure ??= harnessExitError(code, signal, stderrTail.replaceAll(apiKey, "[redacted]"));
      }
      if (this.active?.child === child) this.active = null;
    });
    try {
      await waitForHttp(url, this.fetchImpl, () => startupFailure);
      const workspace = await this.rpc(url, "workspace.create", { path: root });
      const workspaceInfo = workspaceInfoOf(workspace);
      await this.rpc(url, "workspace.rename", { workspaceId: workspaceInfo.id, title: record.title });
      // The first boot needs a blank session. Later app launches retain the
      // previous DSH session/history instead of silently starting a new chat.
      if (workspaceInfo.sessionIds.length === 0) await this.rpc(url, "session.create", { workspaceId: workspaceInfo.id });
      this.active = { id, child, url };
      started = true;
      return this.toVm(record);
    } catch (error) {
      stopping = true;
      await stopChild(child);
      throw error;
    }
  }

  async status(id: string): Promise<AgentDraftVM> {
    return this.toVm(await this.mustReadRecord(id));
  }

  async readCreateRequest(id: string): Promise<AgentCreateRequest> {
    const record = await this.mustReadRecord(id);
    const path = join(this.rootOf(record.id), CREATE_REQUEST_FILE);
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(path, "utf8"));
    } catch (_error) {
      throw new Error("Agent chưa tạo yêu cầu dựng video hợp lệ.");
    }
    if (!raw || typeof raw !== "object") throw new Error("Yêu cầu dựng video của Agent không hợp lệ.");
    const input = raw as { version?: unknown; prompt?: unknown; images?: unknown };
    if (input.version !== 1 || typeof input.prompt !== "string" || !input.prompt.trim()) {
      throw new Error("Yêu cầu dựng video của Agent thiếu nội dung.");
    }
    if (input.prompt.length > 20_000) throw new Error("Yêu cầu dựng video quá dài.");
    if (input.images !== undefined && !Array.isArray(input.images)) throw new Error("Danh sách ảnh của Agent không hợp lệ.");
    const imagePaths = await Promise.all((input.images ?? []).slice(0, 30).map((value) => this.localAssetPath(record.id, value)));
    return { draftId: record.id, prompt: input.prompt.trim(), imagePaths };
  }

  async linkProject(id: string, projectId: string): Promise<void> {
    const record = await this.mustReadRecord(id);
    await this.writeRecord({ ...record, projectId });
  }

  async draftForProject(projectId: string): Promise<AgentDraftVM | null> {
    return (await this.list()).find((draft) => draft.projectId === projectId) ?? null;
  }

  async removeDraft(id: string): Promise<void> {
    const record = await this.mustReadRecord(id);
    if (this.active?.id === record.id) await this.dispose();
    await rm(this.rootOf(record.id), { recursive: true, force: true });
  }

  async dispose(): Promise<void> {
    const current = this.active;
    this.active = null;
    if (!current) return;
    await stopChild(current.child);
  }

  private async toVm(record: DraftRecord): Promise<AgentDraftVM> {
    const createReady = existsSync(join(this.rootOf(record.id), CREATE_REQUEST_FILE));
    return {
      ...record,
      ...(this.active?.id === record.id ? { harnessUrl: this.active.url } : {}),
      createReady,
    };
  }

  private async mustReadRecord(id: string): Promise<DraftRecord> {
    if (!isSafeDraftId(id)) throw new Error("Video Agent không hợp lệ.");
    const record = await this.readRecord(id);
    if (!record) throw new Error("Không tìm thấy phiên Video Agent.");
    return record;
  }

  private async readRecord(id: string): Promise<DraftRecord | null> {
    try {
      const raw = JSON.parse(await readFile(join(this.rootOf(id), METADATA_FILE), "utf8")) as Partial<DraftRecord>;
      if (!raw || raw.id !== id || typeof raw.title !== "string" || typeof raw.createdAt !== "string") return null;
      return {
        id,
        title: raw.title,
        createdAt: raw.createdAt,
        ...(typeof raw.projectId === "string" ? { projectId: raw.projectId } : {}),
      };
    } catch (_error) {
      return null;
    }
  }

  private writeRecord(record: DraftRecord): Promise<void> {
    return writeFile(join(this.rootOf(record.id), METADATA_FILE), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  }

  private rootOf(id: string): string {
    return join(this.deps.draftsRoot, id);
  }

  private async localAssetPath(id: string, value: unknown): Promise<string> {
    if (typeof value !== "string" || !value.trim()) throw new Error("Đường dẫn ảnh Agent không hợp lệ.");
    const root = resolve(this.rootOf(id));
    const resolved = resolve(root, value);
    const rel = relative(root, resolved);
    if (!rel || rel.startsWith("..") || isAbsolute(rel) || rel.split(/[\\/]/).includes(HARNESS_HOME)) {
      throw new Error("Ảnh Agent phải nằm trong workspace của video.");
    }
    const info = await stat(resolved).catch((_error) => null);
    if (!info?.isFile()) throw new Error(`Không tìm thấy ảnh Agent: ${basename(value)}`);
    return resolved;
  }

  private async rpc(baseUrl: string, method: string, payload: unknown): Promise<unknown> {
    const response = await this.fetchImpl(`${baseUrl}api/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "client-request", rpcId: randomUUID(), method, payload }),
    });
    if (!response.ok) throw new Error(`Harness không chấp nhận ${method}.`);
    const body = (await response.json()) as HarnessRpcResponse;
    if (!body.result?.ok) {
      const detail = typeof body.result?.error?.message === "string" ? body.result.error.message : "lỗi không xác định";
      throw new Error(`Harness ${method} thất bại: ${detail}`);
    }
    return body.result.value;
  }
}

function isSafeDraftId(value: string): boolean {
  return /^agent-[0-9a-f-]{36}$/i.test(value);
}

function workspaceInfoOf(value: unknown): { id: string; sessionIds: string[] } {
  const workspace = value && typeof value === "object" ? (value as { workspace?: unknown }).workspace : null;
  if (!workspace || typeof workspace !== "object" || typeof (workspace as { workspaceId?: unknown }).workspaceId !== "string") {
    throw new Error("Harness trả về workspace không hợp lệ.");
  }
  const sessionIds = (workspace as { sessionIds?: unknown }).sessionIds;
  return {
    id: (workspace as { workspaceId: string }).workspaceId,
    sessionIds: Array.isArray(sessionIds) && sessionIds.every((id) => typeof id === "string") ? sessionIds : [],
  };
}

function agentInstructions(title: string): string {
  return `# MotionReal Video Agent\n\nBạn đang làm việc cho video: ${title}\n\n- Nghiên cứu, ghi chú và tải asset vào thư mục \`assets/\` của workspace này.\n- Không chạy renderer MotionReal hoặc tự sửa project MotionReal.\n- Chỉ khi người dùng nói rõ muốn tạo video, hãy ghi \`motionreal.create.json\` tại root với dạng:\n  \`{ "version": 1, "prompt": "brief cuối cùng", "images": ["assets/ten-anh.png"] }\`\n- \`images\` chỉ chứa đường dẫn tương đối trong workspace.\n`;
}

function harnessSettings(): string {
  return `llm-pi-ai:\n  providers:\n    ninerouter:\n      apiKeyEnv: NINEROUTER_API_KEY\n      api: openai-completions\n      baseURL: http://127.0.0.1:20128/v1\n      compat:\n        supportsDeveloperRole: false\n        maxTokensField: max_tokens\n      models:\n        - id: ag/gemini-3.7-flash-high\nagent-default-model:\n  provider: ninerouter\n  model: ag/gemini-3.7-flash-high\n`;
}

async function findLoopbackPort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Không chọn được cổng Harness.")));
        return;
      }
      server.close((error) => (error ? reject(error) : resolvePort(address.port)));
    });
  });
}

async function waitForHttp(url: string, fetchImpl: typeof fetch, childFailure: () => Error | null): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const failure = childFailure();
    if (failure) throw failure;
    try {
      const response = await fetchImpl(url);
      if (response.ok) return;
    } catch (_error) {
      // Child has not opened its loopback server yet.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
  }
  throw new Error("DeepSeek Harness khởi động quá lâu.");
}

function harnessExitError(code: number | null, signal: NodeJS.Signals | null, stderrTail: string): Error {
  const diagnostic = stderrTail.trim();
  log.error({ code, signal, stderr: diagnostic }, "DeepSeek Harness exited before startup completed");
  if (diagnostic.includes("ERR_MODULE_NOT_FOUND") || diagnostic.includes("Cannot find package")) {
    return new Error("DeepSeek Harness thiếu dependency đã build. Hãy cài/build lại checkout Harness rồi thử lại.");
  }
  const reason = code !== null ? `mã ${code}` : signal ? `tín hiệu ${signal}` : "không rõ mã lỗi";
  return new Error(`DeepSeek Harness đã dừng trước khi mở giao diện (${reason}).`);
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null && child.exitCode !== undefined) return;
  await new Promise<void>((resolveStopped) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveStopped();
    };
    const timer = setTimeout(finish, 2_000);
    child.once("exit", finish);
    if (!child.kill()) finish();
  });
}
