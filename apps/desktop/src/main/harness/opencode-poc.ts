/**
 * Experimental, headless-only verification of OpenCode through the local
 * 9router gateway. This intentionally has no IPC/UI entry point.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { basename, isAbsolute, join, resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { buildNineRouterGatewayDeps } from "../gateway/ninerouter-deps.js";
import { NineRouterClient } from "../gateway/ninerouter-client.js";

const OPENCODE_VERSION = "1.15.11";
const OPENCODE_SHA = "d2bd7ea";
const PROBE_MARKER = "MR-PROBE-7K42";
const TOOL_NAMES = ["motionreal_probe_write", "motionreal_probe_read", "webfetch", "websearch"] as const;
const BLOCKED_TOOLS = new Set(["bash", "read", "write", "edit", "patch", "task", "skill"]);

type FailedAt = "opencode_server" | "provider_request" | "tool_loop" | "attachment" | "web_tool" | "session_resume";
type SuspectedLayer = "OpenCode" | "9router" | "model" | "unknown";
type Assertion = { name: string; pass: boolean; detail?: string };

export type OpenCodePocReport = {
  kind: "motionreal-opencode-poc";
  version: string;
  upstreamSha: string;
  modelId?: string;
  credentialMode: "no-api-key" | "credential-bridge-needed";
  port?: number;
  startedAt: string;
  durationMs: number;
  assertions: Assertion[];
  eventCounts: Record<string, number>;
  notes: string[];
  status: "pass" | "fail";
  failedAt?: FailedAt;
  suspectedLayer?: SuspectedLayer;
  errors?: string[];
};

export type OpenCodePocOptions = {
  /** Defaults to `VIDEO_TOOL_HOME/.video-tool/agent-probes`. */
  root?: string;
  /** Optional direct 9router model id; otherwise first non-combo model is used. */
  modelId?: string;
  /** Exact executable to use. Omit to use the pinned npm package. */
  opencodeBin?: string;
};

type ModelRef = { providerID: string; modelID: string };
type ServerEvent = { type: string; value: unknown };

class PocFailure extends Error {
  constructor(
    readonly failedAt: FailedAt,
    readonly suspectedLayer: SuspectedLayer,
    message: string,
  ) {
    super(message);
  }
}

/** A custom tool must never receive anything other than the single probe file. */
export function validateProbeTarget(target: string): string {
  if (typeof target !== "string" || target.length === 0 || target.length > 64) throw new Error("invalid probe target");
  if (isAbsolute(target) || target.includes("..") || target.includes("/") || target.includes("\\") || target !== "agent-note.txt") {
    throw new Error("probe target must be agent-note.txt inside the current run");
  }
  return target;
}

/** Keep the report useful without persisting API keys, prompts, or endpoint query strings. */
export function scrubPocError(error: unknown): string {
  return String(error instanceof Error ? error.message : error)
    .replace(/Bearer\s+[^\s,]+/gi, "Bearer [redacted]")
    .replace(/([?&](?:key|token|api[_-]?key)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/[A-Za-z0-9_-]{30,}/g, "[redacted]")
    .slice(0, 600);
}

function videoToolHome(): string {
  const configured = process.env.VIDEO_TOOL_HOME?.trim();
  const base = configured && configured.length > 0 ? configured : ".video-tool";
  const absolute = isAbsolute(base) ? base : resolve(process.cwd(), base);
  return absolute.endsWith(".video-tool") ? absolute : join(absolute, ".video-tool");
}

function probeRoot(options: OpenCodePocOptions): string {
  return options.root ?? join(videoToolHome(), "agent-probes");
}

function directModel(models: { id: string }[], requested?: string): string {
  if (requested) {
    if (!models.some((model) => model.id === requested)) throw new Error(`Requested 9router model is not advertised: ${requested}`);
    if (/combo/i.test(requested)) throw new Error("9router combo models are intentionally unsupported by this POC");
    return requested;
  }
  const selected = models.find((model) => !/combo/i.test(model.id));
  if (!selected) throw new Error("9router advertised no direct (non-combo) model");
  return selected.id;
}

function modelRef(modelID: string): ModelRef {
  return { providerID: "ninerouter", modelID };
}

function commandFor(bin?: string): { command: string; args: string[] } {
  if (bin) return { command: bin, args: [] };
  const npmCli = process.env.npm_execpath;
  if (npmCli && existsSync(npmCli)) {
    return { command: process.execPath, args: [npmCli, "exec", "--yes", `--package=opencode-ai@${OPENCODE_VERSION}`, "--", "opencode"] };
  }
  // Pinning by package version avoids silently moving to the globally installed
  // OpenCode. npm reuses its cache after the first invocation; no source is vendored.
  return {
    command: process.platform === "win32" ? "npm.cmd" : "npm",
    args: ["exec", "--yes", `--package=opencode-ai@${OPENCODE_VERSION}`, "--", "opencode"],
  };
}

async function commandOutput(command: string, args: string[], cwd: string): Promise<string> {
  return await new Promise<string>((resolveResult, reject) => {
    const child = spawn(command, args, { cwd, shell: process.platform === "win32" && /\.cmd$/i.test(command), windowsHide: true });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolveResult(output.trim()) : reject(new Error(output.trim() || `exit ${code}`))));
  });
}

async function prewarmCustomToolDependencies(runDir: string): Promise<void> {
  const args = ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--save-exact", `@opencode-ai/plugin@${OPENCODE_VERSION}`];
  // OpenCode 1.15.11 otherwise starts this install in a detached background
  // task, then its tool catalog waits for it without a usable server timeout.
  // Keep the dependency confined to this run and make the wait explicit.
  for (const directory of [join(runDir, ".opencode"), join(runDir, "opencode-home", "opencode")]) {
    await mkdir(directory, { recursive: true });
    const packagePath = join(directory, "package.json");
    if (!existsSync(packagePath)) await writeFile(packagePath, '{"private":true}\n', "utf8");
    if (process.platform === "win32") {
      await commandOutput(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `npm.cmd ${args.join(" ")}`], directory);
    } else {
      await commandOutput("npm", args, directory);
    }
    if (!existsSync(join(directory, "node_modules", "@opencode-ai", "plugin", "package.json"))) {
      throw new Error(`custom-tool dependency did not install in ${directory}`);
    }
  }
}

async function freePort(): Promise<number> {
  return await new Promise<number>((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => (error ? reject(error) : typeof address === "object" && address ? resolvePort(address.port) : reject(new Error("no loopback port"))));
    });
  });
}

async function sleep(ms: number): Promise<void> {
  await new Promise((done) => setTimeout(done, ms));
}

export function opencodeInstanceHeaders(directory: string, headers?: HeadersInit): Headers {
  const merged = new Headers(headers);
  merged.set("x-opencode-directory", directory);
  return merged;
}

async function fetchJson<T>(url: string, init?: RequestInit, directory?: string): Promise<T> {
  const response = await fetch(url, {
    ...init,
    ...(directory ? { headers: opencodeInstanceHeaders(directory, init?.headers) } : {}),
    signal: init?.signal ?? AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`${init?.method ?? "GET"} ${new URL(url).pathname} → HTTP ${response.status}`);
  return (await response.json()) as T;
}

async function runtimeCatalog(base: string, modelID: string, directory: string): Promise<unknown> {
  const deadline = Date.now() + 45_000;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      return await fetchJson<unknown>(`${base}/experimental/tool?provider=ninerouter&model=${encodeURIComponent(modelID)}`, undefined, directory);
    } catch (error) {
      last = error;
      await sleep(500);
    }
  }
  throw new PocFailure("opencode_server", "OpenCode", `runtime tool catalog unavailable: ${scrubPocError(last)}`);
}

async function postJson<T>(base: string, path: string, body?: unknown, directory?: string): Promise<T> {
  return await fetchJson<T>(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, directory);
}

async function waitForHealth(base: string, timeoutMs = 30_000): Promise<{ healthy: boolean; version: string }> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const health = await fetchJson<{ healthy: boolean; version: string }>(`${base}/global/health`);
      if (health.healthy) return health;
    } catch (error) {
      last = error;
    }
    await sleep(250);
  }
  throw new Error(`OpenCode health timeout: ${scrubPocError(last)}`);
}

class EventFeed {
  readonly events: ServerEvent[] = [];
  readonly counts: Record<string, number> = {};
  #controller = new AbortController();
  #task: Promise<void> | undefined;

  start(url: string): void {
    this.#task = this.consume(url).catch(() => undefined);
  }

  stop(): void {
    this.#controller.abort();
  }

  private async consume(url: string): Promise<void> {
    const response = await fetch(url, { headers: { accept: "text/event-stream" }, signal: this.#controller.signal });
    if (!response.ok || !response.body) throw new Error(`SSE unavailable: HTTP ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    while (!this.#controller.signal.aborted) {
      const part = await reader.read();
      if (part.done) return;
      pending += decoder.decode(part.value, { stream: true });
      let boundary: number;
      while ((boundary = pending.indexOf("\n\n")) >= 0) {
        const block = pending.slice(0, boundary);
        pending = pending.slice(boundary + 2);
        const data = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n");
        if (!data) continue;
        let value: unknown = data;
        try {
          value = JSON.parse(data) as unknown;
        } catch {
          // Only the event type/count is recorded; malformed event data is ignored.
        }
        const type = eventType(value);
        this.events.push({ type, value });
        this.counts[type] = (this.counts[type] ?? 0) + 1;
      }
    }
  }
}

function eventType(value: unknown): string {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.type === "string") return record.type;
    if (typeof record.event === "string") return record.event;
  }
  return "unknown";
}

function findPermissionID(value: unknown, withinPermission = false): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const permission = withinPermission || /permission/i.test(eventType(value));
  for (const key of ["permissionID", "permissionId", "id"]) {
    if (typeof record[key] === "string" && permission) return record[key] as string;
  }
  for (const child of Object.values(record)) {
    const found = findPermissionID(child, permission);
    if (found) return found;
  }
  return undefined;
}

async function waitForPermissionAndApprove(base: string, feed: EventFeed, sessionID: string, directory: string): Promise<boolean> {
  const deadline = Date.now() + 60_000;
  let seen = 0;
  while (Date.now() < deadline) {
    for (const event of feed.events.slice(seen)) {
      seen += 1;
      if (!/permission/i.test(event.type)) continue;
      const permissionID = findPermissionID(event.value);
      if (!permissionID) continue;
      await postJson<boolean>(base, `/session/${encodeURIComponent(sessionID)}/permissions/${encodeURIComponent(permissionID)}`, {
        response: "once",
        remember: false,
      }, directory);
      return true;
    }
    await sleep(100);
  }
  return false;
}

async function waitForIdle(base: string, sessionID: string, directory: string, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await fetchJson<Record<string, unknown>>(`${base}/session/status`, undefined, directory);
    const current = status[sessionID];
    const text = JSON.stringify(current ?? "");
    if (!/busy|running|pending/i.test(text)) return;
    await sleep(250);
  }
  throw new Error("session did not become idle");
}

function containsTool(value: unknown, tool: string): boolean {
  if (typeof value === "string") return value === tool;
  if (!value || typeof value !== "object") return false;
  return Object.values(value as Record<string, unknown>).some((child) => containsTool(child, tool));
}

function extractStrings(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (typeof value === "string") into.add(value);
  else if (Array.isArray(value)) value.forEach((item) => extractStrings(item, into));
  else if (value && typeof value === "object") Object.values(value as Record<string, unknown>).forEach((item) => extractStrings(item, into));
  return into;
}

function agentPermissionAction(agent: unknown, permission: string): string | undefined {
  if (!agent || typeof agent !== "object") return undefined;
  const rules = (agent as { permission?: unknown }).permission;
  if (!Array.isArray(rules)) return undefined;
  const exact = rules.filter(
    (rule): rule is { permission: string; action: string } =>
      !!rule && typeof rule === "object" && (rule as { permission?: unknown }).permission === permission && typeof (rule as { action?: unknown }).action === "string",
  );
  const fallback = rules.filter(
    (rule): rule is { permission: string; action: string } =>
      !!rule && typeof rule === "object" && (rule as { permission?: unknown }).permission === "*" && typeof (rule as { action?: unknown }).action === "string",
  );
  return exact.at(-1)?.action ?? fallback.at(-1)?.action;
}

async function messageParts(base: string, sessionID: string, directory: string): Promise<unknown> {
  return await fetchJson<unknown>(`${base}/session/${encodeURIComponent(sessionID)}/message`, undefined, directory);
}

function makeRuntimeConfig(modelID: string): Record<string, unknown> {
  const deny = "deny";
  return {
    "$schema": "https://opencode.ai/config.json",
    autoupdate: false,
    enabled_providers: ["ninerouter"],
    default_agent: "motionreal-video",
    model: `ninerouter/${modelID}`,
    provider: {
      ninerouter: {
        name: "9router local gateway (no API key)",
        npm: "@ai-sdk/openai-compatible",
        options: { baseURL: "http://127.0.0.1:20128/v1" },
        models: {
          [modelID]: {
            name: modelID,
            tool_call: true,
            modalities: { input: ["text", "image"], output: ["text"] },
          },
        },
      },
    },
    permission: {
      "*": deny,
      bash: deny,
      read: deny,
      edit: deny,
      patch: deny,
      write: deny,
      external_directory: deny,
      task: deny,
      skill: deny,
      motionreal_probe_write: "ask",
      motionreal_probe_read: "allow",
      webfetch: "allow",
      websearch: "allow",
    },
    agent: {
      "motionreal-video": {
        mode: "primary",
        model: `ninerouter/${modelID}`,
        steps: 12,
      },
    },
  };
}

function customToolSource(kind: "write" | "read"): string {
  const base = `
import { tool } from "@opencode-ai/plugin";
import { isAbsolute, join, resolve } from "node:path";
${kind === "write" ? 'import { writeFile } from "node:fs/promises";' : 'import { readFile } from "node:fs/promises";'}
const MAX_BYTES = 1024;
function target(directory, target) {
  if (typeof target !== "string" || target !== "agent-note.txt" || isAbsolute(target) || target.includes("..") || target.includes("/") || target.includes("\\\\")) throw new Error("blocked probe target");
  const path = resolve(directory, target);
  if (path !== join(directory, "agent-note.txt")) throw new Error("blocked probe path");
  return path;
}
`;
  return kind === "write"
    ? `${base}
export default tool({
  description: "Write one short probe marker to agent-note.txt in this run only.",
  args: { target: tool.schema.string(), content: tool.schema.string() },
  async execute(args, context) {
    const path = target(context.directory, args.target);
    if (Buffer.byteLength(args.content, "utf8") > MAX_BYTES) throw new Error("probe payload too large");
    await writeFile(path, args.content, "utf8");
    return "probe write complete";
  },
});
`
    : `${base}
export default tool({
  description: "Read the single probe marker from agent-note.txt in this run only.",
  args: { target: tool.schema.string() },
  async execute(args, context) { return await readFile(target(context.directory, args.target), "utf8"); },
});
`;
}

const VISION_GLYPHS: Record<string, string[]> = {
  M: ["10001", "11011", "10101", "10001", "10001", "10001", "10001"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "4": ["10010", "10010", "10010", "11111", "00010", "00010", "00010"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
};

function crc32(input: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}

/** Creates a dependency-free PNG with the marker visibly drawn at lower-right. */
export function createVisionFixturePng(): Buffer {
  const width = 800;
  const height = 480;
  const pixels = Buffer.alloc(width * height * 4);
  for (let index = 0; index < pixels.length; index += 4) pixels.set([9, 20, 36, 255], index);
  const scale = 10;
  const spacing = 2;
  const labelWidth = PROBE_MARKER.length * (5 + spacing) * scale - spacing * scale;
  const left = width - labelWidth - 44;
  const top = height - 7 * scale - 44;
  for (const [characterIndex, character] of [...PROBE_MARKER].entries()) {
    const glyph = VISION_GLYPHS[character];
    if (!glyph) continue;
    for (const [row, cells] of glyph.entries()) {
      for (const [column, cell] of [...cells].entries()) {
        if (cell !== "1") continue;
        for (let y = 0; y < scale; y += 1) {
          for (let x = 0; x < scale; x += 1) {
            const offset = ((top + row * scale + y) * width + left + characterIndex * (5 + spacing) * scale + column * scale + x) * 4;
            pixels.set([65, 246, 184, 255], offset);
          }
        }
      }
    }
  }
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA, no interlace
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
}

async function writeSandbox(runDir: string, modelID: string): Promise<string> {
  const configDir = join(runDir, "config");
  const toolsDir = join(runDir, ".opencode", "tools");
  await Promise.all([mkdir(configDir, { recursive: true }), mkdir(toolsDir, { recursive: true })]);
  await writeFile(
    join(runDir, "AGENTS.md"),
    "# MotionReal OpenCode POC\nOnly use the explicitly allowed probe and web tools. This is an isolated verification run, not a project authoring workspace.\n",
    "utf8",
  );
  await writeFile(join(configDir, "opencode.json"), `${JSON.stringify(makeRuntimeConfig(modelID), null, 2)}\n`, "utf8");
  await writeFile(join(toolsDir, "motionreal_probe_write.ts"), customToolSource("write"), "utf8");
  await writeFile(join(toolsDir, "motionreal_probe_read.ts"), customToolSource("read"), "utf8");
  await writeFile(join(runDir, "vision-mr-probe-7k42.png"), createVisionFixturePng());
  return configDir;
}

function startServer(command: string, args: string[], runDir: string, configDir: string, port: number): ChildProcessWithoutNullStreams {
  const isolatedHome = join(runDir, "opencode-home");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: isolatedHome,
    USERPROFILE: isolatedHome,
    APPDATA: isolatedHome,
    LOCALAPPDATA: isolatedHome,
    XDG_CONFIG_HOME: isolatedHome,
    OPENCODE_CONFIG: join(configDir, "opencode.json"),
    OPENCODE_CONFIG_DIR: join(runDir, ".opencode"),
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_DISABLE_CLAUDE_CODE: "1",
    OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_ENABLE_EXA: "1",
  };
  return spawn(command, [...args, "serve", "--pure", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: runDir,
    env,
    // npm.cmd is the pinned-package launcher on Windows; direct user-supplied
    // OpenCode executables remain shell-free.
    shell: process.platform === "win32" && /\.cmd$/i.test(command),
    windowsHide: true,
    stdio: "pipe",
  });
}

async function dispose(base: string, child?: ChildProcessWithoutNullStreams, directory?: string): Promise<void> {
  await postJson<boolean>(base, "/instance/dispose", undefined, directory).catch(() => undefined);
  if (!child || child.killed) return;
  if (process.platform !== "win32" || !child.pid) {
    child.kill();
    return;
  }
  // `npm.cmd` inserts cmd.exe between this runner and opencode.exe. Terminate
  // only that known child tree so an aborted POC cannot leave a sidecar behind.
  await new Promise<void>((done) => {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { shell: false, windowsHide: true });
    killer.once("error", () => done());
    killer.once("exit", () => done());
  });
}

async function startWithRetry(command: string, args: string[], runDir: string, configDir: string): Promise<{ child: ChildProcessWithoutNullStreams; base: string; port: number; health: { healthy: boolean; version: string } }> {
  let error: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const port = await freePort();
    const child = startServer(command, args, runDir, configDir, port);
    const base = `http://127.0.0.1:${port}`;
    try {
      const health = await waitForHealth(base);
      return { child, base, port, health };
    } catch (caught) {
      error = caught;
      await dispose(base, child, runDir);
      if (!/EADDRINUSE/i.test(String(caught))) break;
    }
  }
  throw new PocFailure("opencode_server", "OpenCode", `Cannot start OpenCode: ${scrubPocError(error)}`);
}

function addAssertion(report: OpenCodePocReport, name: string, pass: boolean, detail?: string): void {
  report.assertions.push({ name, pass, ...(detail ? { detail } : {}) });
  if (!pass) throw new Error(`${name}: ${detail ?? "failed"}`);
}

async function sendPrompt(base: string, sessionID: string, model: ModelRef, parts: unknown[], directory: string): Promise<void> {
  await postJson<unknown>(base, `/session/${encodeURIComponent(sessionID)}/prompt_async`, {
    model,
    agent: "motionreal-video",
    parts,
  }, directory);
}

/** Run the exact Phase-1 verification and always leave a scrubbed report.json. */
export async function runOpenCodePoc(options: OpenCodePocOptions = {}): Promise<OpenCodePocReport> {
  const started = Date.now();
  const runDir = join(probeRoot(options), `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`);
  const report: OpenCodePocReport = {
    kind: "motionreal-opencode-poc",
    version: OPENCODE_VERSION,
    upstreamSha: OPENCODE_SHA,
    credentialMode: "no-api-key",
    startedAt: new Date(started).toISOString(),
    durationMs: 0,
    assertions: [],
    eventCounts: {},
    notes: ["websearch verification sends its fixed query to Exa-hosted web search when OPENCODE_ENABLE_EXA=1."],
    status: "fail",
  };
  let base: string | undefined;
  let child: ChildProcessWithoutNullStreams | undefined;
  let feed: EventFeed | undefined;
  try {
    await mkdir(runDir, { recursive: true });
    const cmd = commandFor(options.opencodeBin ?? process.env.MOTIONREAL_OPENCODE_BIN);
    const actualVersion = await commandOutput(cmd.command, [...cmd.args, "--version"], runDir);
    addAssertion(report, "pinned-opencode", actualVersion === OPENCODE_VERSION, `expected ${OPENCODE_VERSION}, got ${actualVersion || "none"}`);

    const nrClient = new NineRouterClient();
    const gateway = buildNineRouterGatewayDeps({ client: nrClient, openExternal: () => undefined });
    const gatewayReady = await gateway.launch(); // launcher only; deliberately bypasses its legacy key-minting hook.
    if (!gatewayReady) throw new PocFailure("provider_request", "9router", "9router gateway did not become reachable");
    const modelID = directModel(await nrClient.listModels(), options.modelId ?? process.env.MOTIONREAL_9ROUTER_MODEL);
    report.modelId = modelID;
    addAssertion(report, "direct-9router-model", !/combo/i.test(modelID), modelID);

    const configDir = await writeSandbox(runDir, modelID);
    await prewarmCustomToolDependencies(runDir);
    report.notes.push("Custom-tool dependency preflight completed before OpenCode server start.");
    ({ child, base, port: report.port } = await startWithRetry(cmd.command, cmd.args, runDir, configDir));
    const doc = await fetch(`${base}/doc`, { signal: AbortSignal.timeout(15_000) }).then((response) => response.text());
    addAssertion(report, "runtime-openapi", doc.includes("/session") && doc.includes("/event"), doc.includes("/session") && doc.includes("/event") ? "required routes verified" : "server /doc lacks required routes");

    const effectiveConfig = await fetchJson<unknown>(`${base}/config`, undefined, runDir);
    const configIsolated = !JSON.stringify(effectiveConfig).includes("AI_CONTRACT.md");
    addAssertion(report, "isolated-config", configIsolated, configIsolated ? "sandbox config only" : "parent repository rule leaked into effective config");
    const agents = await fetchJson<unknown[]>(`${base}/agent`, undefined, runDir);
    const videoAgent = agents.find((agent) => !!agent && typeof agent === "object" && (agent as { name?: unknown }).name === "motionreal-video");
    for (const tool of BLOCKED_TOOLS) {
      const denied = agentPermissionAction(videoAgent, tool) === "deny";
      addAssertion(report, `agent-denies-${tool}`, denied, denied ? "effective agent policy is deny" : "agent policy does not deny this tool");
    }
    const catalog = await runtimeCatalog(base, modelID, runDir);
    const catalogStrings = extractStrings(catalog);
    for (const tool of TOOL_NAMES) {
      const present = catalogStrings.has(tool);
      addAssertion(report, `catalog-${tool}`, present, present ? "tool available" : "tool missing from runtime catalog");
    }
    const exposed = [...BLOCKED_TOOLS].filter((tool) => catalogStrings.has(tool));
    for (const tool of BLOCKED_TOOLS) report.assertions.push({ name: `catalog-blocks-${tool}`, pass: !catalogStrings.has(tool), detail: catalogStrings.has(tool) ? "blocked built-in is exposed" : "not exposed" });
    if (exposed.length > 0) {
      throw new PocFailure(
        "opencode_server",
        "OpenCode",
        `OpenCode ${OPENCODE_VERSION} exposes denied built-ins in its experimental tool catalog: ${exposed.join(", ")}`,
      );
    }

    feed = new EventFeed();
    feed.start(`${base}/event`);
    const session = await postJson<{ id?: string }>(base, "/session", { title: "motionreal-opencode-poc" }, runDir);
    if (!session.id) throw new PocFailure("opencode_server", "OpenCode", "OpenCode did not return a session id");
    const sessionID = session.id;
    const model = modelRef(modelID);

    await sendPrompt(base, sessionID, model, [
      {
        type: "text",
        text: `Use motionreal_probe_write exactly once with target agent-note.txt and content ${PROBE_MARKER}. Wait for approval, then call motionreal_probe_read with target agent-note.txt. Reply only after the read tool returns the exact marker.`,
      },
    ], runDir);
    const approved = await waitForPermissionAndApprove(base, feed, sessionID, runDir);
    addAssertion(report, "permission-request-and-approval", approved, "no permission request received for probe write");
    await waitForIdle(base, sessionID, runDir);
    const note = await readFile(join(runDir, "agent-note.txt"), "utf8").catch(() => "");
    addAssertion(report, "sandbox-file-written", note === PROBE_MARKER, "probe file missing or marker changed");
    const loopMessages = await messageParts(base, sessionID, runDir);
    addAssertion(report, "tool-result-round-trip", containsTool(loopMessages, "motionreal_probe_read") && JSON.stringify(loopMessages).includes(PROBE_MARKER), "probe read/result absent");
    let outsideRejected = false;
    try {
      validateProbeTarget("../outside.txt");
    } catch {
      outsideRejected = true;
    }
    addAssertion(report, "probe-boundary", outsideRejected, "probe target validator accepted traversal");

    await sendPrompt(base, sessionID, model, [{ type: "text", text: "Reply exactly: SESSION-TURN-ONE" }], runDir);
    await waitForIdle(base, sessionID, runDir);
    await dispose(base, child, runDir);
    child = undefined;
    ({ child, base, port: report.port } = await startWithRetry(cmd.command, cmd.args, runDir, configDir));
    const resumed = await fetchJson<{ id?: string }>(`${base}/session/${encodeURIComponent(sessionID)}`, undefined, runDir);
    addAssertion(report, "session-resume-history", resumed.id === sessionID, "session did not survive sidecar restart");
    feed.stop();
    feed = new EventFeed();
    feed.start(`${base}/event`);
    await sendPrompt(base, sessionID, model, [{ type: "text", text: "Reply exactly: SESSION-TURN-TWO" }], runDir);
    await waitForIdle(base, sessionID, runDir);
    addAssertion(report, "session-second-turn", JSON.stringify(await messageParts(base, sessionID, runDir)).includes("SESSION-TURN-TWO"), "resumed session lost second turn");

    await sendPrompt(base, sessionID, model, [{ type: "text", text: "Call webfetch on https://example.com and then websearch for the exact query MotionReal OpenCode POC. State when both tool calls finish." }], runDir);
    await waitForIdle(base, sessionID, runDir);
    const webMessages = await messageParts(base, sessionID, runDir);
    addAssertion(report, "webfetch-and-websearch", containsTool(webMessages, "webfetch") && containsTool(webMessages, "websearch"), "one or both fixed web tools did not run");

    const fixture = await readFile(join(runDir, "vision-mr-probe-7k42.png"));
    await sendPrompt(base, sessionID, model, [
      { type: "text", text: "Inspect the attached PNG. Reply with its exact marker and its relative position (lower-right)." },
      { type: "file", mime: "image/png", filename: "vision-mr-probe-7k42.png", url: `data:image/png;base64,${fixture.toString("base64")}` },
    ], runDir);
    await waitForIdle(base, sessionID, runDir);
    const visionText = JSON.stringify(await messageParts(base, sessionID, runDir)).toLowerCase();
    addAssertion(report, "vision-marker-and-position", visionText.includes(PROBE_MARKER.toLowerCase()) && /lower.{0,12}right|góc.{0,12}phải/i.test(visionText), "vision answer did not identify marker at lower-right");

    const abortSession = await postJson<{ id?: string }>(base, "/session", { title: "motionreal-opencode-abort" }, runDir);
    if (!abortSession.id) throw new PocFailure("opencode_server", "OpenCode", "abort session creation failed");
    await sendPrompt(base, abortSession.id, model, [{ type: "text", text: "Call websearch for MotionReal abort probe, then summarize." }], runDir);
    await postJson<boolean>(base, `/session/${encodeURIComponent(abortSession.id)}/abort`, undefined, runDir);
    await messageParts(base, abortSession.id, runDir);
    addAssertion(report, "abort-and-session-integrity", true);

    report.eventCounts = { ...feed.counts };
    addAssertion(report, "sse-events", Object.keys(report.eventCounts).length > 0, "no server-sent events observed");
    report.status = "pass";
  } catch (error) {
    const message = scrubPocError(error);
    if (/api key|unauthori[sz]ed|HTTP 401|HTTP 403/i.test(message)) {
      report.credentialMode = "credential-bridge-needed";
    }
    const failure = error instanceof PocFailure ? error : undefined;
    report.failedAt = failure?.failedAt ?? (message.includes("vision") ? "attachment" : message.includes("web") ? "web_tool" : "tool_loop");
    report.suspectedLayer = failure?.suspectedLayer ?? "unknown";
    report.errors = [message];
  } finally {
    if (feed) {
      feed.stop();
      report.eventCounts = { ...feed.counts };
    }
    if (base || child) await dispose(base ?? "http://127.0.0.1:0", child, runDir);
    report.durationMs = Date.now() - started;
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  return report;
}

export function formatPocResult(report: OpenCodePocReport): string {
  const output = report.status === "pass" ? "PASS" : `FAIL at ${report.failedAt ?? "unknown"}`;
  return `[opencode-poc] ${output}; report: ${basename("report.json")}; model: ${report.modelId ?? "not selected"}`;
}
