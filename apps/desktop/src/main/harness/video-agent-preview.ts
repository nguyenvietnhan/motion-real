/**
 * Small, deliberately restricted bridge for the Video Agent developer preview.
 * It only offers web discovery and a bounded proposal tool; video work remains
 * in the existing Create and Workspace flows after the user approves.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, lstat, mkdir, readFile, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { videoToolHome } from "@motionreal/pipeline";
import type {
  AgentCompatibility,
  AgentEvent,
  AgentMessageVM,
  AgentPreflightVM,
  AgentProposalVM,
  AgentSessionRequest,
  AgentSessionVM,
} from "../../shared/types.js";

export const VIDEO_AGENT_OPENCODE_VERSION = "1.15.11";
/** Historical POC evidence only. Runtime gates verify the installed version. */
export const VIDEO_AGENT_OPENCODE_SHA = "d2bd7ea";
export const VIDEO_AGENT_9ROUTER_VERSION = "0.5.55";
export const VIDEO_AGENT_MODEL = "ag/gemini-3.7-flash-high";
export const VIDEO_AGENT_TOOLS = ["websearch", "motionreal_submit_proposal"] as const;
export const VIDEO_AGENT_PROTOCOL_REVISION = "video-agent-preview-r2";
const API_KEY_ENV = "MOTIONREAL_9ROUTER_API_KEY";
const MAX_TAIL = 8_000;
const VERIFY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const SIDECAR_REQUEST_TIMEOUT_MS = 30_000;
// The OpenCode tool catalog compiles a freshly linked plugin on first use.
// Keep that one bootstrap bounded, but do not give ordinary chat requests a long timeout.
const CATALOG_BOOTSTRAP_TIMEOUT_MS = 90_000;

type StoredSession = Omit<AgentSessionVM, "compatibility"> & {
  scope: "idea" | "project";
  protocolRevision?: string;
  opencodeSessionId?: string;
};
type ProposalInput = Record<string, unknown>;
type Active = {
  sessionId: string;
  opencodeSessionId: string;
  base: string;
  directory: string;
  password: string;
  child: ChildProcessWithoutNullStreams;
  eventAbort: AbortController;
  stopping: boolean;
  tail: string;
  failureCode?: "provider_failed" | "sidecar_failed";
};
type VerificationStage = "runtime" | "catalog" | "baseline" | "websearch" | "proposal";
type VerificationRecord = {
  status: "pass" | "fail";
  completedAt: string;
  runtime: { opencode: string; ninerouter: string; model: string; protocolRevision: string; cacheFingerprint: string };
  assertions: Record<string, boolean>;
  stage: VerificationStage;
  eventCounts: Record<string, number>;
  failedAt?: "opencode_server" | "provider_request" | "tool_loop" | "session_resume";
  error?: string;
};
type SafeSse = { kind: "status" | "tool" | "error"; text: string; code: NonNullable<AgentEvent["code"]>; tool?: NonNullable<AgentEvent["tool"]> };

export type AgentProjectContext = {
  projectId: string;
  title: string;
  stage: string;
  scenes: Array<{ id: string; narration: string; headline?: string; stillAvailable?: boolean }>;
};

export function catalogToolNames(value: unknown): string[] {
  const found = new Set<string>();
  const visit = (item: unknown): void => {
    if (Array.isArray(item)) return item.forEach(visit);
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    if (typeof record.id === "string" && ("description" in record || "parameters" in record || "inputSchema" in record)) found.add(record.id);
    if (typeof record.name === "string" && ("description" in record || "parameters" in record || "inputSchema" in record)) found.add(record.name);
    Object.values(record).forEach(visit);
  };
  visit(value);
  return [...found].sort();
}

export function isExactAgentCatalog(value: unknown): boolean {
  const names = catalogToolNames(value);
  return names.length === VIDEO_AGENT_TOOLS.length && names.every((name, index) => name === [...VIDEO_AGENT_TOOLS].sort()[index]);
}

export function isLoopbackOnly(addresses: readonly string[]): boolean {
  return addresses.length > 0 && addresses.every((address) => address === "127.0.0.1" || address === "::1" || address === "localhost");
}

export function isSupportedVideoAgentRuntime(opencodeVersion: string, nineRouterVersion: string, model = VIDEO_AGENT_MODEL): boolean {
  return opencodeVersion.trim() === VIDEO_AGENT_OPENCODE_VERSION && nineRouterVersion.trim() === VIDEO_AGENT_9ROUTER_VERSION && model === VIDEO_AGENT_MODEL;
}

/** POST bodies to OpenCode are JSON. */
export function agentJsonHeaders(headers?: HeadersInit, hasBody = false): Headers {
  const result = new Headers(headers);
  if (hasBody && !result.has("content-type")) result.set("content-type", "application/json");
  return result;
}

export function videoAgentPromptBody(message: string): Record<string, unknown> {
  return { model: { providerID: "ninerouter", modelID: VIDEO_AGENT_MODEL }, agent: "motionreal-video", parts: [{ type: "text", text: message }] };
}

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "";
}

function cleanUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).flatMap((item) => {
    const url = cleanText(item, 2048);
    try { return /^https?:$/.test(new URL(url).protocol) ? [url] : []; } catch (error) { void error; return []; }
  });
}

export function normalizeAgentProposal(value: unknown, context?: AgentProjectContext): AgentProposalVM {
  if (!value || typeof value !== "object") throw new Error("Đề xuất Agent không hợp lệ.");
  const raw = value as ProposalInput;
  const kind = raw.kind;
  const title = cleanText(raw.title, 160);
  const sourceUrls = cleanUrls(raw.sourceUrls);
  if (!title || (kind !== "create" && kind !== "edit")) throw new Error("Đề xuất Agent thiếu loại hoặc tiêu đề.");
  if (kind === "create") {
    const brief = cleanText(raw.brief, 12_000);
    if (!brief) throw new Error("Đề xuất tạo video thiếu brief.");
    return { kind, title, brief, sourceUrls };
  }
  if (!context || raw.projectId !== context.projectId) throw new Error("Đề xuất sửa không khớp dự án đang mở.");
  const allowed = new Set(context.scenes.map((scene) => scene.id));
  const edits = Array.isArray(raw.edits) ? raw.edits.slice(0, 30).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const sceneId = cleanText(record.sceneId, 160);
    const text = cleanText(record.text, 2_000);
    return allowed.has(sceneId) && text ? [{ sceneId, text }] : [];
  }) : [];
  const globalNotes = cleanText(raw.globalNotes, 4_000);
  if (edits.length === 0 && !globalNotes) throw new Error("Đề xuất sửa chưa có thay đổi cụ thể.");
  return { kind, title, projectId: context.projectId, edits, globalNotes, sourceUrls };
}

function agentRoot(): string { return join(videoToolHome(), "agent-sessions"); }
function runtimeRoot(): string { return join(videoToolHome(), "agent-runtime"); }
function indexPath(): string { return join(agentRoot(), "sessions.json"); }
function sessionDir(id: string): string { return join(agentRoot(), id); }
function cacheDir(): string { return join(runtimeRoot(), `opencode-plugin-${VIDEO_AGENT_OPENCODE_VERSION}`); }
function bunCacheDir(): string { return join(runtimeRoot(), `opencode-bun-cache-${VIDEO_AGENT_OPENCODE_VERSION}`); }
function verificationPath(): string { return join(runtimeRoot(), "preview-verification.json"); }
function sourceRuntimeDir(): string { return fileURLToPath(new URL("../../../runtime/opencode-plugin/", import.meta.url)); }
function requireId(id: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Mã phiên Agent không hợp lệ.");
  return id;
}
function compatibility(row: StoredSession): AgentCompatibility { return row.protocolRevision === VIDEO_AGENT_PROTOCOL_REVISION ? "current" : "legacy"; }
function toVM(row: StoredSession): AgentSessionVM {
  return { id: row.id, ...(row.projectId ? { projectId: row.projectId } : {}), title: row.title, updatedAt: row.updatedAt, compatibility: compatibility(row) };
}
async function loadSessions(): Promise<StoredSession[]> {
  try {
    const rows = JSON.parse(await readFile(indexPath(), "utf8")) as unknown;
    return Array.isArray(rows) ? rows.filter((row): row is StoredSession => !!row && typeof row === "object" && typeof (row as StoredSession).id === "string") : [];
  } catch (error) { void error; return []; }
}
async function saveSessions(rows: StoredSession[]): Promise<void> {
  await mkdir(agentRoot(), { recursive: true });
  await writeFile(indexPath(), `${JSON.stringify(rows, null, 2)}\n`, "utf8");
}
async function freePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : typeof address === "object" && address ? resolvePort(address.port) : reject(new Error("Không chọn được cổng loopback")));
    });
  });
}
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

export function videoAgentConfig(context?: AgentProjectContext): Record<string, unknown> {
  return {
    "$schema": "https://opencode.ai/config.json",
    autoupdate: false,
    enabled_providers: ["ninerouter"],
    default_agent: "motionreal-video",
    model: `ninerouter/${VIDEO_AGENT_MODEL}`,
    provider: {
      ninerouter: {
        npm: "@ai-sdk/openai-compatible",
        options: { baseURL: "http://127.0.0.1:20128/v1", apiKey: `{env:${API_KEY_ENV}}` },
        models: { [VIDEO_AGENT_MODEL]: { name: VIDEO_AGENT_MODEL, tool_call: true, modalities: { input: ["text"], output: ["text"] } } },
      },
    },
    permission: { "*": "deny", websearch: "allow", motionreal_submit_proposal: "allow" },
    agent: { "motionreal-video": { mode: "primary", model: `ninerouter/${VIDEO_AGENT_MODEL}`, prompt: systemPrompt(context), steps: 6 } },
  };
}

export function proposalToolSource(context?: AgentProjectContext): string {
  const expectedProject = JSON.stringify(context?.projectId ?? null);
  const allowedScenes = JSON.stringify(context?.scenes.map((scene) => scene.id) ?? []);
  return `import { tool } from "@opencode-ai/plugin";\nimport { writeFile } from "node:fs/promises";\nconst projectId=${expectedProject}; const sceneIds=new Set(${allowedScenes}); const max=24576;\nexport default tool({ description: "Submit exactly one Video Agent proposal for user review. Valid kind values are create or edit only. For create, include title and brief. For edit, include title, projectId, and at least one edit or globalNotes. This does not apply changes.", args:{ kind: tool.schema.enum(["create","edit"]), title: tool.schema.string().max(160), brief: tool.schema.string().max(12000).optional(), sourceUrls: tool.schema.array(tool.schema.string().max(2048)).max(12).optional(), projectId: tool.schema.string().max(160).optional(), edits: tool.schema.array(tool.schema.object({ sceneId: tool.schema.string().max(160), text: tool.schema.string().max(2000) })).max(30).optional(), globalNotes: tool.schema.string().max(4000).optional() }, async execute(args, context) { const p=args; if (!p.title.trim()) throw new Error("proposal title is required"); if (p.kind==="create" && !p.brief?.trim()) throw new Error("create proposal requires brief"); if (p.kind==="edit" && (!projectId || p.projectId!==projectId || ((!p.edits || p.edits.length===0) && !p.globalNotes?.trim()) || p.edits?.some((e)=>!sceneIds.has(e.sceneId)))) throw new Error("edit proposal project, scenes, or content is invalid"); const json=JSON.stringify(p); if (Buffer.byteLength(json,"utf8")>max) throw new Error("proposal too large"); await writeFile(context.directory+"/proposal.json", json, "utf8"); return "Proposal saved for user review. Do not claim it has been applied."; } });\n`;
}

function systemPrompt(context?: AgentProjectContext): string {
  const project = context ? `Current project: ${context.title} (${context.projectId}), stage ${context.stage}. Scenes: ${context.scenes.map((scene) => `${scene.id}: ${scene.narration}${scene.stillAvailable ? " [still reviewed]" : ""}`).join(" | ")}` : "New-video idea session.";
  return `You are MotionReal Video Agent. You may research with websearch, explain video ideas, and submit a proposal only with motionreal_submit_proposal. You cannot browse arbitrary URLs, download assets, operate a computer, edit files, render, or apply changes. Source/image URLs remain unverified for rights. The proposal tool accepts only kind "create" or "edit"; never guess other kinds. A create proposal needs title and brief. An edit proposal needs title, the exact projectId, and edits or globalNotes. Use optional websearch only when it materially helps, then submit at most one proposal for the user's request. ${project}`;
}

/** Hide the old preview's persisted prompt-as-user message, but never alter new input. */
export function visibleAgentText(role: "user" | "assistant", value: string): string {
  if (role === "assistant" && value.startsWith("CRITICAL - MAXIMUM STEPS REACHED")) return "";
  if (role === "user" && value.startsWith("You are MotionReal Video Agent.")) {
    const marker = "User:";
    const at = value.lastIndexOf(marker);
    return at >= 0 ? cleanText(value.slice(at + marker.length), 12_000) : "";
  }
  return cleanText(value, 12_000);
}

export function latestNewAssistantReply(before: readonly AgentMessageVM[], after: readonly AgentMessageVM[]): AgentMessageVM | undefined {
  const known = new Set(before.map((message) => message.id));
  return [...after].reverse().find((message) => message.role === "assistant" && !known.has(message.id));
}

function textTail(current: string, chunk: Buffer): string { return `${current}${chunk.toString()}`.slice(-MAX_TAIL); }
function scrubError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/timeout|timed out/i.test(raw)) return "Yêu cầu Agent quá thời hạn.";
  if (/catalog|config|OpenCode sidecar|sidecar/i.test(raw)) return "Không thể khởi động Agent runtime.";
  return "Nhà cung cấp Agent không hoàn thành yêu cầu.";
}
function cacheFingerprint(lock: string): string { return createHash("sha256").update(lock).digest("hex"); }
function normalizedPath(value: string): string { return normalize(resolve(value)).toLowerCase(); }

async function stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) return;
  if (child.pid && process.platform === "win32") {
    await new Promise<void>((done) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true });
      killer.once("exit", () => done());
      killer.once("error", () => done());
    });
    return;
  }
  child.kill();
}

async function commandOutput(command: string, args: string[], cwd: string, timeoutMs = 30_000): Promise<string> {
  return await new Promise((resolveOutput, reject) => {
    const child = spawn(command, args, { cwd, shell: process.platform === "win32" && /\.cmd$/i.test(command), windowsHide: true });
    let output = "";
    let settled = false;
    let timedOut = false;
    const finish = (done: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      done();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      void stopChild(child).finally(() => finish(() => reject(new Error(`command timed out after ${timeoutMs}ms`))));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => output += chunk.toString());
    child.stderr.on("data", (chunk: Buffer) => output += chunk.toString());
    child.on("error", (error) => finish(() => reject(error)));
    child.on("exit", (code) => finish(() => timedOut ? reject(new Error(`command timed out after ${timeoutMs}ms`)) : code === 0 ? resolveOutput(output.trim()) : reject(new Error(output.trim() || `exit ${code}`))));
  });
}

async function nineRouterVersion(cwd: string): Promise<string> {
  return process.platform === "win32"
    ? commandOutput("powershell.exe", ["-NoProfile", "-Command", "& 9router --version"], cwd)
    : commandOutput("9router", ["--version"], cwd);
}

async function cacheIsValid(target: string, sourceLock: string): Promise<boolean> {
  try {
    const [lock, plugin] = await Promise.all([
      readFile(join(target, "package-lock.json"), "utf8"),
      readFile(join(target, "node_modules", "@opencode-ai", "plugin", "package.json"), "utf8"),
    ]);
    const version = JSON.parse(plugin) as { version?: string };
    return lock === sourceLock && version.version === VIDEO_AGENT_OPENCODE_VERSION;
  } catch (error) { void error; return false; }
}

let cacheBootstrap: Promise<{ directory: string; fingerprint: string }> | undefined;
export async function ensureVideoAgentPluginCache(): Promise<{ directory: string; fingerprint: string }> {
  if (!cacheBootstrap) cacheBootstrap = (async () => {
    const source = sourceRuntimeDir();
    const sourcePackage = join(source, "package.json");
    const sourceLockPath = join(source, "package-lock.json");
    if (!existsSync(sourcePackage) || !existsSync(sourceLockPath)) throw new Error("Thiếu manifest runtime OpenCode đã pin.");
    const sourceLock = await readFile(sourceLockPath, "utf8");
    const target = cacheDir();
    if (await cacheIsValid(target, sourceLock)) return { directory: target, fingerprint: cacheFingerprint(sourceLock) };
    const temporary = `${target}.building-${randomUUID()}`;
    await mkdir(temporary, { recursive: true });
    try {
      await Promise.all([
        copyFile(sourcePackage, join(temporary, "package.json")),
        copyFile(sourceLockPath, join(temporary, "package-lock.json")),
      ]);
      const npm = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npm";
      const npmArgs = process.platform === "win32"
        ? ["/d", "/s", "/c", "npm.cmd ci --ignore-scripts --no-audit --no-fund --offline"]
        : ["ci", "--ignore-scripts", "--no-audit", "--no-fund", "--offline"];
      await commandOutput(npm, npmArgs, temporary, 120_000);
      if (!await cacheIsValid(temporary, sourceLock)) throw new Error("Cache plugin OpenCode không đúng lockfile đã pin.");
      await rm(target, { recursive: true, force: true });
      await mkdir(runtimeRoot(), { recursive: true });
      await rename(temporary, target);
      return { directory: target, fingerprint: cacheFingerprint(sourceLock) };
    } catch (error) {
      await rm(temporary, { recursive: true, force: true });
      throw error;
    }
  })().catch((error) => { cacheBootstrap = undefined; throw error; });
  return await cacheBootstrap;
}

async function linkJunction(linkPath: string, target: string): Promise<void> {
  try {
    const item = await lstat(linkPath);
    if (item.isSymbolicLink()) {
      const actual = await (await import("node:fs/promises")).realpath(linkPath);
      if (normalizedPath(actual) === normalizedPath(target)) return;
      await unlink(linkPath);
    } else await rm(linkPath, { recursive: true, force: true });
  } catch (error) { void error; /* missing is the normal first-run case */ }
  await mkdir(resolve(linkPath, ".."), { recursive: true });
  await symlink(target, linkPath, "junction");
}

async function linkSessionDependencies(directory: string, cache: string): Promise<void> {
  const bunCache = bunCacheDir();
  await mkdir(bunCache, { recursive: true });
  const nodeModules = join(cache, "node_modules");
  await Promise.all([
    linkJunction(join(directory, ".opencode", "node_modules"), nodeModules),
    linkJunction(join(directory, "opencode-home", "opencode", "node_modules"), nodeModules),
    linkJunction(join(directory, "opencode-home", ".bun", "install", "cache"), bunCache),
  ]);
}

function findSessionId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) return value.map(findSessionId).find(Boolean);
  const record = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(record)) {
    if ((key === "sessionID" || key === "sessionId" || key === "session_id") && typeof child === "string") return child;
    const nested = findSessionId(child);
    if (nested) return nested;
  }
  return undefined;
}

/** Maps only a small allow-list of event effects; raw event data never leaves Main. */
export function safeAgentSse(value: unknown, sessionId: string): SafeSse | undefined {
  const eventSession = findSessionId(value);
  if (!eventSession || eventSession !== sessionId) return undefined;
  const compact = JSON.stringify(value).toLowerCase();
  if (compact.includes("error") || compact.includes("failed")) return { kind: "error", text: "Lỗi Agent chưa áp dụng thay đổi. [provider_failed]", code: "provider_failed" };
  if (compact.includes("motionreal_submit_proposal") || compact.includes("proposal")) return { kind: "tool", text: "Agent đã tạo đề xuất để bạn duyệt.", code: "proposal", tool: "motionreal_submit_proposal" };
  if (compact.includes("websearch")) return { kind: "tool", text: "Đang research web…", code: "websearch", tool: "websearch" };
  if (compact.includes("running") || compact.includes("thinking")) return { kind: "status", text: "Agent đang suy nghĩ…", code: "thinking" };
  return undefined;
}

export class VideoAgentPreview {
  #active: Active | undefined;
  #contexts = new Map<string, AgentProjectContext | undefined>();
  constructor(
    private readonly emit: (event: AgentEvent) => void,
    private readonly gatewayAddresses: () => Promise<string[]> = defaultGatewayAddresses,
    private readonly localApiKey: () => string | undefined = () => process.env[API_KEY_ENV],
    private readonly loadProjectContext?: (projectId: string) => Promise<AgentProjectContext>,
    private readonly requireVerification = true,
  ) {}

  async preflight(): Promise<AgentPreflightVM> {
    if (process.platform !== "win32") return { state: "blocked", message: "Developer Preview hiện chỉ hỗ trợ Windows native." };
    const binary = process.env.MOTIONREAL_OPENCODE_BIN?.trim();
    if (!binary || !existsSync(binary)) return { state: "blocked", message: "Thiếu OpenCode binary đã kiểm chứng." };
    const apiKey = this.localApiKey()?.trim();
    if (!apiKey) return { state: "blocked", message: "9router chưa chuẩn bị credential nội bộ cho Agent." };
    const addresses = await this.gatewayAddresses().catch((error) => { void error; return []; });
    if (!isLoopbackOnly(addresses)) return { state: "blocked", message: "Agent bị khóa: 9router phải chỉ lắng nghe 127.0.0.1 hoặc ::1." };
    let openCodeVersion: string;
    let routerVersion: string;
    try {
      [openCodeVersion, routerVersion] = await Promise.all([
        commandOutput(binary, ["--version"], process.cwd()),
        nineRouterVersion(process.cwd()),
      ]);
    } catch (error) { void error; return { state: "blocked", message: "Không đọc được phiên bản OpenCode hoặc 9router." }; }
    if (!isSupportedVideoAgentRuntime(openCodeVersion, routerVersion)) return { state: "blocked", message: "OpenCode hoặc 9router không đúng runtime đã kiểm chứng." };
    let models: string[];
    let cache: { directory: string; fingerprint: string };
    try {
      [models, cache] = await Promise.all([this.gatewayModels(apiKey), ensureVideoAgentPluginCache()]);
    } catch (error) { void error; return { state: "blocked", message: "Không kiểm tra được model 9router hoặc cache Agent." }; }
    if (!models.includes(VIDEO_AGENT_MODEL)) return { state: "blocked", message: "9router chưa có model Video Agent đã kiểm chứng." };
    if (this.requireVerification && !await this.hasMatchingVerification(cache.fingerprint, openCodeVersion, routerVersion)) {
      return { state: "blocked", message: "Cần chạy npm run verify:agent-preview trước khi bật Agent." };
    }
    return { state: "ready", message: "Developer Preview sẵn sàng.", model: VIDEO_AGENT_MODEL };
  }

  async list(): Promise<AgentSessionVM[]> {
    return (await loadSessions()).map(toVM).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async open(request: AgentSessionRequest): Promise<AgentSessionVM> {
    const rows = await loadSessions();
    let row: StoredSession | undefined;
    if (request.kind === "new-idea") {
      const now = new Date().toISOString();
      row = { id: randomUUID(), scope: "idea", title: "Ý tưởng mới", updatedAt: now, protocolRevision: VIDEO_AGENT_PROTOCOL_REVISION };
      rows.push(row);
      await saveSessions(rows);
    } else if (request.kind === "project") {
      const projectId = cleanText(request.projectId, 160);
      if (!projectId) throw new Error("Thiếu dự án Agent.");
      row = rows.filter((item) => item.scope === "project" && item.projectId === projectId && compatibility(item) === "current")
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      if (!row) {
        const now = new Date().toISOString();
        row = { id: randomUUID(), scope: "project", projectId, title: projectId, updatedAt: now, protocolRevision: VIDEO_AGENT_PROTOCOL_REVISION };
        rows.push(row);
        await saveSessions(rows);
      }
    } else {
      row = rows.find((item) => item.id === requireId(request.sessionId));
      if (!row) throw new Error("Không tìm thấy phiên Agent.");
    }
    const context = row.projectId && this.loadProjectContext ? await this.loadProjectContext(row.projectId) : undefined;
    if (context) {
      row.title = context.title;
      row.updatedAt = new Date().toISOString();
      const at = rows.findIndex((item) => item.id === row!.id);
      if (at >= 0) { rows[at] = row; await saveSessions(rows); }
    }
    this.#contexts.set(row.id, context);
    if (this.#active?.sessionId === row.id && context) await this.dispose();
    return toVM(row);
  }

  async history(id: string): Promise<AgentMessageVM[]> {
    const row = await this.row(id);
    if (!row.opencodeSessionId) return [];
    await this.ensure(row, true);
    return await this.messages(this.#active!, row.opencodeSessionId);
  }

  async proposal(id: string): Promise<AgentProposalVM | null> {
    const row = await this.row(id);
    const context = await this.contextFor(row);
    try { return normalizeAgentProposal(JSON.parse(await readFile(join(sessionDir(row.id), "proposal.json"), "utf8")), context); } catch (error) { void error; return null; }
  }

  async prompt(id: string, text: string): Promise<void> {
    const row = await this.row(id);
    if (compatibility(row) !== "current") throw new Error("Phiên cũ không tương thích — chỉ xem hoặc xóa.");
    const message = cleanText(text, 12_000);
    if (!message) throw new Error("Tin nhắn Agent trống.");
    this.emit({ sessionId: id, kind: "status", text: "Đang khởi động Agent…", code: "starting" });
    let active: Active | undefined;
    try {
      await this.ensure(row);
      active = this.#active!;
      const before = await this.messages(active, row.opencodeSessionId!);
      const user: AgentMessageVM = { id: randomUUID(), role: "user", text: message, createdAt: new Date().toISOString() };
      this.emit({ sessionId: id, kind: "message", text: user.text, message: user });
      this.emit({ sessionId: id, kind: "status", text: "Agent đang suy nghĩ…", code: "thinking" });
      await this.fetchJson<unknown>(active, `/session/${encodeURIComponent(row.opencodeSessionId!)}/prompt_async`, { method: "POST", body: JSON.stringify(videoAgentPromptBody(message)) });
      const reply = await this.waitForReply(active, row.opencodeSessionId!, before);
      this.emit({ sessionId: id, kind: "message", text: reply.text, message: reply });
      if (await this.proposal(id)) this.emit({ sessionId: id, kind: "tool", text: "Agent đã tạo đề xuất để bạn duyệt.", code: "proposal", tool: "motionreal_submit_proposal" });
      this.emit({ sessionId: id, kind: "status", text: "Agent sẵn sàng.", code: "ready" });
    } catch (error) {
      // A provider timeout may contain the word "aborted". Only the explicit
      // user abort signal is allowed to suppress an error and a stale reply.
      if (active?.eventAbort.signal.aborted) return;
      const message = scrubError(error);
      const code: NonNullable<AgentEvent["code"]> = /quá thời hạn/i.test(message) ? "timeout" : /khởi động Agent runtime/i.test(message) ? "sidecar_failed" : "provider_failed";
      this.emit({ sessionId: id, kind: "error", text: `Lỗi Agent chưa áp dụng thay đổi. [${code}]`, code });
      throw new Error(message);
    }
  }

  async abort(id: string): Promise<void> {
    const row = await this.row(id);
    const active = this.#active;
    if (row.opencodeSessionId && active?.sessionId === id) {
      active.eventAbort.abort();
      await this.fetchJson(active, `/session/${encodeURIComponent(row.opencodeSessionId)}/abort`, { method: "POST" }).catch((error) => { void error; return undefined; });
    }
    this.emit({ sessionId: id, kind: "status", text: "Đã dừng Agent.", code: "aborted" });
  }

  async forget(id: string): Promise<void> {
    id = requireId(id);
    if (this.#active?.sessionId === id) await this.dispose();
    // Windows can hold the linked plugin directory for a moment after taskkill.
    await rm(sessionDir(id), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    await saveSessions((await loadSessions()).filter((row) => row.id !== id));
    this.#contexts.delete(id);
  }

  async dispose(): Promise<void> {
    const active = this.#active;
    this.#active = undefined;
    if (active) await this.disposeActive(active);
  }

  private async row(id: string): Promise<StoredSession> {
    const row = (await loadSessions()).find((item) => item.id === requireId(id));
    if (!row) throw new Error("Không tìm thấy phiên Agent.");
    return row;
  }

  private async contextFor(row: StoredSession): Promise<AgentProjectContext | undefined> {
    const cached = this.#contexts.get(row.id);
    if (cached || !row.projectId || !this.loadProjectContext) return cached;
    const context = await this.loadProjectContext(row.projectId);
    this.#contexts.set(row.id, context);
    return context;
  }

  private async ensure(row: StoredSession, allowLegacy = false): Promise<void> {
    if (!allowLegacy && compatibility(row) !== "current") throw new Error("Phiên cũ không tương thích — chỉ xem hoặc xóa.");
    if (this.#active?.sessionId === row.id && this.#active.child.exitCode === null) return;
    await this.dispose();
    const preflight = await this.preflight();
    if (preflight.state !== "ready") throw new Error(preflight.message);
    const cache = await ensureVideoAgentPluginCache();
    const directory = sessionDir(row.id);
    const configDir = join(directory, "config");
    const context = await this.contextFor(row);
    await mkdir(join(directory, ".opencode", "tools"), { recursive: true });
    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, "opencode.json"), `${JSON.stringify(videoAgentConfig(context), null, 2)}\n`);
    await writeFile(join(directory, ".opencode", "tools", "motionreal_submit_proposal.ts"), proposalToolSource(context));
    await linkSessionDependencies(directory, cache.directory);
    const apiKey = this.localApiKey();
    const binary = process.env.MOTIONREAL_OPENCODE_BIN;
    if (!apiKey || !binary) throw new Error("Không thể khởi động Agent runtime.");
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const candidate = await this.startCandidate(row, directory, configDir, apiKey, binary);
      try {
        await this.waitHealth(candidate);
        const doc = await this.fetchText(candidate, "/doc", undefined, CATALOG_BOOTSTRAP_TIMEOUT_MS, "documentation");
        if (!doc.includes("/session") || !doc.includes("/event")) throw new Error("OpenCode runtime thiếu route cần thiết.");
        const effectiveConfig = await this.fetchJson<unknown>(candidate, "/config", undefined, CATALOG_BOOTSTRAP_TIMEOUT_MS, "configuration");
        if (JSON.stringify(effectiveConfig).includes("AI_CONTRACT.md")) throw new Error("OpenCode config isolation thất bại.");
        const catalog = await this.fetchJson<unknown>(candidate, `/experimental/tool?provider=ninerouter&model=${encodeURIComponent(VIDEO_AGENT_MODEL)}`, undefined, CATALOG_BOOTSTRAP_TIMEOUT_MS, "catalog");
        if (!isExactAgentCatalog(catalog)) throw new Error("OpenCode tool catalog không đúng allow-list Video Agent.");
        if (!row.opencodeSessionId) {
          const created = await this.fetchJson<{ id?: string }>(candidate, "/session", { method: "POST", body: JSON.stringify({ title: row.title }) });
          if (!created.id) throw new Error("Không tạo được phiên OpenCode.");
          row.opencodeSessionId = created.id;
          row.updatedAt = new Date().toISOString();
          const rows = await loadSessions();
          const at = rows.findIndex((item) => item.id === row.id);
          if (at >= 0) { rows[at] = row; await saveSessions(rows); }
        }
        candidate.opencodeSessionId = row.opencodeSessionId;
        this.#active = candidate;
        this.subscribe(candidate);
        return;
      } catch (error) {
        lastError = error;
        const addressBusy = /eaddrinuse/i.test(candidate.tail) || /eaddrinuse/i.test(error instanceof Error ? error.message : "");
        await this.disposeActive(candidate);
        if (!addressBusy || attempt === 1) break;
      }
    }
    throw lastError ?? new Error("Không thể khởi động Agent runtime.");
  }

  private async startCandidate(row: StoredSession, directory: string, configDir: string, apiKey: string, binary: string): Promise<Active> {
    const password = randomBytes(32).toString("base64url");
    const port = await freePort();
    const child = spawn(binary, ["serve", "--pure", "--hostname", "127.0.0.1", "--port", String(port)], {
      cwd: directory,
      windowsHide: true,
      stdio: "pipe",
      env: {
        ...process.env,
        USERPROFILE: join(directory, "opencode-home"),
        APPDATA: join(directory, "opencode-home"),
        LOCALAPPDATA: join(directory, "opencode-home"),
        OPENCODE_CONFIG: join(configDir, "opencode.json"),
        OPENCODE_CONFIG_DIR: join(directory, ".opencode"),
        OPENCODE_DISABLE_PROJECT_CONFIG: "1",
        OPENCODE_DISABLE_CLAUDE_CODE: "1",
        OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
        OPENCODE_DISABLE_AUTOUPDATE: "1",
        OPENCODE_ENABLE_EXA: "1",
        OPENCODE_SERVER_PASSWORD: password,
        [API_KEY_ENV]: apiKey,
      },
    });
    const active: Active = { sessionId: row.id, opencodeSessionId: row.opencodeSessionId ?? "", base: `http://127.0.0.1:${port}`, directory, password, child, eventAbort: new AbortController(), stopping: false, tail: "" };
    child.stdout.on("data", (chunk: Buffer) => active.tail = textTail(active.tail, chunk));
    child.stderr.on("data", (chunk: Buffer) => active.tail = textTail(active.tail, chunk));
    child.once("exit", () => {
      if (this.#active !== active || active.stopping) return;
      this.#active = undefined;
      active.eventAbort.abort();
      this.emit({ sessionId: active.sessionId, kind: "error", text: "Lỗi Agent chưa áp dụng thay đổi. [sidecar_failed]", code: "sidecar_failed" });
    });
    return active;
  }

  private headers(active: Active, headers?: HeadersInit, hasBody = false): Headers {
    const merged = agentJsonHeaders(headers, hasBody);
    merged.set("x-opencode-directory", active.directory);
    merged.set("authorization", `Basic ${Buffer.from(`opencode:${active.password}`).toString("base64")}`);
    return merged;
  }

  private async fetchText(active: Active, path: string, init?: RequestInit, timeoutMs = SIDECAR_REQUEST_TIMEOUT_MS, label = "request"): Promise<string> {
    let response: Response;
    try {
      response = await fetch(`${active.base}${path}`, { ...init, headers: this.headers(active, init?.headers, init?.body !== undefined), signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") throw new Error(`Agent runtime ${label} quá thời hạn.`);
      throw error;
    }
    const body = await response.text();
    if (!response.ok) throw new Error(`Agent runtime ${label} thất bại (${response.status}).`);
    return body;
  }

  private async fetchJson<T>(active: Active, path: string, init?: RequestInit, timeoutMs?: number, label?: string): Promise<T> {
    const text = await this.fetchText(active, path, init, timeoutMs, label);
    return (text ? JSON.parse(text) : undefined) as T;
  }

  private async waitHealth(active: Active): Promise<void> {
    for (let i = 0; i < 120; i += 1) {
      if (active.child.exitCode !== null) throw new Error("OpenCode sidecar không khởi động.");
      try {
        const health = await this.fetchJson<{ healthy?: boolean }>(active, "/global/health");
        if (health.healthy) return;
      } catch (error) { void error; /* sidecar is expected to be unavailable briefly */ }
      await sleep(250);
    }
    throw new Error("OpenCode sidecar không khởi động.");
  }

  private async waitForReply(active: Active, session: string, before: readonly AgentMessageVM[]): Promise<AgentMessageVM> {
    for (let i = 0; i < 360; i += 1) {
      if (active.eventAbort.signal.aborted) throw new Error("Agent request aborted.");
      if (active.failureCode) throw new Error(`Agent ${active.failureCode}.`);
      const reply = latestNewAssistantReply(before, await this.messages(active, session));
      if (reply) return reply;
      await sleep(250);
    }
    throw new Error("Agent request timed out.");
  }

  private async messages(active: Active, session: string): Promise<AgentMessageVM[]> {
    const raw = await this.fetchJson<unknown>(active, `/session/${encodeURIComponent(session)}/message`);
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((item, index) => {
      const record = item as { info?: { id?: string; role?: string; time?: { created?: number } }; parts?: Array<{ type?: string; text?: string }> };
      const role = record?.info?.role;
      const text = record?.parts?.filter((part) => part.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n").trim() ?? "";
      if (role !== "user" && role !== "assistant") return [];
      const visible = visibleAgentText(role, text);
      return visible ? [{ id: record.info?.id ?? `${index}`, role, text: visible, createdAt: new Date(record.info?.time?.created ?? Date.now()).toISOString() } satisfies AgentMessageVM] : [];
    });
  }

  private subscribe(active: Active): void {
    void (async () => {
      try {
        const response = await fetch(`${active.base}/event`, { headers: this.headers(active), signal: active.eventAbort.signal });
        if (!response.ok || !response.body) throw new Error("SSE unavailable");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffered = "";
        while (!active.eventAbort.signal.aborted) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffered += decoder.decode(chunk.value, { stream: true });
          let end = buffered.indexOf("\n\n");
          while (end >= 0) {
            const packet = buffered.slice(0, end);
            buffered = buffered.slice(end + 2);
            const data = packet.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
            if (data) {
              try {
                const safe = safeAgentSse(JSON.parse(data), active.opencodeSessionId);
                if (safe && this.#active === active) {
                  if (safe.kind === "error" && (safe.code === "provider_failed" || safe.code === "sidecar_failed")) active.failureCode = safe.code;
                  this.emit({ sessionId: active.sessionId, kind: safe.kind, text: safe.text, code: safe.code, ...(safe.tool ? { tool: safe.tool } : {}) });
                }
              } catch (error) { void error; /* malformed event cannot reach renderer */ }
            }
            end = buffered.indexOf("\n\n");
          }
        }
      } catch (error) {
        void error;
        if (!active.stopping && !active.eventAbort.signal.aborted && this.#active === active) {
          this.emit({ sessionId: active.sessionId, kind: "error", text: "Lỗi Agent chưa áp dụng thay đổi. [sidecar_failed]", code: "sidecar_failed" });
        }
      }
    })();
  }

  private async disposeActive(active: Active): Promise<void> {
    active.stopping = true;
    active.eventAbort.abort();
    await this.fetchJson(active, "/instance/dispose", { method: "POST" }).catch((error) => { void error; return undefined; });
    await stopChild(active.child);
  }

  private async gatewayModels(apiKey: string): Promise<string[]> {
    const response = await fetch("http://127.0.0.1:20128/v1/models", { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error("Gateway models unavailable");
    const data = await response.json() as { data?: Array<{ id?: unknown }> };
    return Array.isArray(data.data) ? data.data.flatMap((model) => typeof model.id === "string" ? [model.id] : []) : [];
  }

  private async hasMatchingVerification(fingerprint: string, opencode: string, ninerouter: string): Promise<boolean> {
    try {
      const value = JSON.parse(await readFile(verificationPath(), "utf8")) as VerificationRecord;
      const age = Date.now() - Date.parse(value.completedAt);
      return value.status === "pass" && Number.isFinite(age) && age >= 0 && age <= VERIFY_MAX_AGE_MS
        && value.runtime.opencode === opencode && value.runtime.ninerouter === ninerouter
        && value.runtime.model === VIDEO_AGENT_MODEL && value.runtime.protocolRevision === VIDEO_AGENT_PROTOCOL_REVISION
        && value.runtime.cacheFingerprint === fingerprint;
    } catch (error) { void error; return false; }
  }
}

/** Runs a real tool loop. It deliberately needs an explicitly supplied local
 * credential because a CLI process cannot read the Electron Main memory. */
export async function runVideoAgentVerification(apiKey: string): Promise<VerificationRecord> {
  const record: VerificationRecord = {
    status: "fail",
    completedAt: new Date().toISOString(),
    runtime: { opencode: "", ninerouter: "", model: VIDEO_AGENT_MODEL, protocolRevision: VIDEO_AGENT_PROTOCOL_REVISION, cacheFingerprint: "" },
    assertions: { runtime: false, catalog: false, websearch: false, proposal: false, completion: false },
    stage: "runtime",
    eventCounts: {},
  };
  const events: AgentEvent[] = [];
  const preview = new VideoAgentPreview((event) => events.push(event), defaultGatewayAddresses, () => apiKey, undefined, false);
  let session: AgentSessionVM | undefined;
  try {
    const cache = await ensureVideoAgentPluginCache();
    record.runtime.cacheFingerprint = cache.fingerprint;
    record.runtime.opencode = await commandOutput(process.env.MOTIONREAL_OPENCODE_BIN ?? "", ["--version"], process.cwd());
    record.runtime.ninerouter = await nineRouterVersion(process.cwd());
    const preflight = await preview.preflight();
    record.assertions.runtime = preflight.state === "ready";
    if (!record.assertions.runtime) throw new Error(preflight.message);
    session = await preview.open({ kind: "new-idea" });
    record.stage = "catalog";
    await preview.history(session.id);
    record.assertions.catalog = true;
    record.stage = "baseline";
    await preview.prompt(session.id, "Reply with exactly PING. Do not use any tool.");
    record.assertions.completion = (await preview.history(session.id)).some((message) => message.role === "assistant" && message.text.trim() === "PING");
    if (!record.assertions.completion) throw new Error("Agent baseline completion failed.");
    record.stage = "websearch";
    const beforeWebsearch = events.length;
    await preview.prompt(session.id, "Use websearch exactly once to search for OpenAI ChatGPT, then answer in Vietnamese with one short sentence. Do not submit a proposal.");
    record.assertions.websearch = events.slice(beforeWebsearch).some((event) => event.code === "websearch");
    if (!record.assertions.websearch) throw new Error("Agent websearch tool loop failed.");
    record.stage = "proposal";
    await preview.prompt(session.id, "Submit exactly one create proposal in Vietnamese with a title and a useful brief. Do not use websearch.");
    record.assertions.proposal = !!await preview.proposal(session.id);
    if (!Object.values(record.assertions).every(Boolean)) throw new Error("Agent verifier assertions failed.");
    record.status = "pass";
  } catch (error) {
    record.failedAt = record.stage === "runtime" || record.stage === "catalog"
      ? "opencode_server"
      : record.stage === "websearch" || record.stage === "proposal"
        ? "tool_loop"
        : "provider_request";
    record.error = scrubError(error);
  } finally {
    for (const event of events) {
      const key = event.code ?? event.kind;
      record.eventCounts[key] = (record.eventCounts[key] ?? 0) + 1;
    }
    try {
      if (session) await preview.forget(session.id);
    } catch (error) {
      record.status = "fail";
      record.failedAt = "opencode_server";
      record.error = "Không dọn được session Agent sau verifier.";
    }
    await preview.dispose();
    await mkdir(runtimeRoot(), { recursive: true });
    await writeFile(verificationPath(), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  }
  return record;
}

async function defaultGatewayAddresses(): Promise<string[]> {
  const command = "(Get-NetTCPConnection -LocalPort 20128 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalAddress) -join ','";
  const output = await commandOutput("powershell.exe", ["-NoProfile", "-Command", command], process.cwd());
  return output.split(",").map((item) => item.trim()).filter(Boolean);
}
