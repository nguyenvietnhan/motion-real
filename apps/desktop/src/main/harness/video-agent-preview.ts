/**
 * Developer-preview bridge for a deliberately small Video Agent.  It never
 * receives filesystem tools: OpenCode may search the web and submit a bounded
 * proposal only.  Project changes stay in the existing WorkspaceController.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { isAbsolute, join, resolve } from "node:path";
import { videoToolHome } from "@motionreal/pipeline";
import type { AgentMessageVM, AgentPreflightVM, AgentProposalVM, AgentSessionVM } from "../../shared/types.js";

export const VIDEO_AGENT_OPENCODE_VERSION = "1.15.11";
export const VIDEO_AGENT_OPENCODE_SHA = "d2bd7ea";
export const VIDEO_AGENT_9ROUTER_VERSION = "0.5.55";
export const VIDEO_AGENT_MODEL = "ag/gemini-3.7-flash-high";
export const VIDEO_AGENT_TOOLS = ["websearch", "motionreal_submit_proposal"] as const;
const API_KEY_ENV = "MOTIONREAL_9ROUTER_API_KEY";

type StoredSession = AgentSessionVM & { scope: "idea" | "project"; opencodeSessionId?: string };
type ProposalInput = Record<string, unknown>;
type Active = { sessionId: string; base: string; directory: string; password: string; child: ChildProcessWithoutNullStreams };
export type AgentProjectContext = { projectId: string; title: string; stage: string; scenes: Array<{ id: string; narration: string; headline?: string; stillAvailable?: boolean }> };

export function catalogToolNames(value: unknown): string[] {
  const found = new Set<string>();
  const visit = (item: unknown): void => {
    if (Array.isArray(item)) return item.forEach(visit);
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    // v1.15's /experimental/tool response is an array of tool descriptors.
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

function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
}

function cleanUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).flatMap((item) => {
    const url = cleanText(item, 2048);
    try { return /^https?:$/.test(new URL(url).protocol) ? [url] : []; } catch (error) { void error; return []; }
  });
}

/** Main validates again after the custom tool: never trust a sidecar write. */
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
function indexPath(): string { return join(agentRoot(), "sessions.json"); }
function sessionDir(id: string): string { return join(agentRoot(), id); }
function requireId(id: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Mã phiên Agent không hợp lệ.");
  return id;
}
async function loadSessions(): Promise<StoredSession[]> {
  try { const rows = JSON.parse(await readFile(indexPath(), "utf8")) as unknown; return Array.isArray(rows) ? rows.filter((row): row is StoredSession => !!row && typeof row === "object" && typeof (row as StoredSession).id === "string") : []; } catch (error) { void error; return []; }
}
async function saveSessions(rows: StoredSession[]): Promise<void> { await mkdir(agentRoot(), { recursive: true }); await writeFile(indexPath(), `${JSON.stringify(rows, null, 2)}\n`, "utf8"); }
async function freePort(): Promise<number> { return await new Promise((resolvePort, reject) => { const server = createServer(); server.unref(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); server.close((error) => error ? reject(error) : typeof address === "object" && address ? resolvePort(address.port) : reject(new Error("Không chọn được cổng loopback"))); }); }); }
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

function config(): Record<string, unknown> {
  return { "$schema": "https://opencode.ai/config.json", autoupdate: false, enabled_providers: ["ninerouter"], default_agent: "motionreal-video", model: `ninerouter/${VIDEO_AGENT_MODEL}`, provider: { ninerouter: { npm: "@ai-sdk/openai-compatible", options: { baseURL: "http://127.0.0.1:20128/v1", apiKey: `{env:${API_KEY_ENV}}` }, models: { [VIDEO_AGENT_MODEL]: { name: VIDEO_AGENT_MODEL, tool_call: true, modalities: { input: ["text", "image"], output: ["text"] } } } } }, permission: { "*": "deny", websearch: "allow", motionreal_submit_proposal: "allow" }, agent: { "motionreal-video": { mode: "primary", model: `ninerouter/${VIDEO_AGENT_MODEL}`, steps: 12 } } };
}

function toolSource(context?: AgentProjectContext): string {
  const expectedProject = JSON.stringify(context?.projectId ?? null);
  const allowedScenes = JSON.stringify(context?.scenes.map((scene) => scene.id) ?? []);
  return `import { tool } from "@opencode-ai/plugin";\nimport { writeFile } from "node:fs/promises";\nconst projectId=${expectedProject}; const sceneIds=new Set(${allowedScenes}); const max=24576;\nexport default tool({ description: "Submit one bounded Video Agent proposal. It cannot edit files or render.", args:{ proposalJson: tool.schema.string() }, async execute(args, context) { if (Buffer.byteLength(args.proposalJson,"utf8")>max) throw new Error("proposal too large"); let p; try { p=JSON.parse(args.proposalJson); } catch (error) { void error; throw new Error("proposal must be JSON"); } if (!p || !["create","edit"].includes(p.kind)) throw new Error("bad proposal kind"); if (p.kind==="edit" && (!projectId || p.projectId!==projectId || !Array.isArray(p.edits) || p.edits.some((e)=>!e || !sceneIds.has(e.sceneId)))) throw new Error("proposal project or scene mismatch"); await writeFile(context.directory+"/proposal.json", JSON.stringify(p), "utf8"); return "Proposal saved for user review. Do not claim it has been applied."; } });\n`;
}

function systemPrompt(context?: AgentProjectContext): string {
  const project = context ? `Current project: ${context.title} (${context.projectId}), stage ${context.stage}. Scenes: ${context.scenes.map((scene) => `${scene.id}: ${scene.narration}${scene.stillAvailable ? " [still reviewed]" : ""}`).join(" | ")}` : "New-video idea session.";
  return `You are MotionReal Video Agent. You may research with websearch, explain video ideas, and submit a proposal only with motionreal_submit_proposal. You cannot browse arbitrary URLs, download assets, operate a computer, edit files, render, or apply changes. Source/image URLs remain unverified for rights. ${project}`;
}

async function commandOutput(command: string, args: string[], cwd: string): Promise<string> { return await new Promise((resolveOutput, reject) => { const child = spawn(command, args, { cwd, shell: process.platform === "win32" && /\.cmd$/i.test(command), windowsHide: true }); let output = ""; child.stdout.on("data", (chunk: Buffer) => output += chunk.toString()); child.stderr.on("data", (chunk: Buffer) => output += chunk.toString()); child.on("error", reject); child.on("exit", (code) => code === 0 ? resolveOutput(output.trim()) : reject(new Error(output.trim() || `exit ${code}`))); }); }

/** Global npm exposes 9router as a .ps1 on this Windows installation, which
 * Node cannot execute directly.  Let PowerShell resolve it exactly as the
 * normal desktop gateway launcher does. */
async function nineRouterVersion(cwd: string): Promise<string> {
  return process.platform === "win32"
    ? commandOutput("powershell.exe", ["-NoProfile", "-Command", "& 9router --version"], cwd)
    : commandOutput("9router", ["--version"], cwd);
}

async function prewarm(directory: string): Promise<void> {
  const args = ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--save-exact", `@opencode-ai/plugin@${VIDEO_AGENT_OPENCODE_VERSION}`];
  for (const at of [join(directory, ".opencode"), join(directory, "opencode-home", "opencode")]) { await mkdir(at, { recursive: true }); if (!existsSync(join(at, "package.json"))) await writeFile(join(at, "package.json"), "{\"private\":true}\n"); await commandOutput(process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npm", process.platform === "win32" ? ["/d", "/s", "/c", `npm.cmd ${args.join(" ")}`] : args, at); }
}

export class VideoAgentPreview {
  #active: Active | undefined;
  #contexts = new Map<string, AgentProjectContext | undefined>();
  constructor(
    private readonly emit: (event: { sessionId: string; kind: "status" | "tool" | "message" | "error"; text: string; message?: AgentMessageVM }) => void,
    private readonly gatewayAddresses: () => Promise<string[]> = defaultGatewayAddresses,
    private readonly localApiKey: () => string | undefined = () => process.env[API_KEY_ENV],
  ) {}

  async preflight(): Promise<AgentPreflightVM> {
    if (process.platform !== "win32") return { state: "blocked", message: "Developer Preview hiện chỉ hỗ trợ Windows native." };
    const binary = process.env.MOTIONREAL_OPENCODE_BIN?.trim();
    if (!binary || !existsSync(binary)) return { state: "blocked", message: "Thiếu OpenCode binary đã kiểm chứng." };
    if (!this.localApiKey()?.trim()) return { state: "blocked", message: "9router chưa chuẩn bị credential nội bộ cho Agent." };
    try {
      const [openCodeVersion, routerVersion] = await Promise.all([
        commandOutput(binary, ["--version"], agentRoot()),
        nineRouterVersion(agentRoot()),
      ]);
      if (!isSupportedVideoAgentRuntime(openCodeVersion, routerVersion)) return { state: "blocked", message: "OpenCode hoặc 9router không đúng runtime đã kiểm chứng." };
    } catch (error) { void error; return { state: "blocked", message: "Không thể kiểm tra OpenCode hoặc 9router runtime." }; }
    const addresses = await this.gatewayAddresses().catch((error) => { void error; return []; });
    if (!isLoopbackOnly(addresses)) return { state: "blocked", message: "Agent bị khóa: 9router phải chỉ lắng nghe 127.0.0.1 hoặc ::1." };
    return { state: "ready", message: "Developer Preview sẵn sàng.", model: VIDEO_AGENT_MODEL };
  }

  async list(): Promise<AgentSessionVM[]> { return (await loadSessions()).map(({ scope: _scope, opencodeSessionId: _oid, ...view }) => view).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  async open(project?: AgentProjectContext): Promise<AgentSessionVM> {
    const rows = await loadSessions(); const scope = project ? "project" : "idea"; let row = rows.find((item) => item.scope === scope && item.projectId === project?.projectId);
    if (!row) { const now = new Date().toISOString(); row = { id: randomUUID(), scope, ...(project ? { projectId: project.projectId } : {}), title: project?.title ?? "Ý tưởng mới", updatedAt: now }; rows.push(row); await saveSessions(rows); }
    this.#contexts.set(row.id, project); return { id: row.id, ...(row.projectId ? { projectId: row.projectId } : {}), title: row.title, updatedAt: row.updatedAt };
  }
  async history(id: string): Promise<AgentMessageVM[]> { const row = (await loadSessions()).find((item) => item.id === requireId(id)); if (!row?.opencodeSessionId) return []; await this.ensure(row); return await this.messages(this.#active!.base, row.opencodeSessionId, this.#active!.directory); }
  async proposal(id: string): Promise<AgentProposalVM | null> { const context = this.#contexts.get(requireId(id)); try { return normalizeAgentProposal(JSON.parse(await readFile(join(sessionDir(id), "proposal.json"), "utf8")), context); } catch (error) { void error; return null; } }
  async prompt(id: string, text: string): Promise<void> {
    const row = (await loadSessions()).find((item) => item.id === requireId(id)); if (!row) throw new Error("Không tìm thấy phiên Agent."); const message = cleanText(text, 12_000); if (!message) throw new Error("Tin nhắn Agent trống."); await this.ensure(row); const active = this.#active!; const user: AgentMessageVM = { id: randomUUID(), role: "user", text: message, createdAt: new Date().toISOString() }; this.emit({ sessionId: id, kind: "message", text: user.text, message: user }); this.emit({ sessionId: id, kind: "status", text: "Agent đang suy nghĩ…" });
    await this.fetchJson(active.base, `/session/${encodeURIComponent(row.opencodeSessionId!)}/prompt_async`, { method: "POST", body: JSON.stringify({ model: { providerID: "ninerouter", modelID: VIDEO_AGENT_MODEL }, agent: "motionreal-video", parts: [{ type: "text", text: `${systemPrompt(this.#contexts.get(id))}\n\nUser: ${message}` }] }) }, active.directory);
    await this.waitIdle(active.base, row.opencodeSessionId!, active.directory); const after = await this.messages(active.base, row.opencodeSessionId!, active.directory); const reply = [...after].reverse().find((entry) => entry.role === "assistant"); if (reply) this.emit({ sessionId: id, kind: "message", text: reply.text, message: reply }); const p = await this.proposal(id); if (p) this.emit({ sessionId: id, kind: "tool", text: "Agent đã tạo đề xuất để bạn duyệt." });
  }
  async abort(id: string): Promise<void> { const row = (await loadSessions()).find((item) => item.id === requireId(id)); if (row?.opencodeSessionId && this.#active?.sessionId === id) await this.fetchJson(this.#active.base, `/session/${encodeURIComponent(row.opencodeSessionId)}/abort`, { method: "POST" }, this.#active.directory).catch((error) => { void error; return undefined; }); this.emit({ sessionId: id, kind: "status", text: "Đã gửi yêu cầu dừng Agent." }); }
  async forget(id: string): Promise<void> { id = requireId(id); if (this.#active?.sessionId === id) await this.dispose(); await rm(sessionDir(id), { recursive: true, force: true }); await saveSessions((await loadSessions()).filter((row) => row.id !== id)); this.#contexts.delete(id); }
  async dispose(): Promise<void> { const active = this.#active; this.#active = undefined; if (!active) return; await this.fetchJson(active.base, "/instance/dispose", { method: "POST" }, active.directory).catch((error) => { void error; return undefined; }); if (active.child.pid && process.platform === "win32") await new Promise<void>((done) => { const child = spawn("taskkill", ["/pid", String(active.child.pid), "/t", "/f"], { windowsHide: true }); child.once("exit", () => done()); child.once("error", () => done()); }); else active.child.kill(); }

  private async ensure(row: StoredSession): Promise<void> {
    if (this.#active?.sessionId === row.id) return; await this.dispose(); const preflight = await this.preflight(); if (preflight.state !== "ready") throw new Error(preflight.message); const directory = sessionDir(row.id); const configDir = join(directory, "config"); await mkdir(join(directory, ".opencode", "tools"), { recursive: true }); await mkdir(configDir, { recursive: true }); await writeFile(join(directory, "AGENTS.md"), "# MotionReal Video Agent\nUse only websearch and motionreal_submit_proposal. Never claim a proposal was applied.\n"); await writeFile(join(configDir, "opencode.json"), `${JSON.stringify(config(), null, 2)}\n`); await writeFile(join(directory, ".opencode", "tools", "motionreal_submit_proposal.ts"), toolSource(this.#contexts.get(row.id))); await prewarm(directory);
    const apiKey = this.localApiKey(); if (!apiKey) throw new Error("9router chưa có credential nội bộ."); const binary = process.env.MOTIONREAL_OPENCODE_BIN!; const password = randomBytes(32).toString("base64url"); const port = await freePort(); const child = spawn(binary, ["serve", "--pure", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: directory, windowsHide: true, stdio: "pipe", env: { ...process.env, HOME: join(directory, "opencode-home"), USERPROFILE: join(directory, "opencode-home"), APPDATA: join(directory, "opencode-home"), LOCALAPPDATA: join(directory, "opencode-home"), OPENCODE_CONFIG: join(configDir, "opencode.json"), OPENCODE_CONFIG_DIR: join(directory, ".opencode"), OPENCODE_DISABLE_PROJECT_CONFIG: "1", OPENCODE_DISABLE_CLAUDE_CODE: "1", OPENCODE_DISABLE_DEFAULT_PLUGINS: "1", OPENCODE_DISABLE_AUTOUPDATE: "1", OPENCODE_ENABLE_EXA: "1", OPENCODE_SERVER_PASSWORD: password, [API_KEY_ENV]: apiKey } }); const base = `http://127.0.0.1:${port}`; this.#active = { sessionId: row.id, base, directory, password, child }; await this.waitHealth(base); const doc = await this.fetchText(base, "/doc", directory); if (!doc.includes("/session") || !doc.includes("/event")) throw new Error("OpenCode runtime thiếu route cần thiết."); const effectiveConfig = await this.fetchJson<unknown>(base, "/config", undefined, directory); if (JSON.stringify(effectiveConfig).includes("AI_CONTRACT.md")) throw new Error("OpenCode config isolation thất bại."); const catalog = await this.fetchJson<unknown>(base, `/experimental/tool?provider=ninerouter&model=${encodeURIComponent(VIDEO_AGENT_MODEL)}`, undefined, directory); if (!isExactAgentCatalog(catalog)) throw new Error("OpenCode tool catalog không đúng allow-list Video Agent."); if (!row.opencodeSessionId) { const created = await this.fetchJson<{ id?: string }>(base, "/session", { method: "POST", body: JSON.stringify({ title: row.title }) }, directory); if (!created.id) throw new Error("Không tạo được phiên OpenCode."); row.opencodeSessionId = created.id; row.updatedAt = new Date().toISOString(); const rows = await loadSessions(); const at = rows.findIndex((item) => item.id === row.id); if (at >= 0) { rows[at] = row; await saveSessions(rows); } }
  }
  private headers(directory: string, headers?: HeadersInit): Headers { const merged = new Headers(headers); merged.set("x-opencode-directory", directory); merged.set("authorization", `Basic ${Buffer.from(`opencode:${this.#active?.password ?? ""}`).toString("base64")}`); return merged; }
  private async fetchText(base: string, path: string, directory: string, init?: RequestInit): Promise<string> { const response = await fetch(`${base}${path}`, { ...init, headers: this.headers(directory, init?.headers), signal: AbortSignal.timeout(30_000) }); const body = await response.text(); if (!response.ok) throw new Error(`Agent sidecar error (${response.status}).`); return body; }
  private async fetchJson<T>(base: string, path: string, init?: RequestInit, directory?: string): Promise<T> { const text = await this.fetchText(base, path, directory ?? this.#active!.directory, init); return (text ? JSON.parse(text) : undefined) as T; }
  private async waitHealth(base: string): Promise<void> { for (let i = 0; i < 120; i += 1) { try { const health = await this.fetchJson<{ healthy?: boolean }>(base, "/global/health", undefined, this.#active!.directory); if (health.healthy) return; } catch (error) { void error; } await sleep(250); } throw new Error("OpenCode sidecar không khởi động."); }
  private async waitIdle(base: string, session: string, directory: string): Promise<void> { let busy = false; for (let i = 0; i < 360; i += 1) { const status = await this.fetchJson<Record<string, unknown>>(base, "/session/status", undefined, directory); const text = JSON.stringify(status[session] ?? ""); if (/busy|running|pending/i.test(text)) busy = true; else if (busy) return; await sleep(250); } throw new Error("Agent không hoàn thành đúng thời hạn."); }
  private async messages(base: string, session: string, directory: string): Promise<AgentMessageVM[]> { const raw = await this.fetchJson<unknown>(base, `/session/${encodeURIComponent(session)}/message`, undefined, directory); if (!Array.isArray(raw)) return []; return raw.flatMap((item, index) => { const record = item as { info?: { id?: string; role?: string; time?: { created?: number } }; parts?: Array<{ type?: string; text?: string }> }; const role = record?.info?.role; const text = record?.parts?.filter((part) => part.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n").trim() ?? ""; return (role === "user" || role === "assistant") && text ? [{ id: record.info?.id ?? `${index}`, role, text: cleanText(text, 12_000), createdAt: new Date(record.info?.time?.created ?? Date.now()).toISOString() } satisfies AgentMessageVM] : []; }); }
}

async function defaultGatewayAddresses(): Promise<string[]> {
  const command = "(Get-NetTCPConnection -LocalPort 20128 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalAddress) -join ','";
  const output = await commandOutput(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `powershell.exe -NoProfile -Command \"${command}\"`], process.cwd());
  return output.split(",").map((item) => item.trim()).filter(Boolean);
}
