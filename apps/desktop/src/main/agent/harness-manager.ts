import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createLogger, MAX_IMAGE_BYTES, MAX_IMAGE_DIM, resolveEffectiveDuration, sniffImage, writeJson } from "@motionreal/pipeline";
import type { SceneImageRole } from "@motionreal/schema";
import type { AgentAssetVM, AgentBriefInput, AgentBriefVM, AgentChatEvent, AgentChatPageVM, AgentDraftVM, DurationTierChoice, VideoLanguageChoice, VoiceProviderChoice } from "../../shared/types.js";
import { sanitizedChildEnvironment } from "../security/runtime-security.js";
import {
  initialAgentWorkflow,
  parseAgentWorkflow,
  transitionAgentWorkflow,
  type AgentWorkflowRecord,
  type AgentWorkflowTransition,
} from "./agent-workflow.js";
import { projectHarnessHistory, projectHarnessMuxEnvelope } from "./harness-chat.js";
import { AUTHORING_CONTRACT } from "../authoring/contract-text.js";
import {
  buildHarnessAuthoringPacing,
  validateHarnessManifestPacing,
  type HarnessAuthoringPacing,
} from "./harness-authoring-pacing.js";
import {
  AUTHORING_V1_DIR,
  archiveHarnessAuthoringV1,
  assertHarnessCreativeRewrite,
} from "./harness-creative-rewrite.js";

const METADATA_FILE = "motionreal-agent.json";
const CREATE_REQUEST_FILE = "motionreal.create.json";
const ASSET_REQUEST_FILE = join("handoff", "assets-request.json");
const ASSET_MANIFEST_FILE = join("handoff", "assets.json");
const BRIEF_REQUEST_FILE = join("handoff", "brief-request.json");
const BRIEF_FILE = join("handoff", "brief.json");
const AUTHORING_REQUEST_FILE = join("handoff", "authoring-request.json");
const AUTHORING_CONTRACT_FILE = join("handoff", "authoring-contract.md");
const PROJECT_LINK = "project";
const HARNESS_PATCH_FILE = "motionreal-tools.patch.yml";
const AGENTS_FILE = "AGENTS.md";
const AI_CONTRACT_FILE = "AI_CONTRACT.md";
// A brand-new DSH_HOME initializes the web profile on its first launch. The
// checked-in Harness build needs roughly 30s on this Windows machine, so 20s
// was a false failure even though the child was about to become healthy.
const START_TIMEOUT_MS = 60_000;
const PROCESS_OUTPUT_LIMIT = 4_096;
const AUTHORING_POLL_MS = 500;
const log = createLogger("harness");

export type { AgentDraftVM } from "../../shared/types.js";

type DraftRecord = Omit<AgentDraftVM, "harnessUrl" | "webSearchConfigured" | "createReady" | "assetReview" | "assetCollectionError" | "briefReview" | "briefReviewError"> & AgentWorkflowRecord & {
  workspaceId?: string;
  sessionId?: string;
  assetRequestRevision?: number;
  briefRequestRevision?: number;
  authoringRequestRevision?: number;
};

export type AgentCreateRequest = {
  draftId: string;
  title: string;
  prompt: string;
  assets: Array<{ id: string; path: string; role: SceneImageRole }>;
  choices: {
    durationTier: DurationTierChoice;
    videoLanguage: VideoLanguageChoice;
    voiceProvider: VoiceProviderChoice;
  };
};

type HarnessRpcResponse = {
  result?: { ok?: boolean; value?: unknown; error?: { message?: unknown } };
};

export type HarnessManagerDeps = {
  draftsRoot: string;
  harnessHome: string;
  harnessCliPath: string;
  submissionPluginPath: string;
  spawn?: typeof spawn;
  fetch?: typeof fetch;
  findPort?: () => Promise<number>;
  now?: () => Date;
  nodeExecutable?: string;
  mediaUrl?: (path: string) => string | null;
  defaultVoiceProvider?: () => VoiceProviderChoice;
  wordsPerSecond?: (projectId: string) => Promise<number | undefined>;
  onChatEvent?: (event: AgentChatEvent) => void;
  openWebSocket?: (url: string) => WebSocket;
  renderAuthoringStills?: (
    projectId: string,
    sceneIds: string[],
  ) => Promise<{ ok: true; stills: string[] } | { ok: false; error: string }>;
  acceptAuthoringStills?: (projectId: string) => Promise<void>;
};

/**
 * One DeepSeek Harness runtime shared by every video draft. Each draft remains
 * a separate filesystem Workspace while the Harness process and profile boot
 * only once for the desktop app.
 */
export class HarnessManager {
  private active: { child: ChildProcess; url: string } | null = null;
  private activeDraftId: string | null = null;
  private startingChild: ChildProcess | null = null;
  private startInFlight: Promise<string> | null = null;
  private eventSocket: WebSocket | null = null;
  private eventReconnect: ReturnType<typeof setTimeout> | null = null;
  private webSearchConfigured: boolean | undefined;
  private readonly draftBySession = new Map<string, string>();
  private readonly spawnChild: typeof spawn;
  private readonly fetchImpl: typeof fetch;
  private readonly findPort: () => Promise<number>;
  private readonly now: () => Date;
  private readonly nodeExecutable: string;
  private readonly openWebSocket: (url: string) => WebSocket;
  private readonly authoringInFlight = new Set<string>();
  private readonly authoringPolls = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly deps: HarnessManagerDeps) {
    this.spawnChild = deps.spawn ?? spawn;
    this.fetchImpl = deps.fetch ?? fetch;
    this.findPort = deps.findPort ?? findLoopbackPort;
    this.now = deps.now ?? (() => new Date());
    this.openWebSocket = deps.openWebSocket ?? ((url) => new WebSocket(url));
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
    const record: DraftRecord = {
      id,
      title: normalized,
      createdAt: this.now().toISOString(),
      sessionId: `session-${randomUUID()}`,
      ...initialAgentWorkflow(),
    };
    await mkdir(join(root, "assets"), { recursive: true });
    await this.writeRecord(record);
    await writeFile(join(root, AGENTS_FILE), agentInstructions(normalized), "utf8");
    await writeFile(join(root, AI_CONTRACT_FILE), agentContract(), "utf8");
    return this.toVm(record);
  }

  async start(apiKey: string): Promise<string> {
    if (!apiKey.trim()) throw new Error("Chưa lấy được khóa nội bộ của 9router để khởi động Harness.");
    if (this.active) return this.active.url;
    if (this.startInFlight) return this.startInFlight;
    this.startInFlight = this.startRuntime(apiKey).finally(() => {
      this.startInFlight = null;
    });
    return this.startInFlight;
  }

  async activate(id: string, apiKey: string): Promise<AgentDraftVM> {
    let record = await this.mustReadRecord(id);
    // Dev VIDEO_TOOL_HOME can live below the MotionReal repository. A local
    // contract prevents parent rule discovery from resolving AI_CONTRACT.md
    // against the isolated Agent workspace and failing its first file read.
    await writeFile(join(this.rootOf(id), AI_CONTRACT_FILE), agentContract(), "utf8");
    const url = await this.start(apiKey);
    const workspace = await this.rpc(url, "workspace.create", { path: this.rootOf(id) });
    const workspaceInfo = workspaceInfoOf(workspace);
    try {
      await this.rpc(url, "workspace.rename", { workspaceId: workspaceInfo.id, title: record.title });
    } catch (error) {
      if (!isWorkspaceNameConflict(error)) throw error;
      await this.rpc(url, "workspace.rename", {
        workspaceId: workspaceInfo.id,
        title: `${record.title} · ${record.id.slice(-8)}`,
      });
    }
    const sessionId = record.sessionId ?? `session-${randomUUID()}`;
    await this.rpc(url, "session.create", { workspaceId: workspaceInfo.id, sessionId });
    this.webSearchConfigured = await this.readSearchCredentialStatus(url);
    record = { ...record, workspaceId: workspaceInfo.id, sessionId };
    await this.writeRecord(record);
    this.draftBySession.set(sessionId, id);
    this.activeDraftId = id;
    if (record.productionState === "authoring") this.scheduleAuthoringPoll(record.id);
    return this.toVm(record);
  }

  private async startRuntime(apiKey: string): Promise<string> {
    if (!existsSync(this.deps.harnessCliPath)) {
      throw new Error("Chưa tìm thấy DeepSeek Harness. Cài/built Harness hoặc đặt MOTIONREAL_DSH_CLI.");
    }
    if (!existsSync(this.deps.submissionPluginPath)) {
      throw new Error("Chưa build tool submission của MotionReal. Chạy lại build desktop rồi thử lại.");
    }
    await mkdir(this.deps.draftsRoot, { recursive: true });
    await mkdir(this.deps.harnessHome, { recursive: true });
    await writeFile(join(this.deps.harnessHome, "settings.yaml"), harnessSettings(), "utf8");
    const patchPath = join(this.deps.harnessHome, HARNESS_PATCH_FILE);
    await writeFile(patchPath, harnessToolsPatch(this.deps.submissionPluginPath), "utf8");
    const port = await this.findPort();
    const url = `http://127.0.0.1:${port}/`;
    const child = this.spawnChild(
      this.nodeExecutable,
      [this.deps.harnessCliPath, "web", "--patch", patchPath, "--host", "127.0.0.1", "--port", String(port), "--no-open"],
      {
        cwd: this.deps.draftsRoot,
        env: {
          ...sanitizedChildEnvironment(),
          DSH_HOME: this.deps.harnessHome,
          NINEROUTER_API_KEY: apiKey,
          DSH_PERMISSION_MODE: "danger-full-access",
          MOTIONREAL_AGENT_DRAFTS_ROOT: this.deps.draftsRoot,
        },
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
      },
    );
    this.startingChild = child;
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
      if (this.active?.child === child) {
        const failedDraftId = this.activeDraftId;
        this.active = null;
        this.activeDraftId = null;
        this.webSearchConfigured = undefined;
        this.stopEventStream();
        if (failedDraftId) {
          this.deps.onChatEvent?.({ draftId: failedDraftId, type: "error", code: "stream_failed" });
        }
      }
      if (this.startingChild === child) this.startingChild = null;
    });
    try {
      await waitForHarness(url, this.fetchImpl, () => startupFailure);
      this.startingChild = null;
      this.active = { child, url };
      started = true;
      this.startEventStream(url);
      return url;
    } catch (error) {
      if (this.startingChild === child) this.startingChild = null;
      stopping = true;
      await stopChild(child);
      throw error;
    }
  }

  async status(id: string): Promise<AgentDraftVM> {
    let record = await this.mustReadRecord(id);
    let assetReview: AgentAssetVM[] | undefined;
    let assetCollectionError: string | undefined;
    let briefReview: AgentBriefVM | undefined;
    let briefReviewError: string | undefined;
    if (record.productionState === "collecting_assets" || record.productionState === "asset_review" || record.productionState === "brief_review") {
      try {
        assetReview = await this.readAssetManifest(record);
        if (assetReview && record.productionState === "collecting_assets") {
          record = { ...record, ...transitionAgentWorkflow(record, {
            expectedRevision: record.workflowRevision,
            to: "asset_review",
            jobId: record.activeJobId,
          }) };
          await this.writeRecord(record);
        }
      } catch (error) {
        assetCollectionError = error instanceof Error ? error.message : "Manifest asset không hợp lệ.";
      }
    }
    if (record.productionState === "brief_review" || record.productionState === "queued_create") {
      try {
        briefReview = await this.readBrief(record);
      } catch (error) {
        briefReviewError = error instanceof Error ? error.message : "Brief của Agent không hợp lệ.";
      }
    }
    if (record.productionState === "authoring") this.maybeProcessAuthoring(record);
    return this.toVm(record, assetReview, assetCollectionError, briefReview, briefReviewError);
  }

  async chatHistory(id: string, beforeSeq?: number): Promise<AgentChatPageVM> {
    const record = await this.mustReadRecord(id);
    this.requireActiveSession(record);
    try {
      const value = await this.rpc(this.active!.url, "session.history", {
        sessionId: record.sessionId,
        maxMessages: 80,
        ...(Number.isSafeInteger(beforeSeq) && Number(beforeSeq) >= 0 ? { beforeSeq: Number(beforeSeq) } : {}),
      });
      return projectHarnessHistory(value);
    } catch (error) {
      throw safeChatError(error, "Không tải được lịch sử Agent.");
    }
  }

  /** Resolve a renderer-projected tool path without allowing workspace escape. */
  async revealFilePath(id: string, target: string): Promise<string> {
    const record = await this.mustReadRecord(id);
    if (typeof target !== "string" || !target.trim() || isAbsolute(target)) throw new Error("Đường dẫn tệp Agent không hợp lệ.");
    const root = resolve(this.rootOf(record.id));
    const candidate = resolve(root, target);
    const lexical = relative(root, candidate);
    if (!lexical || lexical.startsWith("..") || isAbsolute(lexical)) throw new Error("Tệp Agent nằm ngoài workspace.");
    const info = await stat(candidate).catch((_error) => null);
    if (!info?.isFile()) throw new Error("Không tìm thấy tệp Agent.");
    const [realRoot, realFile] = await Promise.all([realpath(root), realpath(candidate)]);
    const realRel = relative(realRoot, realFile);
    if (!realRel || realRel.startsWith("..") || isAbsolute(realRel)) throw new Error("Tệp Agent nằm ngoài workspace.");
    return realFile;
  }

  async sendChatPrompt(id: string, text: string): Promise<void> {
    const record = await this.mustReadRecord(id);
    const prompt = text.trim();
    if (!prompt) throw new Error("Hãy nhập nội dung trước khi gửi.");
    if (prompt.length > 20_000) throw new Error("Tin nhắn vượt giới hạn 20.000 ký tự.");
    try {
      await this.promptSession(record, prompt);
    } catch (error) {
      throw safeChatError(error, "Agent chưa nhận được tin nhắn. Hãy thử lại.");
    }
  }

  async abortChat(id: string): Promise<void> {
    const record = await this.mustReadRecord(id);
    this.requireActiveSession(record);
    try {
      await this.rpc(this.active!.url, "session.cancel", { sessionId: record.sessionId });
    } catch (error) {
      throw safeChatError(error, "Không dừng được lượt Agent hiện tại.");
    }
  }

  async prepareAssets(id: string, expectedRevision: number): Promise<AgentDraftVM> {
    const current = await this.mustReadRecord(id);
    this.requireActiveSession(current);
    const jobId = `job-${randomUUID()}`;
    const next = {
      ...current,
      ...transitionAgentWorkflow(current, { expectedRevision, to: "collecting_assets", jobId }),
      assetRequestRevision: 1,
      selectedAssetIds: undefined,
    };
    await this.writeAssetRequest(next, "Tìm và tải các hình ảnh phù hợp nhất với video đã trao đổi.");
    await this.writeRecord(next);
    try {
      await this.promptSession(next, "MotionReal đã bắt đầu bước chuẩn bị asset. Hãy đọc handoff/assets-request.json, hoàn thành yêu cầu và gọi motionreal_submit_assets; không tự ghi handoff/assets.json.");
    } catch (error) {
      await this.recordWorkflowError(next, error);
      throw error;
    }
    return this.toVm(next);
  }

  async requestMoreAssets(
    id: string,
    expectedRevision: number,
    selectedIds: string[],
    note: string,
  ): Promise<AgentDraftVM> {
    const current = await this.mustReadRecord(id);
    this.requireActiveSession(current);
    const assets = await this.readAssetManifest(current);
    if (!assets) throw new Error("Agent chưa gửi manifest asset hợp lệ.");
    const selected = validateSelectedIds(selectedIds, assets);
    const request = note.trim().slice(0, 1_000);
    if (!request) throw new Error("Hãy mô tả ảnh cần tìm thêm hoặc thay thế.");
    const next = {
      ...current,
      ...transitionAgentWorkflow(current, {
        expectedRevision,
        to: "collecting_assets",
        jobId: current.activeJobId,
      }),
      assetRequestRevision: (current.assetRequestRevision ?? 1) + 1,
      selectedAssetIds: selected,
    };
    await this.writeAssetRequest(next, request);
    await this.writeRecord(next);
    try {
      await this.promptSession(next, "MotionReal yêu cầu bổ sung asset. Hãy đọc phiên bản mới của handoff/assets-request.json, hoàn thành yêu cầu và gọi motionreal_submit_assets; không tự ghi handoff/assets.json.");
    } catch (error) {
      await this.recordWorkflowError(next, error);
      throw error;
    }
    return this.toVm(next);
  }

  async approveAssets(id: string, expectedRevision: number, selectedIds: string[]): Promise<AgentDraftVM> {
    const current = await this.mustReadRecord(id);
    this.requireActiveSession(current);
    const assets = await this.readAssetManifest(current);
    if (!assets) throw new Error("Agent chưa gửi manifest asset hợp lệ.");
    const selectedAssetIds = validateSelectedIds(selectedIds, assets);
    if (sameIds(selectedAssetIds, current.selectedAssetIds ?? []) && current.briefRequestRevision) {
      const previousBrief = await this.readBrief(current).catch((_error) => undefined);
      if (previousBrief) {
        const next = {
          ...current,
          ...transitionAgentWorkflow(current, {
            expectedRevision,
            to: "brief_review",
            jobId: current.activeJobId,
          }),
          selectedAssetIds,
        };
        await this.writeRecord(next);
        return this.toVm(next, assets, undefined, previousBrief);
      }
    }
    const next = {
      ...current,
      ...transitionAgentWorkflow(current, {
        expectedRevision,
        to: "brief_review",
        jobId: current.activeJobId,
      }),
      selectedAssetIds,
      briefRequestRevision: (current.briefRequestRevision ?? 0) + 1,
    };
    await this.writeBriefRequest(next);
    await this.writeRecord(next);
    try {
      await this.promptSession(next, "MotionReal đã chốt asset. Hãy đọc handoff/brief-request.json, tạo brief và gọi motionreal_submit_brief; không tự ghi handoff/brief.json.");
    } catch (error) {
      return this.toVm(next, assets, undefined, undefined, safeBriefError(error));
    }
    return this.toVm(next, assets);
  }

  async prepareBrief(id: string, expectedRevision: number): Promise<AgentDraftVM> {
    const current = await this.mustReadRecord(id);
    this.requireActiveSession(current);
    if (current.productionState !== "brief_review" || current.workflowRevision !== expectedRevision) {
      throw new Error("Trạng thái duyệt brief đã thay đổi; hãy tải lại.");
    }
    if (!current.selectedAssetIds) throw new Error("Chưa có lựa chọn asset để tạo brief.");
    const next = { ...current, briefRequestRevision: (current.briefRequestRevision ?? 0) + 1 };
    await this.writeBriefRequest(next);
    await this.writeRecord(next);
    try {
      await this.promptSession(next, "MotionReal yêu cầu tạo lại brief. Hãy đọc phiên bản mới của handoff/brief-request.json, hoàn thành brief và gọi motionreal_submit_brief; không tự ghi handoff/brief.json.");
    } catch (error) {
      return this.toVm(next, undefined, undefined, undefined, safeBriefError(error));
    }
    return this.toVm(next);
  }

  async returnToAssets(id: string, expectedRevision: number): Promise<AgentDraftVM> {
    const current = await this.mustReadRecord(id);
    const assets = await this.readAssetManifest(current);
    if (!assets) throw new Error("Không còn manifest asset hợp lệ để quay lại.");
    const next = {
      ...current,
      ...transitionAgentWorkflow(current, {
        expectedRevision,
        to: "asset_review",
        jobId: current.activeJobId,
      }),
    };
    await this.writeRecord(next);
    return this.toVm(next, assets);
  }

  async approveBrief(id: string, expectedRevision: number, input: AgentBriefInput): Promise<AgentDraftVM> {
    const current = await this.mustReadRecord(id);
    if (current.productionState !== "brief_review" || current.workflowRevision !== expectedRevision) {
      throw new Error("Trạng thái duyệt brief đã thay đổi; hãy tải lại.");
    }
    const generated = await this.readBrief(current);
    if (!generated) throw new Error("Agent chưa gửi brief hợp lệ.");
    const accepted = validateBriefInput(input);
    const targetSeconds = resolveEffectiveDuration({ prompt: "", durationTier: accepted.durationTier }).targetSeconds;
    const revision = generated.revision + (briefChanged(generated, accepted) ? 1 : 0);
    await writeJson(join(this.rootOf(id), BRIEF_FILE), {
      version: 1,
      job_id: current.activeJobId,
      request_revision: current.briefRequestRevision,
      brief_revision: revision,
      title: accepted.title,
      prompt: accepted.prompt,
      format: "tiktok",
      duration_tier: accepted.durationTier,
      target_seconds: targetSeconds,
      video_language: accepted.videoLanguage,
      voice_provider: accepted.voiceProvider,
      selected_asset_ids: generated.selectedAssetIds,
      accepted: true,
    });
    await writeJson(join(this.rootOf(id), CREATE_REQUEST_FILE), {
      version: 1,
      title: accepted.title,
      prompt: accepted.prompt,
      duration_tier: accepted.durationTier,
      target_seconds: targetSeconds,
      video_language: accepted.videoLanguage,
      voice_provider: accepted.voiceProvider,
      selected_asset_ids: generated.selectedAssetIds,
    });
    const next = {
      ...current,
      ...transitionAgentWorkflow(current, {
        expectedRevision,
        to: "queued_create",
        jobId: current.activeJobId,
      }),
    };
    await this.writeRecord(next);
    return this.toVm(next, undefined, undefined, { ...generated, ...accepted, revision });
  }

  async transitionWorkflow(id: string, request: AgentWorkflowTransition): Promise<AgentDraftVM> {
    const current = await this.mustReadRecord(id);
    const next = { ...current, ...transitionAgentWorkflow(current, request) };
    await this.writeRecord(next);
    return this.toVm(next);
  }

  async readCreateRequest(id: string): Promise<AgentCreateRequest> {
    const record = await this.mustReadRecord(id);
    if (record.productionState !== "queued_create") {
      throw new Error("Yêu cầu tạo video chưa qua bước duyệt brief.");
    }
    const path = join(this.rootOf(record.id), CREATE_REQUEST_FILE);
    let raw: unknown;
    try {
      raw = parseJson(await readFile(path, "utf8"));
    } catch (_error) {
      throw new Error("Agent chưa tạo yêu cầu dựng video hợp lệ.");
    }
    if (!raw || typeof raw !== "object") throw new Error("Yêu cầu dựng video của Agent không hợp lệ.");
    const input = raw as { version?: unknown; title?: unknown; prompt?: unknown; duration_tier?: unknown; video_language?: unknown; voice_provider?: unknown; selected_asset_ids?: unknown };
    if (input.version !== 1 || typeof input.prompt !== "string" || !input.prompt.trim()) {
      throw new Error("Yêu cầu dựng video của Agent thiếu nội dung.");
    }
    if (input.prompt.length > 20_000) throw new Error("Yêu cầu dựng video quá dài.");
    const brief = validateBriefFields(input);
    const assets = await this.assetPathsForIds(record, input.selected_asset_ids);
    return {
      draftId: record.id,
      title: validBriefText(input.title, "tiêu đề", 1, 160),
      prompt: input.prompt.trim(),
      assets,
      choices: {
        durationTier: brief.durationTier,
        videoLanguage: brief.videoLanguage,
        voiceProvider: brief.voiceProvider,
      },
    };
  }

  async linkProject(id: string, projectId: string): Promise<void> {
    const record = await this.mustReadRecord(id);
    if (record.projectId) {
      if (record.projectId === projectId) return;
      throw new Error("Video Agent đã được liên kết với một project khác.");
    }
    if (record.productionState !== "queued_create") throw new Error("Brief chưa sẵn sàng để tạo project.");
    await this.writeRecord({
      ...record,
      ...transitionAgentWorkflow(record, {
        expectedRevision: record.workflowRevision,
        to: "authoring",
        jobId: record.activeJobId,
      }),
      projectId,
    });
  }

  async startAuthoring(
    id: string,
    projectId: string,
    projectRoot: string,
    assets: Array<{ id: string; ref: string; role: SceneImageRole }>,
  ): Promise<void> {
    const current = await this.mustReadRecord(id);
    this.requireActiveSession(current);
    if (current.productionState !== "authoring" || current.projectId !== projectId) {
      throw new Error("Project Harness chưa sẵn sàng để author scene.");
    }
    const root = this.rootOf(id);
    const link = join(root, PROJECT_LINK);
    const expectedProjectRoot = await realpath(projectRoot);
    if (existsSync(link)) {
      if (await realpath(link) !== expectedProjectRoot) throw new Error("Workspace Agent đang trỏ tới project khác.");
    } else {
      await symlink(expectedProjectRoot, link, "junction");
    }
    if (current.authoringRequestRevision && existsSync(join(root, AUTHORING_REQUEST_FILE))) {
      try {
        await this.promptSession(current, "MotionReal đang chờ authoring hiện tại. Hãy đọc lại handoff/authoring-request.json, tiếp tục sửa project/ và gọi motionreal_submit_authoring khi hoàn tất.");
      } finally {
        this.scheduleAuthoringPoll(current.id);
      }
      return;
    }
    const usableAssets: Array<{ id: string; ref: string; path: string; role: SceneImageRole }> = [];
    for (const asset of assets) {
      const projectAsset = resolve(expectedProjectRoot, asset.ref);
      const rel = relative(resolve(expectedProjectRoot, "assets"), projectAsset);
      if (!rel || rel.startsWith("..") || isAbsolute(rel)) continue;
      const info = await stat(projectAsset).catch((_error) => null);
      if (!info?.isFile()) continue;
      usableAssets.push({ id: asset.id, ref: asset.ref.replaceAll("\\", "/"), path: `${PROJECT_LINK}/${asset.ref.replaceAll("\\", "/")}`, role: asset.role });
    }
    const next = { ...current, authoringRequestRevision: (current.authoringRequestRevision ?? 0) + 1 };
    const pacing = await this.authoringPacing(current);
    await mkdir(join(root, "handoff"), { recursive: true });
    await writeFile(join(root, AUTHORING_CONTRACT_FILE), `${AUTHORING_CONTRACT}\n`, "utf8");
    await writeJson(join(root, AUTHORING_REQUEST_FILE), {
      version: 1,
      job_id: current.activeJobId,
      request_revision: next.authoringRequestRevision,
      phase: "initial",
      creative_stage: "v1",
      project: PROJECT_LINK,
      brief: "handoff/brief.json",
      asset_manifest: "handoff/assets.json",
      contract: "handoff/authoring-contract.md",
      manifest: `${PROJECT_LINK}/manifest.json`,
      authored_dir: `${PROJECT_LINK}/authored`,
      pacing,
      assets: usableAssets,
      instructions: [
        "Đọc brief, contract và xem trực tiếp từng asset trước khi author.",
        "pacing là contract có thẩm quyền; bỏ qua mọi câu duration mâu thuẫn nằm trong prompt của brief.",
        "Asset là pool tư liệu, không phải số lượng storyboard. Số cảnh và lượng narration phải theo pacing.",
        "Viết mới manifest.json và các module authored/*.tsx cho toàn video; không gọi API authoring cũ.",
        "Mỗi asset trong request phải xuất hiện qua scene.image.ref trong ít nhất một cảnh và scene.image.role phải giữ đúng role đã duyệt.",
        "Mỗi cảnh phải có một focal subject và hành động hình ảnh riêng; cấm dùng một shell/panel/HUD cố định cho toàn video.",
        "Mỗi cảnh trừ cảnh cuối phải khai báo transitionToNext phù hợp với quan hệ nội dung; không dựa vào transition mặc định.",
        "Đây là V1 định vị. Sau still đầu tiên, MotionReal sẽ bắt buộc một creative rewrite V2 trước khi cho người dùng duyệt.",
        "Không render video. Khi code đã hoàn chỉnh, gọi motionreal_submit_authoring để MotionReal validate và render still.",
      ],
    });
    await this.writeRecord(next);
    try {
      await this.promptSession(next, "MotionReal đã tạo project Harness. Hãy đọc handoff/authoring-request.json và handoff/authoring-contract.md, xem các asset thật, tự viết toàn bộ scene vào project/, rồi gọi motionreal_submit_authoring. Không dùng authoring API cũ.");
    } finally {
      this.scheduleAuthoringPoll(next.id);
    }
  }

  async requestSceneEdits(
    id: string,
    projectId: string,
    edits: unknown,
    globalNotes: unknown,
  ): Promise<void> {
    const current = await this.mustReadRecord(id);
    this.requireActiveSession(current);
    if (current.productionState !== "still_review" || current.projectId !== projectId) {
      throw new Error("Project Harness chưa ở bước duyệt cảnh.");
    }
    const root = this.rootOf(id);
    const submission = parseJson(await readFile(join(root, "handoff", "authoring.json"), "utf8")) as Record<string, unknown>;
    if (submission.version !== 1 || submission.job_id !== current.activeJobId
      || submission.request_revision !== current.authoringRequestRevision
      || !Array.isArray(submission.scene_ids)) {
      throw new Error("Không tìm thấy bản authoring Harness đã được duyệt.");
    }
    const sceneIds = submission.scene_ids.filter((value): value is string => typeof value === "string");
    if (sceneIds.length < 1 || sceneIds.length !== submission.scene_ids.length || new Set(sceneIds).size !== sceneIds.length) {
      throw new Error("Danh sách cảnh Harness không hợp lệ.");
    }
    if (!Array.isArray(edits)) throw new Error("Yêu cầu sửa cảnh không hợp lệ.");
    const perScene = edits
      .map((value) => {
        if (!value || typeof value !== "object") throw new Error("Yêu cầu sửa cảnh không hợp lệ.");
        const edit = value as Record<string, unknown>;
        if (typeof edit.sceneId !== "string" || typeof edit.text !== "string") {
          throw new Error("Yêu cầu sửa cảnh không hợp lệ.");
        }
        return { sceneId: edit.sceneId, text: edit.text.trim() };
      })
      .filter((edit) => edit.text.length > 0);
    if (new Set(perScene.map((edit) => edit.sceneId)).size !== perScene.length
      || perScene.some((edit) => !sceneIds.includes(edit.sceneId) || edit.text.length > 2_000)) {
      throw new Error("Yêu cầu sửa cảnh không hợp lệ.");
    }
    if (typeof globalNotes !== "string") throw new Error("Ghi chú cả video không hợp lệ.");
    const notes = globalNotes.trim();
    if (notes.length > 2_000) throw new Error("Ghi chú cả video vượt giới hạn 2.000 ký tự.");
    if (perScene.length === 0 && !notes) throw new Error("Hãy nhập ít nhất một yêu cầu chỉnh sửa.");
    const targetSceneIds = perScene.length > 0 ? perScene.map((edit) => edit.sceneId) : sceneIds;
    const authoring = {
      ...current,
      ...transitionAgentWorkflow(current, {
        expectedRevision: current.workflowRevision,
        to: "authoring",
        jobId: current.activeJobId,
      }),
    };
    try {
      await this.advanceAuthoringRequest(authoring, {
        phase: "edit",
        creative_stage: "edit",
        target_scene_ids: targetSceneIds,
        edit_request: { per_scene: perScene, global_notes: notes },
        render_error: undefined,
        instructions: [
          "Đọc edit_request và mở still hiện tại của các target_scene_ids trước khi sửa.",
          "Chỉ sửa scene được yêu cầu; giữ nguyên narration, thứ tự cảnh và các scene còn lại.",
          "Sửa trực tiếp project/authored/*.tsx. Khi hoàn tất, gọi motionreal_submit_authoring bằng request_revision mới.",
        ],
      }, "MotionReal đã nhận góp ý cảnh. Hãy đọc handoff/authoring-request.json, xem still liên quan, sửa trực tiếp scene trong project/ và submit lại. Không dùng authoring API cũ.");
    } finally {
      this.scheduleAuthoringPoll(current.id);
    }
  }

  async draftForProject(projectId: string): Promise<AgentDraftVM | null> {
    return (await this.list()).find((draft) => draft.projectId === projectId) ?? null;
  }

  async removeDraft(id: string): Promise<void> {
    const record = await this.mustReadRecord(id);
    this.stopAuthoringPoll(record.id);
    if (this.active && record.workspaceId) {
      const sessionIds = await this.workspaceSessionIds(record.workspaceId).catch((error) => {
        log.warn({ err: error, draftId: record.id }, "failed to list Harness sessions during draft deletion");
        return [];
      });
      for (const sessionId of sessionIds) {
        await this.rpc(this.active.url, "workspace.archiveSession", { sessionId }).catch((error) => {
          log.warn({ err: error, draftId: record.id }, "failed to archive Harness session during draft deletion");
        });
      }
      await this.rpc(this.active.url, "workspace.delete", { workspaceId: record.workspaceId }).catch((error) => {
        log.warn({ err: error, draftId: record.id }, "failed to remove Harness workspace registration");
      });
    }
    if (this.activeDraftId === record.id) this.activeDraftId = null;
    if (record.sessionId) this.draftBySession.delete(record.sessionId);
    await rm(this.rootOf(record.id), { recursive: true, force: true });
  }

  async dispose(): Promise<void> {
    const current = this.active;
    const starting = this.startingChild;
    this.active = null;
    this.activeDraftId = null;
    this.webSearchConfigured = undefined;
    this.startingChild = null;
    this.stopEventStream();
    for (const id of this.authoringPolls.keys()) this.stopAuthoringPoll(id);
    if (current) await stopChild(current.child);
    if (starting && starting !== current?.child) await stopChild(starting);
  }

  private async toVm(
    record: DraftRecord,
    assetReview?: AgentAssetVM[],
    assetCollectionError?: string,
    briefReview?: AgentBriefVM,
    briefReviewError?: string,
  ): Promise<AgentDraftVM> {
    const createReady = record.productionState === "queued_create"
      && existsSync(join(this.rootOf(record.id), CREATE_REQUEST_FILE));
    return {
      ...record,
      ...(this.active && this.activeDraftId === record.id && record.sessionId
        ? { harnessUrl: `${this.active.url}?session=${encodeURIComponent(record.sessionId)}` }
        : {}),
      ...(this.active && this.activeDraftId === record.id && this.webSearchConfigured !== undefined
        ? { webSearchConfigured: this.webSearchConfigured }
        : {}),
      createReady,
      ...(assetReview ? { assetReview } : {}),
      ...(assetCollectionError ? { assetCollectionError } : {}),
      ...(briefReview ? { briefReview } : {}),
      ...(briefReviewError ? { briefReviewError } : {}),
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
      const workflow = parseAgentWorkflow(raw as Record<string, unknown>);
      if (!workflow) return null;
      const record: DraftRecord = {
        id,
        title: raw.title,
        createdAt: raw.createdAt,
        ...workflow,
        ...(typeof raw.projectId === "string" ? { projectId: raw.projectId } : {}),
        ...(typeof raw.workspaceId === "string" ? { workspaceId: raw.workspaceId } : {}),
        ...(typeof raw.sessionId === "string" ? { sessionId: raw.sessionId } : {}),
        ...(Number.isSafeInteger(raw.assetRequestRevision) && Number(raw.assetRequestRevision) > 0
          ? { assetRequestRevision: Number(raw.assetRequestRevision) }
          : {}),
        ...(Number.isSafeInteger(raw.briefRequestRevision) && Number(raw.briefRequestRevision) > 0
          ? { briefRequestRevision: Number(raw.briefRequestRevision) }
          : {}),
        ...(Number.isSafeInteger(raw.authoringRequestRevision) && Number(raw.authoringRequestRevision) > 0
          ? { authoringRequestRevision: Number(raw.authoringRequestRevision) }
          : {}),
        ...(Array.isArray(raw.selectedAssetIds)
          ? { selectedAssetIds: raw.selectedAssetIds.filter((value): value is string => typeof value === "string") }
          : {}),
      };
      if (record.sessionId) this.draftBySession.set(record.sessionId, record.id);
      return record;
    } catch (_error) {
      return null;
    }
  }

  private writeRecord(record: DraftRecord): Promise<void> {
    return writeJson(join(this.rootOf(record.id), METADATA_FILE), record);
  }

  private rootOf(id: string): string {
    return join(this.deps.draftsRoot, id);
  }

  private requireActiveSession(record: DraftRecord): void {
    if (!this.active || this.activeDraftId !== record.id || !record.sessionId) {
      throw new Error("Hãy mở workspace Agent trước khi chuẩn bị asset.");
    }
  }

  private promptSession(record: DraftRecord, text: string): Promise<unknown> {
    this.requireActiveSession(record);
    return this.rpc(this.active!.url, "session.prompt", {
      sessionId: record.sessionId,
      mode: "queue",
      content: [{ type: "text", text }],
    });
  }

  async setSearchApiKey(id: string, apiKey: string): Promise<AgentDraftVM> {
    const record = await this.mustReadRecord(id);
    this.requireActiveSession(record);
    const value = apiKey.trim();
    if (value.length < 8 || value.length > 4_096) {
      throw new Error("API key tìm kiếm không hợp lệ.");
    }
    await this.rpc(this.active!.url, "credentials.set", {
      ref: "DEEPSEEK_API_KEY",
      value,
    });
    this.webSearchConfigured = await this.readSearchCredentialStatus(this.active!.url);
    if (!this.webSearchConfigured) throw new Error("Harness chưa lưu được API key tìm kiếm.");
    return this.toVm(record);
  }

  private async readSearchCredentialStatus(url: string): Promise<boolean> {
    const value = await this.rpc(url, "credentials.describe", { refs: ["DEEPSEEK_API_KEY"] });
    if (!value || typeof value !== "object") return false;
    const credentials = (value as { credentials?: unknown }).credentials;
    if (!credentials || typeof credentials !== "object") return false;
    const search = (credentials as Record<string, unknown>).DEEPSEEK_API_KEY;
    return Boolean(search && typeof search === "object" && (search as { configured?: unknown }).configured === true);
  }

  private startEventStream(url: string): void {
    if (!this.deps.onChatEvent) return;
    this.stopEventStream();
    const wsUrl = new URL("api/events.mux", url);
    wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
    const socket = this.openWebSocket(wsUrl.href);
    this.eventSocket = socket;
    socket.addEventListener("message", (message) => {
      if (this.eventSocket !== socket || typeof message.data !== "string") return;
      let envelope: unknown;
      try {
        envelope = JSON.parse(message.data);
      } catch (_error) {
        return;
      }
      const projected = projectHarnessMuxEnvelope(envelope, (sessionId) => this.draftBySession.get(sessionId));
      if (projected) this.deps.onChatEvent?.(projected);
      else if (isStreamErrorEnvelope(envelope) && this.activeDraftId) {
        this.deps.onChatEvent?.({ draftId: this.activeDraftId, type: "error", code: "stream_failed" });
      }
    });
    socket.addEventListener("close", () => {
      if (this.eventSocket !== socket) return;
      this.eventSocket = null;
      if (this.active?.url !== url) return;
      if (this.activeDraftId) {
        this.deps.onChatEvent?.({ draftId: this.activeDraftId, type: "error", code: "stream_failed" });
      }
      this.eventReconnect = setTimeout(() => {
        this.eventReconnect = null;
        if (this.active?.url === url) this.startEventStream(url);
      }, 750);
    });
  }

  private stopEventStream(): void {
    if (this.eventReconnect) clearTimeout(this.eventReconnect);
    this.eventReconnect = null;
    const socket = this.eventSocket;
    this.eventSocket = null;
    socket?.close();
  }

  private async writeAssetRequest(record: DraftRecord, note: string): Promise<void> {
    await mkdir(join(this.rootOf(record.id), "handoff"), { recursive: true });
    await writeJson(join(this.rootOf(record.id), ASSET_REQUEST_FILE), {
      version: 1,
      job_id: record.activeJobId,
      request_revision: record.assetRequestRevision,
      note,
      keep_asset_ids: record.selectedAssetIds ?? [],
      output: "handoff/assets.json",
      manifest: {
        version: 1,
        job_id: record.activeJobId,
        request_revision: record.assetRequestRevision,
        items: [{ id: "asset-01", path: "assets/example.png", source_url: "https://example.com/image", label: "Mô tả ngắn", role: "support" }],
      },
      instructions: [
        "Tải ảnh raster PNG/JPEG/GIF/WebP vào assets/. Logo nên là PNG nền trong suốt; SVG ngoài phải rasterize an toàn sang PNG hoặc bỏ qua.",
        "Gắn role cho từng asset: hero, support, logo hoặc icon. Role mô tả cách hiển thị, không phải kích thước file.",
        "Giữ lại các asset id được yêu cầu nếu chúng vẫn có trong manifest mới.",
        "Gọi motionreal_submit_assets với manifest hoàn chỉnh; không tự ghi file output.",
      ],
    });
  }

  private async writeBriefRequest(record: DraftRecord): Promise<void> {
    const voiceProvider = this.deps.defaultVoiceProvider?.() ?? "vivibe";
    await mkdir(join(this.rootOf(record.id), "handoff"), { recursive: true });
    await writeJson(join(this.rootOf(record.id), BRIEF_REQUEST_FILE), {
      version: 1,
      job_id: record.activeJobId,
      request_revision: record.briefRequestRevision,
      selected_asset_ids: record.selectedAssetIds ?? [],
      asset_manifest: "handoff/assets.json",
      output: "handoff/brief.json",
      duration_options: ([1, 2, 3, 4] as const).map((durationTier) => ({
        duration_tier: durationTier,
        target_seconds: resolveEffectiveDuration({ prompt: "", durationTier }).targetSeconds,
      })),
      brief: {
        version: 1,
        job_id: record.activeJobId,
        request_revision: record.briefRequestRevision,
        brief_revision: 1,
        title: record.title,
        prompt: "Brief hoàn chỉnh dùng trực tiếp để tạo video",
        format: "tiktok",
        duration_tier: 1,
        video_language: "vi",
        voice_provider: voiceProvider,
        selected_asset_ids: record.selectedAssetIds ?? [],
      },
      instructions: [
        "Tổng hợp cuộc trò chuyện và chỉ các asset đã chọn thành brief tạo video 9:16.",
        "Chọn duration_tier theo duration_options và viết mạch kể đủ cho target_seconds tương ứng; không tự suy đoán tier 1 là 15 giây.",
        "Prompt phải mô tả nội dung, mạch kể, art direction và cách dùng asset đủ rõ cho pipeline authoring.",
        "Gọi motionreal_submit_brief với brief hoàn chỉnh; không tự ghi file output.",
      ],
    });
  }

  private async readBrief(record: DraftRecord): Promise<AgentBriefVM | undefined> {
    const path = join(this.rootOf(record.id), BRIEF_FILE);
    if (!existsSync(path)) return undefined;
    let raw: unknown;
    try {
      raw = parseJson(await readFile(path, "utf8"));
    } catch (_error) {
      throw new Error("Brief chưa phải JSON hoàn chỉnh.");
    }
    if (!raw || typeof raw !== "object") throw new Error("Brief của Agent không hợp lệ.");
    const value = raw as Record<string, unknown>;
    if (value.version !== 1 || value.job_id !== record.activeJobId || value.request_revision !== record.briefRequestRevision) {
      throw new Error("Brief không khớp job hoặc lượt yêu cầu hiện tại.");
    }
    if (!Number.isSafeInteger(value.brief_revision) || Number(value.brief_revision) < 1) {
      throw new Error("Brief thiếu revision hợp lệ.");
    }
    if (value.format !== "tiktok") throw new Error("Brief phải dùng định dạng video dọc 9:16.");
    const fields = validateBriefFields(value);
    const selectedAssetIds = validateBriefAssetIds(value.selected_asset_ids, record.selectedAssetIds ?? []);
    return {
      revision: Number(value.brief_revision),
      title: validBriefText(value.title, "tiêu đề", 1, 160),
      prompt: validBriefText(value.prompt, "nội dung", 20, 20_000),
      format: "tiktok",
      ...fields,
      selectedAssetIds,
    };
  }

  private maybeProcessAuthoring(record: DraftRecord): void {
    if (!this.deps.renderAuthoringStills || !this.deps.acceptAuthoringStills) return;
    if (this.authoringInFlight.has(record.id) || !existsSync(join(this.rootOf(record.id), "handoff", "authoring.json"))) return;
    this.authoringInFlight.add(record.id);
    void this.processAuthoring(record).catch(async (error) => {
      log.warn({ err: error, draftId: record.id, projectId: record.projectId }, "Harness authoring validation/render failed; requesting repair");
      await this.requestAuthoringRepair(record, error instanceof Error ? error.message : "Không kiểm tra được scene Harness.").catch((repairError) => {
        log.error({ err: repairError, draftId: record.id, projectId: record.projectId }, "failed to request Harness authoring repair");
      });
    }).finally(() => this.authoringInFlight.delete(record.id));
  }

  private scheduleAuthoringPoll(id: string): void {
    if (!this.deps.renderAuthoringStills || !this.deps.acceptAuthoringStills || this.authoringPolls.has(id)) return;
    const tick = async () => {
      this.authoringPolls.delete(id);
      const record = await this.readRecord(id).catch((error) => {
        log.debug({ err: error, draftId: id }, "Harness authoring poll record unreadable; stopping poll");
        return null;
      });
      if (!record || record.productionState !== "authoring") return;
      this.maybeProcessAuthoring(record);
      this.authoringPolls.set(id, setTimeout(() => void tick(), AUTHORING_POLL_MS));
    };
    this.authoringPolls.set(id, setTimeout(() => void tick(), AUTHORING_POLL_MS));
  }

  private stopAuthoringPoll(id: string): void {
    const timer = this.authoringPolls.get(id);
    if (timer) clearTimeout(timer);
    this.authoringPolls.delete(id);
  }

  private async processAuthoring(record: DraftRecord): Promise<void> {
    const root = this.rootOf(record.id);
    const request = parseJson(await readFile(join(root, AUTHORING_REQUEST_FILE), "utf8")) as Record<string, unknown>;
    const submission = parseJson(await readFile(join(root, "handoff", "authoring.json"), "utf8")) as Record<string, unknown>;
    if (request.version !== 1 || submission.version !== 1
      || request.job_id !== record.activeJobId || submission.job_id !== record.activeJobId
      || request.request_revision !== record.authoringRequestRevision
      || submission.request_revision !== record.authoringRequestRevision) {
      throw new Error("Authoring submission đã cũ hoặc không khớp request hiện tại.");
    }
    if (!Array.isArray(submission.scene_ids) || submission.scene_ids.length < 1
      || submission.scene_ids.some((id) => typeof id !== "string")) {
      throw new Error("Authoring submission thiếu scene id hợp lệ.");
    }
    const sceneIds = submission.scene_ids as string[];
    const pacing = await this.authoringPacing(record);
    const manifestPath = join(root, PROJECT_LINK, "manifest.json");
    const manifest = parseJson(await readFile(manifestPath, "utf8"));
    const paced = validateHarnessManifestPacing(manifest, sceneIds, pacing, (await this.readRequiredBrief(record)).videoLanguage);
    if (!paced.ok) throw new Error(paced.errors.join(" "));
    const creativeStage = typeof request.creative_stage === "string" ? request.creative_stage : undefined;
    if (request.phase === "self_review" && creativeStage === "v2") {
      await assertHarnessCreativeRewrite({
        baselineDir: join(root, AUTHORING_V1_DIR),
        authoredDir: join(root, PROJECT_LINK, "authored"),
      });
    }
    await writeJson(manifestPath, paced.manifest);
    const rendered = await this.deps.renderAuthoringStills!(record.projectId!, sceneIds);
    if (!rendered.ok || rendered.stills.length < sceneIds.length) {
      throw new Error(rendered.ok ? "MotionReal chưa render đủ still cho mọi cảnh." : rendered.error);
    }
    if (request.phase === "self_review") {
      const reviewed = Array.isArray(submission.reviewed_scene_ids)
        ? submission.reviewed_scene_ids.filter((id): id is string => typeof id === "string")
        : [];
      if (!sameIds(reviewed, sceneIds) || typeof submission.review_notes !== "string" || !submission.review_notes.trim()) {
        throw new Error("Harness chưa xác nhận đã xem đủ still của mọi cảnh.");
      }
      await this.deps.acceptAuthoringStills!(record.projectId!);
      const latest = await this.mustReadRecord(record.id);
      const next = { ...latest, ...transitionAgentWorkflow(latest, {
        expectedRevision: latest.workflowRevision,
        to: "still_review",
        jobId: latest.activeJobId,
      }) };
      await this.writeRecord(next);
      return;
    }
    const projectRoot = await realpath(join(root, PROJECT_LINK));
    const currentStills = rendered.stills.map((path) => {
      const rel = relative(projectRoot, path);
      if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("Still render nằm ngoài project Harness.");
      return `${PROJECT_LINK}/${rel.replaceAll("\\", "/")}`;
    });
    const nextStage = creativeStage === "v1" ? "v2" : creativeStage === "edit" ? "edit-review" : undefined;
    const archived = creativeStage === "v1"
      ? await archiveHarnessAuthoringV1({
        draftRoot: root,
        manifestPath,
        authoredDir: join(projectRoot, "authored"),
        stills: rendered.stills.map((path, index) => ({ sceneId: sceneIds[index]!, path })),
      })
      : null;
    await this.advanceAuthoringRequest(record, {
      phase: "self_review",
      ...(nextStage ? { creative_stage: nextStage } : {}),
      ...(archived ? { v1_baseline: archived.baseline } : {}),
      stills: archived?.stills ?? currentStills,
      render_error: undefined,
      instructions: [
        "Dùng khả năng xem ảnh để mở mọi PNG trong stills; không kết luận từ code.",
        ...(creativeStage === "v1" ? [
          "Đây là creative rewrite V2 bắt buộc: viết lại MỌI module scene dựa trên ảnh V1, không chỉ sửa scene nhìn yếu.",
          "Được thay toàn bộ layout, hierarchy, asset framing, transition và motion; giữ facts, narration, timing và asset ref đã duyệt.",
          "Đổi palette/glow, thêm icon/khung hoặc pulse không được tính là rewrite có ý nghĩa.",
        ] : ["Sửa trực tiếp scene theo quan sát cụ thể từ still; giữ nguyên phần không nằm trong yêu cầu edit."]),
        "review_notes phải nêu quan sát và thay đổi cụ thể, gồm lý do transition giữa các cảnh.",
        "Sau khi đã xem và sửa, gọi motionreal_submit_authoring với reviewed_scene_ids đủ mọi cảnh và review_notes cụ thể.",
      ],
    }, creativeStage === "v1"
      ? "MotionReal đã archive V1 và render still. Hãy mở mọi PNG thật, creative rewrite toàn bộ scene thành V2 rồi submit lại. Chỉ đổi màu/glow/khung/pulse không được chấp nhận."
      : "MotionReal đã render still. Hãy đọc lại handoff/authoring-request.json, mở mọi PNG thật, tự review và sửa scene trước khi submit lại.");
  }

  private async requestAuthoringRepair(record: DraftRecord, message: string): Promise<void> {
    const latest = await this.mustReadRecord(record.id);
    if (latest.productionState !== "authoring") return;
    const requestPath = join(this.rootOf(record.id), AUTHORING_REQUEST_FILE);
    const request = parseJson(await readFile(requestPath, "utf8")) as Record<string, unknown>;
    const selfReview = request.phase === "self_review";
    await this.advanceAuthoringRequest(latest, {
      phase: selfReview ? "self_review" : "repair",
      pacing: await this.authoringPacing(latest),
      render_error: message.slice(0, 2_000),
      ...(selfReview ? {} : { stills: [] }),
      instructions: [
        "MotionReal không validate/render được scene hiện tại. Đọc render_error, kiểm tra manifest và mọi module TSX rồi sửa tận gốc.",
        ...(selfReview ? ["Đây vẫn là lượt self-review/creative rewrite; phải mở lại evidence trong stills và submit đủ reviewed_scene_ids cùng review_notes."] : []),
        "Gọi lại motionreal_submit_authoring bằng request_revision mới sau khi sửa.",
      ],
    }, "MotionReal chưa validate/render được scene. Hãy đọc render_error trong handoff/authoring-request.json, sửa project/ rồi submit authoring revision mới.");
  }

  private async readRequiredBrief(record: DraftRecord): Promise<AgentBriefVM> {
    const brief = await this.readBrief(record);
    if (!brief) throw new Error("Không tìm thấy brief đã duyệt cho authoring Harness.");
    return brief;
  }

  private async authoringPacing(record: DraftRecord): Promise<HarnessAuthoringPacing> {
    if (!record.projectId) throw new Error("Project Harness chưa được liên kết.");
    const brief = await this.readRequiredBrief(record);
    const wordsPerSecond = await this.deps.wordsPerSecond?.(record.projectId);
    return buildHarnessAuthoringPacing(brief.durationTier, brief.videoLanguage, wordsPerSecond);
  }

  private async advanceAuthoringRequest(
    record: DraftRecord,
    patch: Record<string, unknown>,
    prompt: string,
  ): Promise<void> {
    const path = join(this.rootOf(record.id), AUTHORING_REQUEST_FILE);
    const current = parseJson(await readFile(path, "utf8")) as Record<string, unknown>;
    const next = { ...record, authoringRequestRevision: (record.authoringRequestRevision ?? 0) + 1 };
    await rm(join(this.rootOf(record.id), "handoff", "authoring.json"), { force: true });
    await writeJson(path, { ...current, ...patch, request_revision: next.authoringRequestRevision });
    await this.writeRecord(next);
    await this.promptSession(next, prompt);
  }

  private async assetPathsForIds(record: DraftRecord, value: unknown): Promise<Array<{ id: string; path: string; role: SceneImageRole }>> {
    const ids = validateBriefAssetIds(value, record.selectedAssetIds ?? []);
    const raw = parseJson(await readFile(join(this.rootOf(record.id), ASSET_MANIFEST_FILE), "utf8")) as { items?: unknown };
    if (!Array.isArray(raw.items)) throw new Error("Manifest asset không hợp lệ.");
    const items = new Map(raw.items.flatMap((item) => item && typeof item === "object"
      && typeof (item as { id?: unknown }).id === "string"
      ? [[(item as { id: string }).id, item as { path?: unknown; role?: unknown }] as const]
      : []));
    return Promise.all(ids.map(async (id) => ({
      id,
      path: await this.localReviewAssetPath(record.id, items.get(id)?.path),
      role: assetRole(items.get(id)?.role),
    })));
  }

  private async readAssetManifest(record: DraftRecord): Promise<AgentAssetVM[] | undefined> {
    const manifestPath = join(this.rootOf(record.id), ASSET_MANIFEST_FILE);
    if (!existsSync(manifestPath)) return undefined;
    let raw: unknown;
    try {
      raw = parseJson(await readFile(manifestPath, "utf8"));
    } catch (_error) {
      throw new Error("Manifest asset chưa phải JSON hoàn chỉnh.");
    }
    if (!raw || typeof raw !== "object") throw new Error("Manifest asset không hợp lệ.");
    const input = raw as { version?: unknown; job_id?: unknown; request_revision?: unknown; items?: unknown };
    if (input.version !== 1 || input.job_id !== record.activeJobId || input.request_revision !== record.assetRequestRevision) {
      throw new Error("Manifest asset không khớp job hoặc lượt yêu cầu hiện tại.");
    }
    if (!Array.isArray(input.items) || input.items.length === 0 || input.items.length > 30) {
      throw new Error("Manifest asset phải có từ 1 đến 30 ảnh.");
    }
    const seen = new Set<string>();
    const assets: AgentAssetVM[] = [];
    for (const value of input.items) {
      if (!value || typeof value !== "object") throw new Error("Một asset trong manifest không hợp lệ.");
      const item = value as { id?: unknown; path?: unknown; source_url?: unknown; label?: unknown; role?: unknown };
      if (typeof item.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(item.id) || seen.has(item.id)) {
        throw new Error("Asset id thiếu, trùng hoặc không hợp lệ.");
      }
      seen.add(item.id);
      const path = await this.localReviewAssetPath(record.id, item.path);
      const bytes = await readFile(path);
      if (bytes.length > MAX_IMAGE_BYTES) throw new Error(`Asset ${item.id} vượt giới hạn 10 MB.`);
      const image = sniffImage(bytes);
      if (!image?.dims || image.dims.width <= 0 || image.dims.height <= 0) {
        throw new Error(`Asset ${item.id} không phải ảnh raster được hỗ trợ.`);
      }
      if (image.dims.width > MAX_IMAGE_DIM || image.dims.height > MAX_IMAGE_DIM) {
        throw new Error(`Asset ${item.id} vượt giới hạn kích thước 4096 px.`);
      }
      const sourceUrl = validHttpUrl(item.source_url);
      if (!sourceUrl) throw new Error(`Asset ${item.id} thiếu source URL hợp lệ.`);
      const previewUrl = this.deps.mediaUrl?.(path);
      if (!previewUrl) throw new Error(`Asset ${item.id} không thể mở qua media boundary.`);
      assets.push({
        id: item.id,
        previewUrl,
        sourceUrl,
        label: typeof item.label === "string" && item.label.trim() ? item.label.trim().slice(0, 200) : basename(path),
        role: assetRole(item.role),
        width: image.dims.width,
        height: image.dims.height,
        bytes: bytes.length,
      });
    }
    return assets;
  }

  private async localReviewAssetPath(id: string, value: unknown): Promise<string> {
    if (typeof value !== "string" || !value.trim()) throw new Error("Đường dẫn asset không hợp lệ.");
    const assetsRoot = resolve(this.rootOf(id), "assets");
    const resolved = resolve(this.rootOf(id), value);
    const rel = relative(assetsRoot, resolved);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("Asset phải nằm trong thư mục assets/ của video.");
    const info = await stat(resolved).catch((_error) => null);
    if (!info?.isFile()) throw new Error(`Không tìm thấy asset: ${basename(value)}`);
    const [realRoot, realFile] = await Promise.all([realpath(assetsRoot), realpath(resolved)]);
    const realRel = relative(realRoot, realFile);
    if (!realRel || realRel.startsWith("..") || isAbsolute(realRel)) throw new Error("Asset không được trỏ ra ngoài workspace.");
    return realFile;
  }

  private async recordWorkflowError(record: DraftRecord, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : "Harness không nhận yêu cầu thu thập asset.";
    const failed = {
      ...record,
      ...transitionAgentWorkflow(record, {
        expectedRevision: record.workflowRevision,
        to: "error",
        jobId: record.activeJobId,
        error: message,
      }),
    };
    await this.writeRecord(failed);
  }

  private async rpc(baseUrl: string, method: string, payload: unknown): Promise<unknown> {
    const response = await this.fetchImpl(`${baseUrl}api/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "client-request", rpcId: randomUUID(), method, payload }),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      log.error({ method, status: response.status, detail }, "DeepSeek Harness RPC transport failure");
      throw new Error(`Harness không chấp nhận ${method} (HTTP ${response.status}).`);
    }
    const body = (await response.json()) as HarnessRpcResponse;
    if (!body.result?.ok) {
      const rpcError = body.result?.error as { code?: unknown; message?: unknown } | undefined;
      const detail = typeof rpcError?.message === "string" ? rpcError.message : "lỗi không xác định";
      const code = typeof rpcError?.code === "string"
        ? rpcError.code
        : "unknown";
      throw new HarnessRpcError(method, code, detail);
    }
    return body.result.value;
  }

  private async workspaceSessionIds(workspaceId: string): Promise<string[]> {
    if (!this.active) return [];
    const value = await this.rpc(this.active.url, "workspace.list", {});
    const items = value && typeof value === "object" ? (value as { items?: unknown }).items : undefined;
    if (!Array.isArray(items)) return [];
    const workspace = items.find((item) => item && typeof item === "object"
      && (item as { workspaceId?: unknown }).workspaceId === workspaceId) as { sessionIds?: unknown } | undefined;
    return Array.isArray(workspace?.sessionIds)
      ? workspace.sessionIds.filter((sessionId): sessionId is string => typeof sessionId === "string")
      : [];
  }
}

class HarnessRpcError extends Error {
  constructor(readonly method: string, readonly code: string, detail: string) {
    super(`Harness ${method} thất bại: ${detail}`);
  }
}

function isWorkspaceNameConflict(error: unknown): boolean {
  return error instanceof HarnessRpcError && error.code === "workspace-name-conflict";
}

function safeChatError(error: unknown, message: string): Error {
  if (error instanceof HarnessRpcError) {
    log.warn({ method: error.method, code: error.code }, "Harness chat RPC failed");
  }
  return new Error(message);
}

function isSafeDraftId(value: string): boolean {
  return /^agent-[0-9a-f-]{36}$/i.test(value);
}

function validHttpUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch (_error) {
    return null;
  }
}

/** Older asset ledgers had no role; treat them as ordinary supporting media. */
function assetRole(value: unknown): SceneImageRole {
  return value === "hero" || value === "support" || value === "logo" || value === "icon"
    ? value
    : "support";
}

function validateSelectedIds(selectedIds: string[], assets: AgentAssetVM[]): string[] {
  if (!Array.isArray(selectedIds)) throw new Error("Danh sách asset đã chọn không hợp lệ.");
  const allowed = new Set(assets.map((asset) => asset.id));
  const selected = [...new Set(selectedIds)];
  if (selected.some((id) => typeof id !== "string" || !allowed.has(id))) {
    throw new Error("Danh sách asset đã chọn không khớp manifest hiện tại.");
  }
  return selected;
}

function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id) => right.includes(id));
}

/** PowerShell commonly emits UTF-8 BOM; valid Agent handoffs must tolerate it. */
function parseJson(text: string): unknown {
  return JSON.parse(text.replace(/^\uFEFF/, ""));
}

function validateBriefAssetIds(value: unknown, expected: string[]): string[] {
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string")) {
    throw new Error("Brief có danh sách asset không hợp lệ.");
  }
  const actual = [...new Set(value as string[])];
  if (actual.length !== value.length) throw new Error("Brief có asset id trùng.");
  if (actual.length !== expected.length || actual.some((id) => !expected.includes(id))) {
    throw new Error("Brief không dùng đúng tập asset đã được duyệt.");
  }
  return actual;
}

function validBriefText(value: unknown, label: string, min: number, max: number): string {
  if (typeof value !== "string") throw new Error(`Brief thiếu ${label}.`);
  const text = value.trim();
  if (text.length < min || text.length > max) throw new Error(`Brief có ${label} không hợp lệ.`);
  return text;
}

function validateBriefFields(value: Record<string, unknown>): Pick<AgentBriefVM, "durationTier" | "videoLanguage" | "voiceProvider"> {
  const durationTier = value.duration_tier;
  const videoLanguage = value.video_language;
  const voiceProvider = value.voice_provider;
  if (durationTier !== 1 && durationTier !== 2 && durationTier !== 3 && durationTier !== 4) {
    throw new Error("Brief có thời lượng không được hỗ trợ.");
  }
  if (videoLanguage !== "vi" && videoLanguage !== "en") throw new Error("Brief có ngôn ngữ không hợp lệ.");
  if (voiceProvider !== "vivibe" && voiceProvider !== "elevenlabs" && voiceProvider !== "vieneu") throw new Error("Brief có giọng đọc không hợp lệ.");
  if (videoLanguage === "en" && voiceProvider !== "elevenlabs") throw new Error("Brief tiếng Anh phải dùng ElevenLabs.");
  return { durationTier, videoLanguage, voiceProvider };
}

function validateBriefInput(input: AgentBriefInput): AgentBriefInput {
  if (!input || typeof input !== "object") throw new Error("Nội dung chỉnh sửa brief không hợp lệ.");
  const fields = validateBriefFields({
    duration_tier: input.durationTier,
    video_language: input.videoLanguage,
    voice_provider: input.voiceProvider,
  });
  return {
    title: validBriefText(input.title, "tiêu đề", 1, 160),
    prompt: validBriefText(input.prompt, "nội dung", 20, 20_000),
    ...fields,
  };
}

function briefChanged(generated: AgentBriefVM, accepted: AgentBriefInput): boolean {
  return generated.title !== accepted.title
    || generated.prompt !== accepted.prompt
    || generated.durationTier !== accepted.durationTier
    || generated.videoLanguage !== accepted.videoLanguage
    || generated.voiceProvider !== accepted.voiceProvider;
}

function safeBriefError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : "Harness không nhận yêu cầu tạo brief.";
}

function workspaceInfoOf(value: unknown): { id: string } {
  const workspace = value && typeof value === "object" ? (value as { workspace?: unknown }).workspace : null;
  if (!workspace || typeof workspace !== "object" || typeof (workspace as { workspaceId?: unknown }).workspaceId !== "string") {
    throw new Error("Harness trả về workspace không hợp lệ.");
  }
  return { id: (workspace as { workspaceId: string }).workspaceId };
}

function agentInstructions(title: string): string {
  return `# MotionReal Video Agent\n\nBạn đang làm việc cho video: ${title}\n\n- Nghiên cứu, ghi chú và tải asset vào thư mục \`assets/\` của workspace này.\n- Khi MotionReal yêu cầu chuẩn bị asset, đọc \`handoff/assets-request.json\`, làm đúng job/request revision rồi gọi \`motionreal_submit_assets\`. Không tự ghi file manifest cuối.\n- Khi MotionReal yêu cầu brief, đọc \`handoff/brief-request.json\`, dùng cuộc trò chuyện và đúng asset đã chọn rồi gọi \`motionreal_submit_brief\`. Không tự ghi file brief cuối.\n- Chỉ author scene khi có \`handoff/authoring-request.json\`. Khi đó \`project/\` là project MotionReal của chính video này: đọc asset, viết \`project/manifest.json\` và \`project/authored/*.tsx\`, rồi gọi \`motionreal_submit_authoring\`.\n- Không tự tạo project hoặc render MP4; MotionReal validate, chụp still và mở từng bước duyệt bên ngoài chat.\n- Mọi đường dẫn ảnh thu thập phải tương đối và nằm trong \`assets/\`.\n`;
}

function harnessToolsPatch(pluginPath: string): string {
  return `- insert:\n    - id: motionreal-submission-tools\n      name: ${JSON.stringify(pathToFileURL(resolve(pluginPath)).href)}\n`;
}

function agentContract(): string {
  return `# MotionReal Agent Workspace\n\nThis directory is an isolated workspace for one video.\n\n- Follow the local AGENTS.md.\n- Work only inside this directory, including the project/ junction created by MotionReal.\n- Edit project/ only while following the current handoff/authoring-request.json.\n- MotionReal owns validation, still capture, human review, and MP4 rendering.\n`;
}

function harnessSettings(): string {
  return `llm-pi-ai:\n  providers:\n    ninerouter:\n      apiKeyEnv: NINEROUTER_API_KEY\n      api: openai-completions\n      baseURL: http://127.0.0.1:20128/v1\n      compat:\n        supportsDeveloperRole: false\n        maxTokensField: max_tokens\n      models:\n        - id: ag/gemini-3.7-flash-high\nagent-default-model:\n  provider: ninerouter\n  model: ag/gemini-3.7-flash-high\nweb-search-deepseek:\n  apiKeyEnv: DEEPSEEK_API_KEY\n`;
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

async function waitForHarness(url: string, fetchImpl: typeof fetch, childFailure: () => Error | null): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const failure = childFailure();
    if (failure) throw failure;
    try {
      const response = await fetchImpl(`${url}api/host.describe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "client-request", rpcId: randomUUID(), method: "host.describe", payload: {} }),
      });
      if (response.ok) {
        const body = (await response.json()) as HarnessRpcResponse;
        if (body.result?.ok) return;
      }
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

function isStreamErrorEnvelope(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const payload = (value as { payload?: unknown }).payload;
  return Boolean(payload && typeof payload === "object" && (payload as { type?: unknown }).type === "stream/error");
}
