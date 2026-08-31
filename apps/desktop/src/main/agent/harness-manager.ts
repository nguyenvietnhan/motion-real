import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createLogger, MAX_IMAGE_BYTES, MAX_IMAGE_DIM, resolveEffectiveDuration, sniffImage, writeJson } from "@motionreal/pipeline";
import type { SceneImageRole } from "@motionreal/schema";
import type { AgentActivityVM, AgentAssetVM, AgentBriefInput, AgentBriefVM, AgentDraftVM, AgentProductionState, AgentSearchProvider, AgentSettingsVM, DurationTierChoice, VideoLanguageChoice, VoiceProviderChoice } from "../../shared/types.js";
import { sanitizedChildEnvironment } from "../security/runtime-security.js";
import {
  AGENT_WORKFLOW_VERSION,
  initialAgentWorkflow,
  isPausableAgentProductionState,
  parseAgentWorkflow,
  pauseAgentWorkflow,
  resumeAgentWorkflow,
  transitionAgentWorkflow,
  type AgentWorkflowRecord,
  type AgentWorkflowTransition,
} from "./agent-workflow.js";
import { assertHarnessImageReads, readHarnessReviewHistory } from "./harness-image-review.js";
import { AUTHORING_CONTRACT } from "../authoring/contract-text.js";
import type { AuthorInput } from "./agent-worker.js";
import { ContentPlanSchema, type ContentPlan } from "../authoring/content-plan.js";
import {
  buildHarnessAuthoringPacing,
  validateHarnessManifestPacing,
  type HarnessAuthoringPacing,
} from "./harness-authoring-pacing.js";
import {
  harnessReviewFingerprint,
  harnessSceneFingerprints,
  type HarnessSceneFingerprints,
} from "./harness-creative-rewrite.js";

const METADATA_FILE = "motionreal-agent.json";
/** Read-only compatibility fallback for drafts queued before the brief split. */
const LEGACY_CREATE_REQUEST_FILE = "motionreal.create.json";
const ASSET_REQUEST_FILE = join("handoff", "assets-request.json");
const ASSET_MANIFEST_FILE = join("handoff", "assets.json");
const BRIEF_REQUEST_FILE = join("handoff", "brief-request.json");
const BRIEF_GENERATED_FILE = join("handoff", "brief.generated.json");
const BRIEF_FILE = join("handoff", "brief.json");
const AUTHORING_REQUEST_FILE = join("handoff", "authoring-request.json");
const CONTENT_PLAN_FILE = join("handoff", "content-plan.json");
const AUTHORING_CONTRACT_FILE = join("handoff", "authoring-contract.md");
const PROJECT_LINK = "project";
const HARNESS_PATCH_FILE = "motionreal-tools.patch.yml";
const SEARCH_CONFIG_FILE = "motionreal-search.json";
const AGENTS_FILE = "AGENTS.md";
const AI_CONTRACT_FILE = "AI_CONTRACT.md";
// A brand-new DSH_HOME initializes the web profile on its first launch. The
// checked-in Harness build needs roughly 30s on this Windows machine, so 20s
// was a false failure even though the child was about to become healthy.
const START_TIMEOUT_MS = 60_000;
const RPC_TIMEOUT_MS = 15_000;
const CANCEL_RPC_TIMEOUT_MS = 2_000;
const PROCESS_OUTPUT_LIMIT = 4_096;
const AUTHORING_POLL_MS = 500;
const SESSION_POLICY_REVISION = 1;
/** Session persistence is intentionally coupled to this reviewed Harness checkout. */
const HARNESS_SESSION_LAYOUT_COMMIT = "466404c927e2209ba7f242038b6922f10c0405cd";
const log = createLogger("harness");

export type { AgentDraftVM } from "../../shared/types.js";

type DraftRecord = Omit<AgentDraftVM, "updatedAt" | "harnessUrl" | "webSearchConfigured" | "searchProvider" | "createReady" | "activities" | "needsAttention" | "assetReview" | "assetCollectionError" | "briefReview" | "briefReviewError" | "sessionAccess"> & AgentWorkflowRecord & {
  workspaceId?: string;
  sessionId?: string;
  assetRequestRevision?: number;
  briefRequestRevision?: number;
  authoringRequestRevision?: number;
  sessionPolicyRevision?: number;
  repairPhase?: "authoring" | "visual_refine";
  repairAttempts?: number;
  failedPhase?: "collecting_assets" | "preparing_brief" | "authoring" | "visual_refine";
  /** RPC id of the native turn that must submit the next workflow artifact. */
  awaitingArtifactPromptId?: string;
};

class AuthoringStillRenderError extends Error {
  constructor(message: string, readonly repairable: boolean) {
    super(message);
    this.name = "AuthoringStillRenderError";
  }
}

/** Unknown runtime/bridge failures must never spend an AI repair attempt. */
function isRepairableAuthoringError(error: unknown): boolean {
  if (error instanceof AuthoringStillRenderError) return error.repairable;
  const message = error instanceof Error ? error.message : String(error);
  return /authoring submission|scene id|manifest|pacing|transitionToNext|visual refine|reviewed_scene_ids|review_notes|fingerprint|admission|schema|authored[\\/]|\.tsx/i.test(message);
}

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

type AgentAcceptedBrief = AgentBriefVM & {
  durationTier: DurationTierChoice;
  voiceProvider: VoiceProviderChoice;
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
  planAuthoringContent: (
    projectId: string,
    input: AuthorInput,
    signal: AbortSignal,
  ) => Promise<ContentPlan>;
  renderAuthoringStills?: (
    projectId: string,
    sceneIds: string[],
  ) => Promise<{ ok: true; stills: string[] } | { ok: false; error: string; repairable: boolean }>;
  cancelAuthoringStills?: (projectId: string) => void;
  acceptAuthoringStills?: (projectId: string) => Promise<void>;
  /** Snapshot-aware caller; default keeps old installs bounded at three repairs. */
  maxAuthoringRepairs?: (projectId: string) => number | Promise<number>;
  /** Snapshot-aware visual QA policy; legacy projects retain the configured settings. */
  authoringRefinePolicy?: (projectId: string) =>
    | { refinePasses: number; refineEarlyStop: boolean }
    | Promise<{ refinePasses: number; refineEarlyStop: boolean }>;
  /** Test seam; production uses the fixed control-plane deadline. */
  rpcTimeoutMs?: number;
  /** Test seam; a cancel must never hold the UI beyond this short deadline. */
  cancelRpcTimeoutMs?: number;
  /** Test seam for the pinned Harness session-layout guard. */
  harnessRevision?: () => Promise<string>;
};

/** Durable identity needed to remove only one Agent draft's Harness artifacts. */
export type HarnessDraftDeletionPlan = {
  version: 1;
  draftId: string;
  projectId?: string;
  workspaceId?: string;
  sessionIds: string[];
  draftRoot: string;
};

/**
 * One DeepSeek Harness runtime shared by every video draft. Each draft remains
 * a separate filesystem Workspace while the Harness process and profile boot
 * only once for the desktop app.
 */
export class HarnessManager {
  private active: { child: ChildProcess; url: string; searchProvider: AgentSearchProvider } | null = null;
  private activeDraftId: string | null = null;
  /** Sessions created by the current Harness process. This distinguishes a
   * resumed draft from merely switching the iframe to a different draft. */
  private readonly liveSessionIds = new Set<string>();
  private startingChild: ChildProcess | null = null;
  private startInFlight: Promise<string> | null = null;
  private webSearchConfigured: boolean | undefined;
  private readonly spawnChild: typeof spawn;
  private readonly fetchImpl: typeof fetch;
  private readonly findPort: () => Promise<number>;
  private readonly now: () => Date;
  private readonly nodeExecutable: string;
  private readonly rpcTimeoutMs: number;
  private readonly cancelRpcTimeoutMs: number;
  private readonly authoringInFlight = new Set<string>();
  private readonly authoringWrites = new Set<Promise<void>>();
  private readonly authoringPolls = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly authoringPlans = new Map<string, { controller: AbortController; promise: Promise<ContentPlan> }>();

  constructor(private readonly deps: HarnessManagerDeps) {
    this.spawnChild = deps.spawn ?? spawn;
    this.fetchImpl = deps.fetch ?? fetch;
    this.findPort = deps.findPort ?? findLoopbackPort;
    this.now = deps.now ?? (() => new Date());
    this.rpcTimeoutMs = positiveTimeout(deps.rpcTimeoutMs, RPC_TIMEOUT_MS);
    this.cancelRpcTimeoutMs = positiveTimeout(deps.cancelRpcTimeoutMs, CANCEL_RPC_TIMEOUT_MS);
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
    return drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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
      sessionPolicyRevision: SESSION_POLICY_REVISION,
      ...initialAgentWorkflow(),
    };
    await mkdir(join(root, "assets"), { recursive: true });
    await this.writeRecord(record);
    await writeFile(join(root, AGENTS_FILE), agentInstructions(normalized), "utf8");
    await writeFile(join(root, AI_CONTRACT_FILE), agentContract(), "utf8");
    return this.toVm(record);
  }

  async renameDraft(id: string, title: string): Promise<AgentDraftVM> {
    const record = await this.mustReadRecord(id);
    const normalized = title.trim().slice(0, 120);
    if (!normalized) throw new Error("Hãy đặt tên video trước khi đổi tên.");
    await this.writeRecord({ ...record, title: normalized });
    return this.status(id);
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

  /** Permission checks may trust only the one local Harness process we launched. */
  isActiveHarnessOrigin(origin: string): boolean {
    if (!this.active) return false;
    try {
      return new URL(this.active.url).origin === new URL(origin).origin;
    } catch (_error) {
      return false;
    }
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
    const sessionWasLive = this.liveSessionIds.has(sessionId);
    await this.rpc(url, "session.create", { workspaceId: workspaceInfo.id, sessionId });
    this.webSearchConfigured = await this.readSearchCredentialStatus(url);
    record = { ...record, workspaceId: workspaceInfo.id, sessionId };
    await this.writeRecord(record);
    this.liveSessionIds.add(sessionId);
    this.activeDraftId = id;
    if (!sessionWasLive
      && isPausableAgentProductionState(record.productionState)
      && existsSync(join(this.rootOf(record.id), AUTHORING_REQUEST_FILE))) {
      try {
        await this.promptSession(record, resumePromptFor(record.productionState));
      } catch (error) {
        await this.recordWorkflowError(record, error);
        record = await this.mustReadRecord(record.id);
      }
    }
    if (isAutomatedAuthoringState(record.productionState)) this.scheduleAuthoringPoll(record.id);
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
    const searchProvider = await this.readSearchProvider();
    await writeFile(join(this.deps.harnessHome, "settings.yaml"), harnessSettings(), "utf8");
    const patchPath = join(this.deps.harnessHome, HARNESS_PATCH_FILE);
    await writeFile(patchPath, harnessToolsPatch(this.deps.submissionPluginPath, searchProvider, this.deps.harnessCliPath), "utf8");
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
        this.active = null;
        this.activeDraftId = null;
        this.liveSessionIds.clear();
        this.webSearchConfigured = undefined;
      }
      if (this.startingChild === child) this.startingChild = null;
    });
    try {
      await waitForHarness(url, this.fetchImpl, () => startupFailure);
      this.startingChild = null;
      this.active = { child, url, searchProvider };
      started = true;
      return url;
    } catch (error) {
      if (this.startingChild === child) this.startingChild = null;
      stopping = true;
      await stopChild(child);
      throw error;
    }
  }

  async status(id: string, options?: { includeActivities?: boolean }): Promise<AgentDraftVM> {
    let record = await this.mustReadRecord(id);
    let assetReview: AgentAssetVM[] | undefined;
    let assetCollectionError: string | undefined;
    let briefReview: AgentBriefVM | undefined;
    let briefReviewError: string | undefined;
    if (record.productionState === "collecting_assets" || record.productionState === "asset_review" || record.productionState === "preparing_brief" || record.productionState === "brief_review") {
      try {
        assetReview = await this.readAssetManifest(record);
        if (assetReview && record.productionState === "collecting_assets") {
          record = { ...record, ...transitionAgentWorkflow(record, {
            expectedRevision: record.workflowRevision,
            to: "asset_review",
            jobId: record.activeJobId,
          }) };
          delete record.awaitingArtifactPromptId;
          await this.writeRecord(record);
        }
      } catch (error) {
        assetCollectionError = error instanceof Error ? error.message : "Manifest asset không hợp lệ.";
      }
    }
    if (record.productionState === "preparing_brief" || record.productionState === "brief_review" || record.productionState === "queued_create") {
      try {
        briefReview = await this.readGeneratedBrief(record);
        if (briefReview && record.productionState === "preparing_brief") {
          record = { ...record, ...transitionAgentWorkflow(record, {
            expectedRevision: record.workflowRevision,
            to: "brief_review",
            jobId: record.activeJobId,
          }) };
          delete record.awaitingArtifactPromptId;
          await this.writeRecord(record);
        }
      } catch (error) {
        briefReviewError = error instanceof Error ? error.message : "Brief của Agent không hợp lệ.";
      }
    }
    if (isAutomatedAuthoringState(record.productionState)) this.maybeProcessAuthoring(record);
    const activityState = options?.includeActivities === true
      ? await this.readSafeActivities(record).catch((error) => {
        log.debug({ err: error, draftId: record.id }, "Harness activity unavailable");
        return undefined;
      })
      : undefined;
    if (activityState?.artifactPromptEnded && isArtifactAwaitingState(record.productionState)) {
      const artifact = record.productionState === "collecting_assets" ? "manifest asset" : "brief";
      await this.recordWorkflowError(record, `Agent đã kết thúc lượt nhưng chưa gửi ${artifact} hợp lệ. Dữ liệu đã tải vẫn được giữ; hãy thử lại bước này.`);
      record = await this.mustReadRecord(record.id);
    }
    return this.toVm(record, assetReview, assetCollectionError, briefReview, briefReviewError, activityState?.activities, activityState?.needsAttention);
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
      const previousBrief = await this.readGeneratedBrief(current).catch((_error) => undefined);
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
        to: "preparing_brief",
        jobId: current.activeJobId,
      }),
      selectedAssetIds,
      briefRequestRevision: (current.briefRequestRevision ?? 0) + 1,
    };
    await this.writeBriefRequest(next);
    await this.writeRecord(next);
    try {
      await this.promptSession(next, "MotionReal đã chốt asset. Hãy đọc handoff/brief-request.json, tạo brief và gọi motionreal_submit_brief; không tự ghi handoff/brief.generated.json.");
    } catch (error) {
      return this.toVm(next, assets, undefined, undefined, safeBriefError(error));
    }
    return this.toVm(next, assets);
  }

  async prepareBrief(id: string, expectedRevision: number): Promise<AgentDraftVM> {
    const current = await this.mustReadRecord(id);
    this.requireActiveSession(current);
    if (current.productionState !== "preparing_brief" || current.workflowRevision !== expectedRevision) {
      throw new Error("Trạng thái tạo brief đã thay đổi; hãy tải lại.");
    }
    if (!current.selectedAssetIds) throw new Error("Chưa có lựa chọn asset để tạo brief.");
    const next = { ...current, briefRequestRevision: (current.briefRequestRevision ?? 0) + 1 };
    await this.writeBriefRequest(next);
    await this.writeRecord(next);
    try {
      await this.promptSession(next, "MotionReal yêu cầu tạo lại brief. Hãy đọc phiên bản mới của handoff/brief-request.json, hoàn thành brief và gọi motionreal_submit_brief; không tự ghi handoff/brief.generated.json.");
    } catch (error) {
      return this.toVm(next, undefined, undefined, undefined, safeBriefError(error));
    }
    return this.toVm(next);
  }

  /** Reopen a generated brief with concrete user feedback; it is never an acceptance. */
  async requestBriefChanges(id: string, expectedRevision: number, feedback: string): Promise<AgentDraftVM> {
    const current = await this.mustReadRecord(id);
    this.requireActiveSession(current);
    if (current.productionState !== "brief_review" || current.workflowRevision !== expectedRevision) {
      throw new Error("Trạng thái duyệt brief đã thay đổi; hãy tải lại.");
    }
    const request = feedback.trim();
    if (!request || request.length > 2_000) throw new Error("Yêu cầu chỉnh brief phải dài từ 1 đến 2000 ký tự.");
    const baseBrief = await this.readGeneratedBrief(current);
    if (!baseBrief) throw new Error("Agent chưa gửi brief hợp lệ để chỉnh sửa.");
    const next = {
      ...current,
      ...transitionAgentWorkflow(current, {
        expectedRevision,
        to: "preparing_brief",
        jobId: current.activeJobId,
      }),
      briefRequestRevision: (current.briefRequestRevision ?? 0) + 1,
    };
    await this.writeBriefRequest(next, { baseBrief, feedback: request });
    await this.writeRecord(next);
    try {
      await this.promptSession(next, "MotionReal yêu cầu chỉnh brief theo phản hồi mới. Hãy đọc handoff/brief-request.json, dùng base_brief và feedback, rồi gọi motionreal_submit_brief; không tự ghi handoff/brief.generated.json.");
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
    const generated = await this.readGeneratedBrief(current);
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

  /** Persist pause first, abort local work, then give native cancellation a short bounded chance. */
  async pauseWorkflow(id: string, expectedRevision: number): Promise<AgentDraftVM> {
    const current = await this.mustReadRecord(id);
    const next = { ...current, ...pauseAgentWorkflow(current, { expectedRevision, jobId: current.activeJobId }) };
    this.stopAuthoringPoll(id);
    await this.writeRecord(next);
    this.abortAuthoringPlan(id);
    if (current.projectId) this.deps.cancelAuthoringStills?.(current.projectId);
    if (this.active && current.sessionId) {
      await this.rpc(this.active.url, "session.cancel", { sessionId: current.sessionId }, this.cancelRpcTimeoutMs).catch((error) => {
        log.warn({ err: error, draftId: id }, "failed to cancel native Harness session after durable pause");
      });
    }
    return this.toVm(next);
  }

  /** Continue a paused native step with a fresh, explicit Harness instruction. */
  async resumeWorkflow(id: string, expectedRevision: number): Promise<AgentDraftVM> {
    const current = await this.mustReadRecord(id);
    this.requireActiveSession(current);
    const resumable = { ...current };
    delete resumable.pausedFrom;
    const next = { ...resumable, ...resumeAgentWorkflow(current, { expectedRevision, jobId: current.activeJobId }) };
    await this.writeRecord(next);
    try {
      await this.promptSession(next, resumePromptFor(next.productionState));
    } catch (error) {
      await this.recordWorkflowError(next, error);
      throw error;
    }
    if (isAutomatedAuthoringState(next.productionState)) this.scheduleAuthoringPoll(next.id);
    return this.toVm(next);
  }

  /** Retry exactly the failed Agent phase; never restart a completed asset/brief/video workflow. */
  async retryWorkflow(id: string, expectedRevision: number): Promise<AgentDraftVM> {
    const current = await this.mustReadRecord(id);
    this.requireActiveSession(current);
    const phase = current.productionState === "error" ? current.failedPhase : undefined;
    if (current.workflowRevision !== expectedRevision || !phase || !current.activeJobId) {
      throw new Error("Không xác định được bước Agent cần thử lại. Hãy mở lại video Agent.");
    }
    const next: DraftRecord = {
      ...current,
      workflowVersion: AGENT_WORKFLOW_VERSION,
      workflowRevision: current.workflowRevision + 1,
      productionState: phase,
      activeJobId: current.activeJobId,
    };
    delete next.lastError;
    delete next.failedPhase;
    delete next.retryAction;
    if (next.repairPhase === phase) {
      delete next.repairPhase;
      delete next.repairAttempts;
    }
    await this.writeRecord(next);
    try {
      if (current.retryAction === "rerender_stills") {
        if ((phase !== "authoring" && phase !== "visual_refine")
          || !existsSync(join(this.rootOf(next.id), "handoff", "authoring.json"))) {
          throw new Error("Không còn authoring submission để render lại ảnh xem trước.");
        }
      } else if ((phase === "authoring" || phase === "visual_refine")
        && existsSync(join(this.rootOf(next.id), "handoff", "authoring.json"))) {
        await this.requestAuthoringRepair(next, "Người dùng yêu cầu thử lại bước này.");
      } else if (phase === "authoring" && existsSync(join(this.rootOf(next.id), AUTHORING_REQUEST_FILE))) {
        const request = parseJson(await readFile(join(this.rootOf(next.id), AUTHORING_REQUEST_FILE), "utf8")) as Record<string, unknown>;
        if (request.phase === "initial" && request.planning === true) {
          await this.completeInitialContentPlan(next, request);
        }
        if (await this.isCurrentAuthoringRecord(next)) {
          await this.promptSession(next, resumePromptFor(phase));
        }
      } else {
        await this.promptSession(next, resumePromptFor(phase));
      }
    } catch (error) {
      await this.recordWorkflowError(next, error);
      throw error;
    }
    if (isAutomatedAuthoringState(phase)) this.scheduleAuthoringPoll(next.id);
    return this.status(id);
  }

  async readCreateRequest(id: string): Promise<AgentCreateRequest> {
    const record = await this.mustReadRecord(id);
    if (record.productionState !== "queued_create"
      && !(record.productionState === "authoring" && record.projectId)) {
      throw new Error("Yêu cầu tạo video chưa qua bước duyệt brief.");
    }
    const accepted = await this.readAcceptedBrief(record);
    if (accepted) {
      const assets = await this.assetPathsForIds(record, accepted.selectedAssetIds);
      return {
        draftId: record.id,
        title: accepted.title,
        prompt: accepted.prompt,
        assets,
        choices: {
          durationTier: accepted.durationTier,
          videoLanguage: accepted.videoLanguage,
          voiceProvider: accepted.voiceProvider,
        },
      };
    }

    // One-way compatibility for drafts queued before brief.generated.json existed.
    const path = join(this.rootOf(record.id), LEGACY_CREATE_REQUEST_FILE);
    let raw: unknown;
    try { raw = parseJson(await readFile(path, "utf8")); }
    catch (_error) { throw new Error("Agent chưa tạo brief đã duyệt hợp lệ."); }
    if (!raw || typeof raw !== "object") throw new Error("Yêu cầu dựng video của Agent không hợp lệ.");
    const input = raw as Record<string, unknown>;
    if (input.version !== 1 || typeof input.prompt !== "string" || !input.prompt.trim()) {
      throw new Error("Yêu cầu dựng video của Agent thiếu nội dung.");
    }
    if (input.prompt.length > 20_000) throw new Error("Yêu cầu dựng video quá dài.");
    const fields = validateAcceptedBriefFields(input);
    const assets = await this.assetPathsForIds(record, input.selected_asset_ids);
    return {
      draftId: record.id,
      title: validBriefText(input.title, "tiêu đề", 1, 160),
      prompt: input.prompt.trim(),
      assets,
      choices: {
        durationTier: fields.durationTier,
        videoLanguage: fields.videoLanguage,
        voiceProvider: fields.voiceProvider,
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
      await this.finishInitialAuthoringStart(current);
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
      planning: true,
      project: PROJECT_LINK,
      brief: "handoff/brief.json",
      asset_manifest: "handoff/assets.json",
      contract: "handoff/authoring-contract.md",
      manifest: `${PROJECT_LINK}/manifest.json`,
      authored_dir: `${PROJECT_LINK}/authored`,
      pacing,
      assets: usableAssets,
      instructions: [
        "Đọc brief, contract; dùng read_image với file_path của từng asset để xem ảnh thật trước khi author (read chỉ đọc văn bản).",
        "Đọc content_plan trong request và giữ đúng expected_scene_ids theo thứ tự; đây là narrative/pacing plan đã được MotionReal kiểm tra.",
        "pacing là contract có thẩm quyền; bỏ qua mọi câu duration mâu thuẫn nằm trong prompt của brief.",
        "Asset là pool tư liệu, không phải số lượng storyboard. Số cảnh và lượng narration phải theo pacing.",
        "Viết mới manifest.json và các module authored/*.tsx cho toàn video; không gọi API authoring cũ.",
        "Asset là pool đã duyệt, không phải checklist. Không bắt buộc dùng mọi asset: chỉ dùng asset thực sự giúp kể nội dung của cảnh; logo/icon chỉ là điểm nhấn bổ trợ và không được phóng thành ảnh nền/cảnh chính nếu không có lý do nội dung rõ ràng.",
        "Mọi asset được dùng phải giữ đúng scene.image.role đã duyệt; không dùng asset ngoài pool đã duyệt.",
        "Mỗi cảnh phải có một focal subject và hành động hình ảnh riêng; cấm dùng một shell/panel/HUD cố định cho toàn video.",
        "Mỗi cảnh trừ cảnh cuối phải khai báo transitionToNext phù hợp với quan hệ nội dung; không dựa vào transition mặc định.",
        "Đây là bản chất lượng cuối ngay từ lượt đầu: hierarchy, visual anchor, motion và asset framing phải được hoàn thiện trước khi submit; không dựa vào một lượt viết lại V2 bắt buộc.",
        "Không render video. Khi code đã hoàn chỉnh, gọi motionreal_submit_authoring để MotionReal validate và render still.",
      ],
    });
    await this.writeRecord(next);
    await this.finishInitialAuthoringStart(next);
  }

  async requestSceneEdits(
    id: string,
    projectId: string,
    edits: unknown,
    globalNotes: unknown,
  ): Promise<void> {
    const current = await this.mustReadRecord(id);
    this.requireActiveSession(current);
    if (current.productionState !== "scene_review" || current.projectId !== projectId) {
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
        target_scene_ids: targetSceneIds,
        edit_request: { per_scene: perScene, global_notes: notes },
        render_error: undefined,
        instructions: [
          "Đọc edit_request và dùng read_image mở still hiện tại của các target_scene_ids trước khi sửa.",
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

  /** Capture all exact identities before a multi-step Agent deletion begins. */
  async prepareDraftDeletion(id: string): Promise<HarnessDraftDeletionPlan> {
    const record = await this.mustReadRecord(id);
    const sessionIds = new Set<string>();
    if (record.sessionId) sessionIds.add(record.sessionId);
    if (this.active && record.workspaceId) {
      const listed = await this.workspaceSessionIds(record.workspaceId).catch((error) => {
        log.warn({ err: error, draftId: record.id }, "failed to list Harness sessions during draft deletion");
        return [];
      });
      for (const sessionId of listed) sessionIds.add(sessionId);
    }
    return {
      version: 1,
      draftId: record.id,
      ...(record.projectId ? { projectId: record.projectId } : {}),
      ...(record.workspaceId ? { workspaceId: record.workspaceId } : {}),
      sessionIds: [...sessionIds],
      draftRoot: this.rootOf(record.id),
    };
  }

  /** Best-effort cancellation is a separate journal step from physical deletion. */
  async cancelHarnessSessions(plan: HarnessDraftDeletionPlan): Promise<void> {
    this.assertDeletionPlan(plan);
    this.stopAuthoringPoll(plan.draftId);
    this.abortAuthoringPlan(plan.draftId);
    if (plan.projectId) this.deps.cancelAuthoringStills?.(plan.projectId);
    if (this.active) {
      for (const sessionId of plan.sessionIds) {
        await this.rpc(this.active.url, "session.cancel", { sessionId }, this.cancelRpcTimeoutMs).catch((error) => {
          log.warn({ err: error, draftId: plan.draftId, sessionId }, "failed to cancel Harness session during draft deletion");
        });
      }
    }
  }

  /** Remove only the native Harness data named in a previously persisted plan. */
  async deleteHarnessData(plan: HarnessDraftDeletionPlan): Promise<void> {
    this.assertDeletionPlan(plan);

    const persistedSessionDirs = await this.persistedSessionDirs(plan);
    if (persistedSessionDirs.length > 0) await this.assertPinnedHarnessSessionLayout();
    if (this.active && plan.workspaceId) {
      await this.rpc(this.active.url, "workspace.delete", { workspaceId: plan.workspaceId }).catch((error) => {
        if (isMissingHarnessWorkspace(error)) return;
        throw error;
      });
    }
    for (const sessionDir of persistedSessionDirs) await rm(sessionDir, { recursive: true, force: true });
    if (this.activeDraftId === plan.draftId) this.activeDraftId = null;
    for (const sessionId of plan.sessionIds) this.liveSessionIds.delete(sessionId);
  }

  /** Final deletion step is deliberately separate so a journal can resume it. */
  async removeDraftRoot(plan: HarnessDraftDeletionPlan): Promise<void> {
    this.assertDeletionPlan(plan);
    await rm(this.rootOf(plan.draftId), { recursive: true, force: true });
  }

  async removeDraft(id: string): Promise<void> {
    const plan = await this.prepareDraftDeletion(id);
    await this.cancelHarnessSessions(plan);
    await this.deleteHarnessData(plan);
    await this.removeDraftRoot(plan);
  }

  async dispose(): Promise<void> {
    const current = this.active;
    const starting = this.startingChild;
    this.active = null;
    this.activeDraftId = null;
    this.liveSessionIds.clear();
    this.webSearchConfigured = undefined;
    this.startingChild = null;
    for (const id of this.authoringPolls.keys()) this.stopAuthoringPoll(id);
    const planning = [...this.authoringPlans.values()].map((entry) => entry.promise);
    for (const id of this.authoringPlans.keys()) this.abortAuthoringPlan(id);
    if (current) await stopChild(current.child);
    if (starting && starting !== current?.child) await stopChild(starting);
    // Drain only local request/metadata commits, not a model turn or still render.
    await settleBounded([...this.authoringWrites], 3_000);
    await settleBounded(planning, 3_000);
  }

  private async toVm(
    record: DraftRecord,
    assetReview?: AgentAssetVM[],
    assetCollectionError?: string,
    briefReview?: AgentBriefVM,
    briefReviewError?: string,
    activities?: AgentActivityVM[],
    needsAttention?: boolean,
  ): Promise<AgentDraftVM> {
    const createReady = record.productionState === "queued_create"
      && (existsSync(join(this.rootOf(record.id), BRIEF_FILE))
        || existsSync(join(this.rootOf(record.id), LEGACY_CREATE_REQUEST_FILE)));
    const updatedAt = await stat(join(this.rootOf(record.id), METADATA_FILE))
      .then((value) => value.mtime.toISOString())
      .catch((_error) => record.createdAt);
    return {
      ...record,
      updatedAt,
      ...(this.active && this.activeDraftId === record.id && record.sessionId
        ? { harnessUrl: `${this.active.url}?session=${encodeURIComponent(record.sessionId)}&embedded=motionreal`, searchProvider: this.active.searchProvider }
        : {}),
      ...(this.active && this.activeDraftId === record.id && this.webSearchConfigured !== undefined
        ? { webSearchConfigured: this.webSearchConfigured }
        : {}),
      sessionAccess: record.sessionPolicyRevision === SESSION_POLICY_REVISION ? "full" : "legacy-approval",
      createReady,
      ...(activities?.length ? { activities } : {}),
      ...(needsAttention ? { needsAttention: true } : {}),
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
      const metadataPath = join(this.rootOf(id), METADATA_FILE);
      let raw = objectOf(JSON.parse(await readFile(metadataPath, "utf8")));
      const title = raw.title;
      const createdAt = raw.createdAt;
      if (!raw || raw.id !== id || typeof title !== "string" || typeof createdAt !== "string") return null;
      let workflow = parseAgentWorkflow(raw);
      if (!workflow) {
        const repaired = repairLegacyResumeResidue(raw);
        if (!repaired) return null;
        workflow = parseAgentWorkflow(repaired);
        if (!workflow) return null;
        await writeJson(metadataPath, repaired);
        raw = repaired;
        log.warn({ draftId: id }, "repaired legacy pausedFrom residue after resume");
      }
      if (raw.workflowVersion !== workflow.workflowVersion || raw.productionState !== workflow.productionState) {
        const migrated = { ...raw, ...workflow };
        if (!workflow.pausedFrom) delete migrated.pausedFrom;
        if (!workflow.lastError) delete migrated.lastError;
        await writeJson(metadataPath, migrated);
        raw = migrated;
        log.info({ draftId: id, workflowVersion: workflow.workflowVersion }, "migrated Agent workflow metadata");
      }
      const record: DraftRecord = {
        id,
        title,
        createdAt,
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
        ...(raw.sessionPolicyRevision === SESSION_POLICY_REVISION
          ? { sessionPolicyRevision: SESSION_POLICY_REVISION }
          : {}),
        ...((raw.repairPhase === "authoring" || raw.repairPhase === "visual_refine")
          && Number.isSafeInteger(raw.repairAttempts) && Number(raw.repairAttempts) > 0
          ? { repairPhase: raw.repairPhase, repairAttempts: Number(raw.repairAttempts) }
          : {}),
        ...(isRetryableFailurePhase(raw.failedPhase) ? { failedPhase: raw.failedPhase } : {}),
        ...(typeof raw.awaitingArtifactPromptId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw.awaitingArtifactPromptId)
          ? { awaitingArtifactPromptId: raw.awaitingArtifactPromptId }
          : {}),
        ...(raw.productionState === "error" && raw.retryAction === "rerender_stills" ? { retryAction: "rerender_stills" as const } : {}),
        ...(Array.isArray(raw.selectedAssetIds)
          ? { selectedAssetIds: raw.selectedAssetIds.filter((value): value is string => typeof value === "string") }
          : {}),
      };
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

  private assertDeletionPlan(plan: HarnessDraftDeletionPlan): void {
    if (plan.version !== 1 || !/^agent-[0-9a-f-]{36}$/i.test(plan.draftId)) {
      throw new Error("Kế hoạch xóa Agent không hợp lệ.");
    }
    if (resolve(plan.draftRoot) !== resolve(this.rootOf(plan.draftId))) {
      throw new Error("Kế hoạch xóa Agent trỏ ra ngoài thư mục draft.");
    }
    if (!Array.isArray(plan.sessionIds) || plan.sessionIds.some((id) => id.length === 0 || id.length > 240)) {
      throw new Error("Kế hoạch xóa Agent có session không hợp lệ.");
    }
  }

  /** Resolve exact session directories with the pinned Harness' encoding. */
  private async persistedSessionDirs(plan: HarnessDraftDeletionPlan): Promise<string[]> {
    const sessionsRoot = join(this.deps.harnessHome, "sessions");
    const rootReal = await realpath(sessionsRoot).catch((_missingSessionsRoot) => null);
    if (!rootReal) return [];
    const projectDirectory = join(rootReal, harnessSessionProjectKey(plan.draftRoot));
    const directories: string[] = [];
    for (const sessionId of plan.sessionIds) {
      const candidate = join(projectDirectory, harnessSessionSegment(sessionId));
      const targetReal = await realpath(candidate).catch((_missingSession) => null);
      if (!targetReal) continue;
      assertChildPath(rootReal, targetReal, "Harness session");
      const info = await stat(targetReal);
      if (!info.isDirectory()) throw new Error("Dữ liệu session Harness không phải thư mục.");
      directories.push(targetReal);
    }
    return [...new Set(directories)];
  }

  /** Fail closed if the physical session layout has not been re-reviewed. */
  private async assertPinnedHarnessSessionLayout(): Promise<void> {
    const revision = this.deps.harnessRevision
      ? await this.deps.harnessRevision()
      : await harnessCheckoutRevision(this.deps.harnessCliPath);
    if (revision !== HARNESS_SESSION_LAYOUT_COMMIT) {
      throw new Error("Không xóa lịch sử Harness vì phiên bản lưu session không khớp bản đã kiểm chứng.");
    }
  }

  private requireActiveSession(record: DraftRecord): void {
    if (!this.active || !record.sessionId) {
      throw new Error("Harness chưa sẵn sàng cho phiên Agent này. Hãy mở lại workspace Agent rồi thử lại.");
    }
  }

  private async promptSession(record: DraftRecord, text: string): Promise<unknown> {
    this.requireActiveSession(record);
    const rpcId = randomUUID();
    if (isArtifactAwaitingState(record.productionState)) {
      await this.writeRecord({ ...record, awaitingArtifactPromptId: rpcId });
    }
    return this.rpc(this.active!.url, "session.prompt", {
      sessionId: record.sessionId,
      mode: "queue",
      content: [{ type: "text", text }],
    }, this.rpcTimeoutMs, rpcId);
  }

  private async readSafeActivities(record: DraftRecord): Promise<{ activities: AgentActivityVM[]; needsAttention: boolean; artifactPromptEnded: boolean } | undefined> {
    if (!this.active || !record.sessionId) return undefined;
    const raw = await this.rpc(this.active.url, "session.history", {
      sessionId: record.sessionId,
      // Asset and brief turns can contain many image reads. This bounded window
      // keeps the originating prompt and its terminal turn event together.
      maxMessages: isArtifactAwaitingState(record.productionState) ? 80 : 12,
    });
    const activities: AgentActivityVM[] = [];
    const calls = new Map<string, AgentActivityVM>();
    let needsAttention = false;
    let currentTurn: number | undefined;
    let awaitedTurn: number | undefined;
    let artifactPromptEnded = false;
    for (const entryValue of arrayOf(objectOf(raw).events)) {
      const event = objectOf(objectOf(entryValue).event);
      const seq = Number.isSafeInteger(event.seq) ? Number(event.seq) : undefined;
      const data = objectOf(event.data);
      if (event.type === "turn/start" && Number.isSafeInteger(data.turn)) currentTurn = Number(data.turn);
      if (event.type === "user/message" && isAwaitedArtifactPrompt(data, record)) {
        awaitedTurn = currentTurn;
      }
      if (event.type === "turn/end" && awaitedTurn !== undefined && data.turn === awaitedTurn) {
        artifactPromptEnded = true;
      }
      if (event.type === "tool/call" && seq !== undefined) {
        const label = safeActivityLabel(data.name);
        const callId = stringOf(data.callId);
        if (!label || !callId) continue;
        const activity: AgentActivityVM = { id: String(seq), label, status: "running" };
        activities.push(activity);
        calls.set(callId, activity);
        if (data.name === "ask_user_question") needsAttention = true;
      }
      if (event.type === "tool/result") {
        const message = objectOf(data.message);
        const source = objectOf(message.source);
        const nested = objectOf(arrayOf(message.content)[0]);
        const callId = stringOf(data.callId) ?? stringOf(source.callId) ?? stringOf(nested.toolCallId);
        const failed = data.error !== undefined || nested.isError === true;
        const activity = calls.get(callId ?? "");
        if (activity) activity.status = failed ? "failed" : "completed";
        if (activity?.label === "Đang chờ câu trả lời") needsAttention = false;
      }
      if (event.type === "permission/request" || event.type === "permission/pending" || event.type === "question/request" || event.type === "question/pending") needsAttention = true;
      if (event.type === "permission/resolved" || event.type === "question/resolved") needsAttention = false;
    }
    return { activities: activities.slice(-8), needsAttention, artifactPromptEnded };
  }

  /** Persist only the choice. Never restart a live model turn to apply it. */
  async setSearchProvider(id: string, provider: unknown): Promise<void> {
    const record = await this.mustReadRecord(id);
    this.requireActiveSession(record);
    if (provider !== "deepseek" && provider !== "exa") throw new Error("Dịch vụ tìm kiếm không hợp lệ.");
    await writeJson(join(this.deps.harnessHome, SEARCH_CONFIG_FILE), { provider });
  }

  private async readSearchProvider(): Promise<AgentSearchProvider> {
    try {
      const config: unknown = JSON.parse(await readFile(join(this.deps.harnessHome, SEARCH_CONFIG_FILE), "utf8"));
      const provider = config && typeof config === "object" ? (config as { provider?: unknown }).provider : undefined;
      if (provider === "deepseek" || provider === "exa") return provider;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "deepseek";
      log.warn({ err: error }, "Harness search configuration unreadable");
    }
    throw new Error("Cấu hình dịch vụ tìm kiếm Harness không hợp lệ; chưa khởi động Harness.");
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

  async settings(id: string): Promise<AgentSettingsVM> {
    const record = await this.mustReadRecord(id);
    this.requireActiveSession(record);
    const [models, access] = await Promise.all([
      this.readModelSettings(record),
      this.readAccessSettings(record),
    ]);
    return {
      searchProvider: await this.readSearchProvider(),
      webSearchConfigured: this.webSearchConfigured === true,
      currentModelId: models.currentModelId,
      modelOptions: models.options.map(({ id: optionId, label }) => ({ id: optionId, label })),
      currentAccessId: access.currentAccessId,
      accessOptions: access.options,
    };
  }

  async selectModel(id: string, modelId: string): Promise<AgentSettingsVM> {
    const record = await this.mustReadRecord(id);
    this.requireActiveSession(record);
    const models = await this.readModelSettings(record);
    const selected = models.options.find((option) => option.id === modelId);
    if (!selected) throw new Error("Model không tồn tại trong catalog của phiên Agent.");
    await this.rpc(this.active!.url, "session.selectModel", {
      sessionId: record.sessionId,
      provider: selected.provider,
      model: selected.model,
    });
    return this.settings(id);
  }

  async setAccess(id: string, presetId: string): Promise<AgentSettingsVM> {
    const record = await this.mustReadRecord(id);
    this.requireActiveSession(record);
    const access = await this.readAccessSettings(record);
    if (!access.options.some((option) => option.id === presetId)) {
      throw new Error("Mức quyền không tồn tại trong catalog của phiên Agent.");
    }
    await this.rpc(this.active!.url, "commands/execute", {
      args: { agentId: record.sessionId, line: `/permission ${presetId}`, images: [] },
    });
    return this.settings(id);
  }

  private async readModelSettings(record: DraftRecord): Promise<{
    currentModelId?: string;
    options: Array<{ id: string; label: string; provider: string; model: string }>;
  }> {
    const raw = await this.rpc(this.active!.url, "session.models", { sessionId: record.sessionId });
    const value = objectOf(raw);
    const current = objectOf(value.current);
    const options: Array<{ id: string; label: string; provider: string; model: string }> = [];
    for (const groupValue of arrayOf(value.groups)) {
      const group = objectOf(groupValue);
      const provider = stringOf(group.id);
      if (!provider) continue;
      for (const modelValue of arrayOf(group.models)) {
        const model = objectOf(modelValue);
        const modelName = stringOf(model.id);
        if (!modelName) continue;
        options.push({
          id: modelOptionId(provider, modelName),
          label: stringOf(model.name) ?? modelName,
          provider,
          model: modelName,
        });
      }
    }
    const currentProvider = stringOf(current.provider);
    const currentModel = stringOf(current.model);
    return {
      ...(currentProvider && currentModel ? { currentModelId: modelOptionId(currentProvider, currentModel) } : {}),
      options,
    };
  }

  private async readAccessSettings(record: DraftRecord): Promise<{
    currentAccessId?: string;
    options: AgentSettingsVM["accessOptions"];
  }> {
    const raw = await this.rpc(this.active!.url, "session.history", { sessionId: record.sessionId, maxMessages: 1 });
    const projections = objectOf(objectOf(raw).projections);
    const permissions = objectOf(objectOf(projections.values).permissions);
    const options = arrayOf(permissions.options).flatMap((value) => {
      const option = objectOf(value);
      const optionId = stringOf(option.value);
      if (!optionId) return [];
      return [{
        id: optionId,
        label: accessLabel(optionId, stringOf(option.name)),
        ...(stringOf(option.description) ? { description: stringOf(option.description)! } : {}),
        requiresConfirmation: optionId === "danger-full-access",
      }];
    });
    return {
      ...(stringOf(permissions.currentValue) ? { currentAccessId: stringOf(permissions.currentValue)! } : {}),
      options,
    };
  }

  private async readSearchCredentialStatus(url: string): Promise<boolean> {
    const value = await this.rpc(url, "credentials.describe", { refs: ["DEEPSEEK_API_KEY"] });
    if (!value || typeof value !== "object") return false;
    const credentials = (value as { credentials?: unknown }).credentials;
    if (!credentials || typeof credentials !== "object") return false;
    const search = (credentials as Record<string, unknown>).DEEPSEEK_API_KEY;
    return Boolean(search && typeof search === "object" && (search as { configured?: unknown }).configured === true);
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
        "Tải ảnh raster PNG/JPEG/WebP tĩnh vào assets/. Logo nên là PNG nền trong suốt; SVG hoặc GIF ngoài phải rasterize an toàn sang PNG hoặc bỏ qua.",
        "Gắn role cho từng asset: hero, support, logo hoặc icon. Role mô tả cách hiển thị, không phải kích thước file.",
        "Chỉ giữ asset có đóng góp nội dung/hình ảnh cụ thể cho video. Không tải hàng loạt ảnh tương tự; logo/icon chỉ bổ trợ và không thay thế ảnh minh họa hoặc motion.",
        "Asset pool thường 3–12 tệp; chỉ vượt khi nội dung thật sự cần các hình khác biệt.",
        "Giữ lại các asset id được yêu cầu nếu chúng vẫn có trong manifest mới.",
        "Gọi motionreal_submit_assets với manifest hoàn chỉnh; không tự ghi file output.",
      ],
    });
  }

  private async writeBriefRequest(
    record: DraftRecord,
    revision?: { baseBrief: AgentBriefVM; feedback: string },
  ): Promise<void> {
    await mkdir(join(this.rootOf(record.id), "handoff"), { recursive: true });
    await writeJson(join(this.rootOf(record.id), BRIEF_REQUEST_FILE), {
      version: 1,
      job_id: record.activeJobId,
      request_revision: record.briefRequestRevision,
      selected_asset_ids: record.selectedAssetIds ?? [],
      asset_manifest: "handoff/assets.json",
      output: "handoff/brief.generated.json",
      brief: {
        version: 1,
        job_id: record.activeJobId,
        request_revision: record.briefRequestRevision,
        brief_revision: 1,
        title: record.title,
        prompt: "Brief nội dung tổng thể để người dùng duyệt trước khi chọn thời lượng và giọng đọc",
        format: "tiktok",
        video_language: "vi",
        selected_asset_ids: record.selectedAssetIds ?? [],
      },
      ...(revision ? {
        base_brief: {
          title: revision.baseBrief.title,
          prompt: revision.baseBrief.prompt,
          video_language: revision.baseBrief.videoLanguage,
          selected_asset_ids: revision.baseBrief.selectedAssetIds,
        },
        feedback: revision.feedback,
      } : {}),
      instructions: [
        "Tổng hợp cuộc trò chuyện và chỉ các asset đã chọn thành brief nội dung video 9:16.",
        "Prompt phải mô tả mục tiêu, khán giả, fact cần truyền đạt, narrative arc, visual direction và ý định dùng asset đủ rõ cho authoring.",
        "Không quyết định hoặc ghi duration_tier, target_seconds, voice_provider, scene count hay scene budget: người dùng chọn sau khi duyệt brief.",
        "Asset là pool đã duyệt, không phải checklist. Chỉ mô tả cách dùng asset thực sự góp phần vào nội dung.",
        "Gọi motionreal_submit_brief với title, prompt, video_language và selected_asset_ids; không tự ghi file output.",
      ],
    });
  }

  private async readGeneratedBrief(record: DraftRecord): Promise<AgentBriefVM | undefined> {
    const generatedPath = join(this.rootOf(record.id), BRIEF_GENERATED_FILE);
    // `brief.json` was the generated handoff before the split.  Read it only
    // when it is not an accepted brief, so old in-progress drafts remain usable.
    const path = existsSync(generatedPath) ? generatedPath : join(this.rootOf(record.id), BRIEF_FILE);
    if (!existsSync(path)) return undefined;
    let raw: unknown;
    try {
      raw = parseJson(await readFile(path, "utf8"));
    } catch (_error) {
      throw new Error("Brief chưa phải JSON hoàn chỉnh.");
    }
    if (!raw || typeof raw !== "object") throw new Error("Brief của Agent không hợp lệ.");
    const value = raw as Record<string, unknown>;
    if (value.accepted === true && path !== generatedPath) return undefined;
    if (value.version !== 1 || value.job_id !== record.activeJobId || value.request_revision !== record.briefRequestRevision) {
      throw new Error("Brief không khớp job hoặc lượt yêu cầu hiện tại.");
    }
    if (!Number.isSafeInteger(value.brief_revision) || Number(value.brief_revision) < 1) {
      throw new Error("Brief thiếu revision hợp lệ.");
    }
    if (value.format !== "tiktok") throw new Error("Brief phải dùng định dạng video dọc 9:16.");
    const videoLanguage = validateVideoLanguage(value.video_language);
    const selectedAssetIds = validateBriefAssetIds(value.selected_asset_ids, record.selectedAssetIds ?? []);
    return {
      revision: Number(value.brief_revision),
      title: validBriefText(value.title, "tiêu đề", 1, 160),
      prompt: validBriefText(value.prompt, "nội dung", 20, 20_000),
      format: "tiktok",
      videoLanguage,
      selectedAssetIds,
    };
  }

  private async readAcceptedBrief(record: DraftRecord): Promise<AgentAcceptedBrief | undefined> {
    const path = join(this.rootOf(record.id), BRIEF_FILE);
    if (!existsSync(path)) return undefined;
    let raw: unknown;
    try { raw = parseJson(await readFile(path, "utf8")); }
    catch (_error) { throw new Error("Brief đã duyệt chưa phải JSON hoàn chỉnh."); }
    if (!raw || typeof raw !== "object") throw new Error("Brief đã duyệt không hợp lệ.");
    const value = raw as Record<string, unknown>;
    if (value.accepted !== true) return undefined;
    if (value.version !== 1 || value.job_id !== record.activeJobId || value.request_revision !== record.briefRequestRevision) {
      throw new Error("Brief đã duyệt không khớp job hoặc lượt yêu cầu hiện tại.");
    }
    if (!Number.isSafeInteger(value.brief_revision) || Number(value.brief_revision) < 1) {
      throw new Error("Brief đã duyệt thiếu revision hợp lệ.");
    }
    if (value.format !== "tiktok") throw new Error("Brief phải dùng định dạng video dọc 9:16.");
    const fields = validateAcceptedBriefFields(value);
    return {
      revision: Number(value.brief_revision),
      title: validBriefText(value.title, "tiêu đề", 1, 160),
      prompt: validBriefText(value.prompt, "nội dung", 20, 20_000),
      format: "tiktok",
      ...fields,
      selectedAssetIds: validateBriefAssetIds(value.selected_asset_ids, record.selectedAssetIds ?? []),
    };
  }

  private maybeProcessAuthoring(record: DraftRecord): void {
    if (!this.active) return;
    if (!this.deps.renderAuthoringStills || !this.deps.acceptAuthoringStills) return;
    if (this.authoringInFlight.has(record.id) || !existsSync(join(this.rootOf(record.id), "handoff", "authoring.json"))) return;
    this.authoringInFlight.add(record.id);
    void this.processAuthoring(record).catch(async (error) => {
      if (!this.active) {
        log.debug({ err: error, draftId: record.id }, "Harness stopped; keep durable authoring request for resume");
        return;
      }
      if (!await this.isCurrentAuthoringRecord(record)) return;
      if (!isRepairableAuthoringError(error)) {
        log.warn({ err: error, draftId: record.id, projectId: record.projectId }, "Harness authoring infrastructure failure; preserving submission for retry");
        await this.recordWorkflowError(record, error, error instanceof AuthoringStillRenderError ? "rerender_stills" : undefined);
        return;
      }
      log.warn({ err: error, draftId: record.id, projectId: record.projectId }, "Harness authored content failed validation; requesting repair");
      try {
        await this.requestAuthoringRepair(record, error instanceof Error ? error.message : "Không kiểm tra được scene Harness.");
      } catch (repairError) {
        log.error({ err: repairError, draftId: record.id, projectId: record.projectId }, "failed to request Harness authoring repair");
        const latest = await this.readRecord(record.id);
        if (latest && isAutomatedAuthoringState(latest.productionState)) {
          await this.recordWorkflowError(latest, repairError);
        }
      }
    }).finally(() => this.authoringInFlight.delete(record.id));
  }

  private scheduleAuthoringPoll(id: string): void {
    if (!this.deps.renderAuthoringStills || !this.deps.acceptAuthoringStills || this.authoringPolls.has(id)) return;
    const tick = async () => {
      this.authoringPolls.delete(id);
      if (!this.active) return;
      const record = await this.readRecord(id).catch((error) => {
        log.debug({ err: error, draftId: id }, "Harness authoring poll record unreadable; stopping poll");
        return null;
      });
      if (!this.active || !record || !isAutomatedAuthoringState(record.productionState)) return;
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
    const projectRoot = await realpath(join(root, PROJECT_LINK));
    if (request.phase === "visual_refine") {
      await writeJson(manifestPath, paced.manifest);
      await this.processVisualRefine(record, request, submission, sceneIds, projectRoot);
      return;
    }
    if (!await this.isCurrentAuthoringRecord(record)) return;
    await writeJson(manifestPath, paced.manifest);
    const renderSceneIds = request.phase === "edit"
      ? this.requestEditSceneIds(request, sceneIds)
      : sceneIds;
    const sourceFingerprint = await harnessReviewFingerprint(projectRoot);
    const rendered = await this.deps.renderAuthoringStills!(record.projectId!, renderSceneIds);
    if (!rendered.ok) throw new AuthoringStillRenderError(rendered.error, rendered.repairable);
    if (rendered.stills.length !== renderSceneIds.length || new Set(rendered.stills).size !== renderSceneIds.length) {
      throw new AuthoringStillRenderError("MotionReal chưa render đủ still riêng cho mọi cảnh.", false);
    }
    if (await harnessReviewFingerprint(projectRoot) !== sourceFingerprint) {
      throw new AuthoringStillRenderError("Source/asset đã đổi trong lúc render still; cần render lại trước khi review.", false);
    }
    if (!await this.isCurrentAuthoringRecord(record)) return;
    await this.beginVisualRefineOrSceneReview(record, sceneIds, projectRoot, rendered.stills, renderSceneIds);
  }

  private async authoringRefinePolicy(projectId: string): Promise<{ refinePasses: number; refineEarlyStop: boolean }> {
    const configured = await this.deps.authoringRefinePolicy?.(projectId);
    const refinePasses = Number.isFinite(configured?.refinePasses)
      ? Math.min(5, Math.max(0, Math.floor(configured!.refinePasses)))
      : 0;
    return { refinePasses, refineEarlyStop: configured?.refineEarlyStop === true };
  }

  private async beginVisualRefineOrSceneReview(
    record: DraftRecord,
    sceneIds: string[],
    projectRoot: string,
    stills: string[],
    reviewSceneIds: string[] = sceneIds,
  ): Promise<void> {
    const policy = await this.authoringRefinePolicy(record.projectId!);
    if (policy.refinePasses === 0) {
      await this.finishHarnessSceneReview(record);
      return;
    }
    const refining = { ...record, ...transitionAgentWorkflow(record, {
      expectedRevision: record.workflowRevision,
      to: "visual_refine",
      jobId: record.activeJobId,
    }) };
    await this.writeRecord(refining);
    await this.enqueueVisualRefine(refining, sceneIds, projectRoot, stills, 1, 0, reviewSceneIds);
  }

  private async enqueueVisualRefine(
    record: DraftRecord,
    sceneIds: string[],
    projectRoot: string,
    stills: string[],
    pass: number,
    cleanStreak: number,
    reviewSceneIds: string[] = sceneIds,
  ): Promise<void> {
    const stillRefs = this.projectStillRefs(projectRoot, stills);
    await this.advanceAuthoringRequest(record, {
      phase: "visual_refine",
      stills: stillRefs,
      review_scene_ids: reviewSceneIds,
      review_fingerprint: await harnessReviewFingerprint(projectRoot, stills),
      scene_fingerprints: await harnessSceneFingerprints(projectRoot),
      visual_refine_pass: pass,
      visual_refine_clean_streak: cleanStreak,
      render_error: undefined,
      instructions: [
        "Dùng read_image mở mọi PNG trong stills trước khi nhận xét. Không kết luận chỉ từ code.",
        "Chỉ sửa các cảnh có lỗi trực quan cụ thể. Giữ nguyên cảnh đã sạch; không viết lại toàn video vì đây không phải V2 bắt buộc.",
        "Nếu sửa source/asset, gọi motionreal_submit_authoring sau khi sửa. Nếu ảnh đã sạch, không sửa code và submit review_notes nêu rõ quan sát.",
        "review_notes phải nêu lỗi cụ thể đã sửa hoặc lý do ảnh sạch. reviewed_scene_ids phải chứa đúng review_scene_ids.",
      ],
    }, `MotionReal đã render still cho visual refine lượt ${pass}. Hãy đọc handoff/authoring-request.json, dùng read_image xem ảnh thật, chỉ sửa lỗi trực quan cụ thể rồi submit lại.`);
  }

  private async processVisualRefine(
    record: DraftRecord,
    request: Record<string, unknown>,
    submission: Record<string, unknown>,
    sceneIds: string[],
    projectRoot: string,
  ): Promise<void> {
    const reviewed = Array.isArray(submission.reviewed_scene_ids)
      ? submission.reviewed_scene_ids.filter((id): id is string => typeof id === "string")
      : [];
    const reviewSceneIds = this.requestReviewSceneIds(request, sceneIds);
    if (!sameIds(reviewed, reviewSceneIds) || typeof submission.review_notes !== "string" || !submission.review_notes.trim()) {
      throw new Error("Harness chưa xác nhận đã xem đủ still trong phạm vi visual refine.");
    }
    const stills = this.requestStillPaths(request, reviewSceneIds, projectRoot);
    const expectedFingerprint = typeof request.review_fingerprint === "string" ? request.review_fingerprint : "";
    if (!expectedFingerprint) throw new Error("Visual refine thiếu fingerprint của still hiện tại.");
    await this.verifyImageReads(record, request);
    const sourceFingerprint = await harnessReviewFingerprint(projectRoot, stills);
    const currentSceneFingerprints = await harnessSceneFingerprints(projectRoot);
    const pass = validVisualRefinePass(request.visual_refine_pass);
    const cleanStreak = validCleanStreak(request.visual_refine_clean_streak);
    const policy = await this.authoringRefinePolicy(record.projectId!);

    if (sourceFingerprint === expectedFingerprint) {
      const nextClean = cleanStreak + 1;
      if (pass >= policy.refinePasses || (policy.refineEarlyStop && nextClean >= 2)) {
        await this.finishHarnessSceneReview(record);
        return;
      }
      await this.enqueueVisualRefine(record, sceneIds, projectRoot, stills, pass + 1, nextClean, reviewSceneIds);
      return;
    }

    const changedSceneIds = changedVisualSceneIds(this.requestSceneFingerprints(request, sceneIds), currentSceneFingerprints, sceneIds);
    const renderScope = changedSceneIds.length > 0 ? changedSceneIds : sceneIds;
    const beforeRender = await harnessReviewFingerprint(projectRoot);
    const rendered = await this.deps.renderAuthoringStills!(record.projectId!, renderScope);
    if (!rendered.ok) throw new AuthoringStillRenderError(rendered.error, rendered.repairable);
    if (rendered.stills.length !== renderScope.length || new Set(rendered.stills).size !== renderScope.length) {
      throw new AuthoringStillRenderError("MotionReal chưa render đủ still riêng cho các cảnh đã sửa.", false);
    }
    if (await harnessReviewFingerprint(projectRoot) !== beforeRender) {
      throw new AuthoringStillRenderError("Source/asset đã đổi trong lúc render still; cần render lại trước khi review.", false);
    }
    if (!await this.isCurrentAuthoringRecord(record)) return;
    if (pass >= policy.refinePasses) {
      await this.finishHarnessSceneReview(record);
      return;
    }
    await this.enqueueVisualRefine(record, sceneIds, projectRoot, rendered.stills, pass + 1, 0, renderScope);
  }

  private projectStillRefs(projectRoot: string, stills: string[]): string[] {
    return stills.map((path) => {
      const rel = relative(projectRoot, path);
      if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("Still render nằm ngoài project Harness.");
      return `${PROJECT_LINK}/${rel.replaceAll("\\", "/")}`;
    });
  }

  private requestStillPaths(request: Record<string, unknown>, sceneIds: string[], projectRoot: string): string[] {
    if (!Array.isArray(request.stills) || request.stills.length !== sceneIds.length
      || request.stills.some((path) => typeof path !== "string" || !path.startsWith("project/"))) {
      throw new Error("Visual refine không có đủ still hợp lệ.");
    }
    return request.stills.map((path) => join(projectRoot, (path as string).slice("project/".length)));
  }

  private requestReviewSceneIds(request: Record<string, unknown>, sceneIds: string[]): string[] {
    if (request.review_scene_ids === undefined) return sceneIds;
    if (!Array.isArray(request.review_scene_ids)
      || request.review_scene_ids.some((id) => typeof id !== "string")) {
      throw new Error("Visual refine có phạm vi scene không hợp lệ.");
    }
    const ids = request.review_scene_ids as string[];
    if (!sameIds(ids, [...new Set(ids)]) || ids.length === 0 || ids.some((id) => !sceneIds.includes(id))) {
      throw new Error("Visual refine có phạm vi scene không hợp lệ.");
    }
    return ids;
  }

  private requestEditSceneIds(request: Record<string, unknown>, sceneIds: string[]): string[] {
    if (!Array.isArray(request.target_scene_ids)
      || request.target_scene_ids.some((id) => typeof id !== "string")) {
      throw new Error("Yêu cầu sửa cảnh không có phạm vi scene hợp lệ.");
    }
    const ids = request.target_scene_ids as string[];
    if (!sameIds(ids, [...new Set(ids)]) || ids.length === 0 || ids.some((id) => !sceneIds.includes(id))) {
      throw new Error("Yêu cầu sửa cảnh không có phạm vi scene hợp lệ.");
    }
    return ids;
  }

  private requestSceneFingerprints(request: Record<string, unknown>, sceneIds: string[]): HarnessSceneFingerprints | undefined {
    const value = request.scene_fingerprints;
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const candidate = value as { global?: unknown; scenes?: unknown };
    if (typeof candidate.global !== "string" || !candidate.scenes || typeof candidate.scenes !== "object" || Array.isArray(candidate.scenes)) {
      return undefined;
    }
    const scenes = candidate.scenes as Record<string, unknown>;
    if (!sceneIds.every((id) => typeof scenes[id] === "string")) return undefined;
    return { global: candidate.global, scenes: Object.fromEntries(sceneIds.map((id) => [id, scenes[id] as string])) };
  }

  private async finishHarnessSceneReview(record: DraftRecord): Promise<void> {
    if (!await this.isCurrentAuthoringRecord(record)) return;
    await this.deps.acceptAuthoringStills!(record.projectId!);
    const latest = await this.mustReadRecord(record.id);
    if (!isSameAuthoringWork(latest, record)) return;
    const next = { ...latest, ...transitionAgentWorkflow(latest, {
      expectedRevision: latest.workflowRevision,
      to: "scene_review",
      jobId: latest.activeJobId,
    }) };
    this.stopAuthoringPoll(record.id);
    await this.writeRecord(next);
  }

  private async requestAuthoringRepair(record: DraftRecord, message: string): Promise<void> {
    const latest = await this.mustReadRecord(record.id);
    if (!isSameAuthoringWork(latest, record)) return;
    const requestPath = join(this.rootOf(record.id), AUTHORING_REQUEST_FILE);
    const request = parseJson(await readFile(requestPath, "utf8")) as Record<string, unknown>;
    const visualRefine = request.phase === "visual_refine";
    const repairPhase = visualRefine ? "visual_refine" : "authoring";
    const previousAttempts = latest.repairPhase === repairPhase ? latest.repairAttempts ?? 0 : 0;
    const maxAttempts = authoringRepairLimit(await this.deps.maxAuthoringRepairs?.(latest.projectId ?? ""));
    if (previousAttempts >= maxAttempts) {
      this.stopAuthoringPoll(latest.id);
      await this.recordWorkflowError(latest, `Agent đã thử sửa ${maxAttempts} lần ở bước ${repairPhase} nhưng scene vẫn chưa hợp lệ. Hãy thử lại bước này.`);
      return;
    }
    const repairRecord: DraftRecord = {
      ...latest,
      repairPhase,
      repairAttempts: previousAttempts + 1,
    };
    await this.writeRecord(repairRecord);
    await this.advanceAuthoringRequest(repairRecord, {
      phase: visualRefine ? "visual_refine" : "repair",
      pacing: await this.authoringPacing(latest),
      render_error: message.slice(0, 2_000),
      ...(visualRefine ? {} : { stills: [] }),
      instructions: [
        visualRefine
          ? "Đọc render_error và hoàn tất visual refine. Không sửa code nếu lỗi chỉ là thiếu reviewed_scene_ids/review_notes; source hoặc ảnh đổi sẽ được render lại theo pass còn lại."
          : "MotionReal không validate/render được scene hiện tại. Đọc render_error, kiểm tra manifest và mọi module TSX rồi sửa tận gốc.",
        ...(visualRefine ? ["Dùng read_image mở lại mọi PNG trong stills. Nếu đọc ảnh lỗi, báo lỗi thay vì xác nhận đã review; chỉ submit đủ reviewed_scene_ids cùng review_notes sau khi xem ảnh."] : []),
        "Gọi lại motionreal_submit_authoring bằng request_revision mới sau khi sửa.",
      ],
    }, visualRefine
      ? "MotionReal chưa nhận được visual refine hợp lệ. Đọc render_error trong authoring-request.json và hoàn tất review theo revision mới."
      : "MotionReal chưa validate/render được scene. Hãy đọc render_error trong handoff/authoring-request.json, sửa project/ rồi submit authoring revision mới.");
  }

  private async readRequiredBrief(record: DraftRecord): Promise<AgentAcceptedBrief> {
    const brief = await this.readAcceptedBrief(record);
    if (!brief) throw new Error("Không tìm thấy brief đã duyệt cho authoring Harness.");
    return brief;
  }

  private async authoringPacing(record: DraftRecord): Promise<HarnessAuthoringPacing> {
    if (!record.projectId) throw new Error("Project Harness chưa được liên kết.");
    const brief = await this.readRequiredBrief(record);
    const wordsPerSecond = await this.deps.wordsPerSecond?.(record.projectId);
    return buildHarnessAuthoringPacing(brief.durationTier, brief.videoLanguage, wordsPerSecond);
  }

  private async finishInitialAuthoringStart(record: DraftRecord): Promise<void> {
    try {
      const requestPath = join(this.rootOf(record.id), AUTHORING_REQUEST_FILE);
      const request = parseJson(await readFile(requestPath, "utf8")) as Record<string, unknown>;
      // Requests created before content planning remain resumable through the
      // legacy path. Only the explicit planning checkpoint spends a model call.
      if (request.planning === true) await this.completeInitialContentPlan(record, request);
      if (!await this.isCurrentAuthoringRecord(record)) return;
      const hasPlan = request.planning === true || ContentPlanSchema.safeParse(request.content_plan).success;
      await this.promptSession(record, hasPlan
        ? "MotionReal đã chuẩn bị content plan và project Harness. Hãy đọc handoff/authoring-request.json cùng contract, xem các asset thật, viết scene vào project/ rồi gọi motionreal_submit_authoring."
        : "MotionReal đang chờ authoring legacy hiện tại. Hãy đọc handoff/authoring-request.json, tiếp tục sửa project/ và gọi motionreal_submit_authoring khi hoàn tất.");
    } catch (error) {
      const latest = await this.readRecord(record.id).catch((_readError) => null);
      if (!latest || !isSameAuthoringWork(latest, record)) return;
      await this.recordWorkflowError(latest, error);
      throw error;
    }
    this.scheduleAuthoringPoll(record.id);
  }

  private async completeInitialContentPlan(record: DraftRecord, request: Record<string, unknown>): Promise<void> {
    if (request.version !== 1 || request.phase !== "initial"
      || request.job_id !== record.activeJobId
      || request.request_revision !== record.authoringRequestRevision) {
      throw new Error("Authoring request không khớp job hoặc revision hiện tại.");
    }
    const plan = await this.authoringContentPlan(record);
    if (!await this.isCurrentAuthoringRecord(record)) return;
    const expectedSceneIds = plan.scenes.map((scene) => scene.sceneId);
    const requestPath = join(this.rootOf(record.id), AUTHORING_REQUEST_FILE);
    await writeJson(requestPath, {
      ...request,
      planning: false,
      content_plan: plan,
      expected_scene_ids: expectedSceneIds,
    });
    if (!await this.isCurrentAuthoringRecord(record)) {
      const written = parseJson(await readFile(requestPath, "utf8")) as Record<string, unknown>;
      if (written.job_id === record.activeJobId && written.request_revision === record.authoringRequestRevision) {
        await writeJson(requestPath, request);
      }
    }
  }

  private async authoringContentPlan(record: DraftRecord): Promise<ContentPlan> {
    const artifactPath = join(this.rootOf(record.id), CONTENT_PLAN_FILE);
    const persisted = await readContentPlanArtifact(artifactPath, record);
    if (persisted) return persisted;

    const existing = this.authoringPlans.get(record.id);
    if (existing) return existing.promise;

    const controller = new AbortController();
    const promise = (async () => {
      const brief = await this.readRequiredBrief(record);
      const targetSeconds = resolveEffectiveDuration({ prompt: "", durationTier: brief.durationTier }).targetSeconds;
      const input: AuthorInput = {
        text: brief.prompt,
        urls: [],
        format: "tiktok",
        durationTier: brief.durationTier,
        targetSeconds,
        videoLanguage: brief.videoLanguage,
      };
      const plan = await this.deps.planAuthoringContent(record.projectId!, input, controller.signal);
      controller.signal.throwIfAborted();
      if (!await this.isCurrentAuthoringRecord(record)) throw new Error("Lượt lập content plan đã cũ.");
      await writeJson(artifactPath, {
        version: 1,
        job_id: record.activeJobId,
        request_revision: record.authoringRequestRevision,
        content_plan: plan,
      });
      if (!await this.isCurrentAuthoringRecord(record)) {
        await removeMatchingContentPlanArtifact(artifactPath, record);
        throw new Error("Lượt lập content plan đã cũ.");
      }
      return plan;
    })().finally(() => {
      if (this.authoringPlans.get(record.id)?.controller === controller) this.authoringPlans.delete(record.id);
    });
    this.authoringPlans.set(record.id, { controller, promise });
    return promise;
  }

  private abortAuthoringPlan(id: string): void {
    this.authoringPlans.get(id)?.controller.abort();
  }

  private async advanceAuthoringRequest(
    record: DraftRecord,
    patch: Record<string, unknown>,
    prompt: string,
  ): Promise<void> {
    const latest = await this.mustReadRecord(record.id);
    if (!isSameAuthoringWork(latest, record) && !isPendingAuthoringEdit(latest, record)) return;
    const path = join(this.rootOf(record.id), AUTHORING_REQUEST_FILE);
    const current = parseJson(await readFile(path, "utf8")) as Record<string, unknown>;
    const next = { ...record, authoringRequestRevision: (record.authoringRequestRevision ?? 0) + 1 };
    const phase = patch.phase ?? current.phase;
    const reviewAfterSeq = phase === "visual_refine"
      ? (await readHarnessReviewHistory(() => this.reviewHistoryPage(record))).lastSeq : undefined;
    this.requireActiveSession(record);
    const nextRequest = { ...current, ...patch, request_revision: next.authoringRequestRevision, review_after_seq: reviewAfterSeq };
    const commit = (async () => {
      // The old submission remains authoritative until Harness accepts the new
      // prompt. A transient RPC/provider failure must not erase the only
      // recoverable authoring result or advance its revision prematurely.
      await writeJson(path, nextRequest);
      try {
        await this.promptSession(next, prompt);
      } catch (error) {
        await writeJson(path, current);
        throw error;
      }
      await rm(join(this.rootOf(record.id), "handoff", "authoring.json"), { force: true });
      await this.writeRecord(next);
    })();
    this.authoringWrites.add(commit);
    try { await commit; } finally { this.authoringWrites.delete(commit); }
  }

  private async currentAuthoringRecord(record: DraftRecord): Promise<DraftRecord | null> {
    const latest = await this.mustReadRecord(record.id);
    return isSameAuthoringWork(latest, record) ? latest : null;
  }

  private async isCurrentAuthoringRecord(record: DraftRecord): Promise<boolean> {
    return (await this.currentAuthoringRecord(record)) !== null;
  }

  private reviewHistoryPage(record: DraftRecord, beforeSeq?: number): Promise<unknown> {
    this.requireActiveSession(record);
    return this.rpc(this.active!.url, "session.history", {
      sessionId: record.sessionId, maxMessages: 80,
      ...(beforeSeq !== undefined ? { beforeSeq } : {}),
    });
  }

  private async verifyImageReads(record: DraftRecord, request: Record<string, unknown>): Promise<void> {
    if (!Number.isSafeInteger(request.review_after_seq) || Number(request.review_after_seq) < -1) {
      throw new Error("Lượt review cũ thiếu mốc đọc ảnh; cần request review mới.");
    }
    const history = await readHarnessReviewHistory(
      (beforeSeq) => this.reviewHistoryPage(record, beforeSeq), Number(request.review_after_seq),
    );
    await assertHarnessImageReads({
      root: this.rootOf(record.id), stills: request.stills, afterSeq: request.review_after_seq, events: history.events,
    });
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

  private async recordWorkflowError(record: DraftRecord, error: unknown, retryAction?: "rerender_stills"): Promise<void> {
    const message = typeof error === "string" ? error : error instanceof Error ? error.message : "Harness không nhận yêu cầu thu thập asset.";
    const failed: DraftRecord = {
      ...record,
      ...transitionAgentWorkflow(record, {
        expectedRevision: record.workflowRevision,
        to: "error",
        jobId: record.activeJobId,
        error: message,
      }),
      ...(isRetryableFailurePhase(record.productionState) ? { failedPhase: record.productionState } : {}),
    };
    delete failed.awaitingArtifactPromptId;
    delete failed.retryAction;
    if (retryAction) failed.retryAction = retryAction;
    this.stopAuthoringPoll(record.id);
    await this.writeRecord(failed);
  }

  private async rpc(baseUrl: string, method: string, payload: unknown, timeoutMs = this.rpcTimeoutMs, rpcId = randomUUID()): Promise<unknown> {
    const controller = new AbortController();
    return raceWithTimeout((async () => {
      const response = await this.fetchImpl(`${baseUrl}api/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "client-request", rpcId, method, payload }),
        signal: controller.signal,
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
    })(), timeoutMs, () => controller.abort(), `Harness ${method} phản hồi quá lâu.`);
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

function isMissingHarnessWorkspace(error: unknown): boolean {
  return error instanceof HarnessRpcError
    && /not[-_ ]?found|unknown/i.test(`${error.code} ${error.message}`);
}

function assertChildPath(parent: string, target: string, label: string): void {
  const pathFromParent = relative(parent, target);
  if (!pathFromParent || pathFromParent === ".." || pathFromParent.startsWith(`..${"\\"}`) || isAbsolute(pathFromParent)) {
    throw new Error(`${label} nằm ngoài thư mục Harness.`);
  }
}

/** Exact copy of the reviewed Harness session-persistence path encoder. */
function harnessSessionSegment(raw: string): string {
  let encoded = "";
  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index);
    const character = String.fromCharCode(code);
    encoded += character !== "~" && /^[A-Za-z0-9._-]$/.test(character)
      ? character
      : `~${code.toString(16).toUpperCase().padStart(4, "0")}`;
  }
  return encoded;
}

/** Exact copy of the reviewed Harness project-key encoder. */
function harnessSessionProjectKey(cwd: string): string {
  let readable = "";
  let separatorRun = false;
  for (let index = 0; index < cwd.length; index += 1) {
    const code = cwd.charCodeAt(index);
    const character = String.fromCharCode(code);
    if (character === "/" || character === "\\" || character === ":") {
      if (!separatorRun) readable += "-";
      separatorRun = true;
    } else if (character !== "~" && /^[A-Za-z0-9._-]$/.test(character)) {
      readable += character;
      separatorRun = false;
    } else {
      readable += `~${code.toString(16).toUpperCase().padStart(4, "0")}`;
      separatorRun = false;
    }
  }
  return `--${(readable.replace(/^-+/, "") || "root").slice(0, 251)}--`;
}

async function harnessCheckoutRevision(cliPath: string): Promise<string> {
  const cli = resolve(cliPath);
  const sourceRoot = dirname(dirname(dirname(dirname(cli))));
  if (relative(sourceRoot, cli).replaceAll("\\", "/") !== "apps/cli/lib/bin.js") {
    throw new Error("Không xác minh được source checkout của Harness.");
  }
  const gitPointer = join(sourceRoot, ".git");
  const pointerInfo = await stat(gitPointer);
  let gitDirectory = gitPointer;
  if (!pointerInfo.isDirectory()) {
    const pointer = (await readFile(gitPointer, "utf8")).trim();
    const match = /^gitdir:\s*(.+)$/i.exec(pointer);
    if (!match) throw new Error("Không đọc được Git directory của Harness.");
    gitDirectory = resolve(sourceRoot, match[1]!);
  }
  const head = (await readFile(join(gitDirectory, "HEAD"), "utf8")).trim();
  const reference = /^ref:\s*(refs\/[A-Za-z0-9._/-]+)$/.exec(head);
  const revision = reference
    ? (await readFile(join(gitDirectory, reference[1]!), "utf8")).trim()
    : head;
  if (!/^[a-f0-9]{40}$/i.test(revision)) throw new Error("Không đọc được revision Harness.");
  return revision.toLowerCase();
}

class HarnessRpcError extends Error {
  constructor(readonly method: string, readonly code: string, detail: string) {
    super(`Harness ${method} thất bại: ${detail}`);
  }
}

function isWorkspaceNameConflict(error: unknown): boolean {
  return error instanceof HarnessRpcError && error.code === "workspace-name-conflict";
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

function validateVideoLanguage(value: unknown): VideoLanguageChoice {
  if (value !== "vi" && value !== "en") throw new Error("Brief có ngôn ngữ không hợp lệ.");
  return value;
}

function validateAcceptedBriefFields(value: Record<string, unknown>): Pick<AgentAcceptedBrief, "durationTier" | "videoLanguage" | "voiceProvider"> {
  const durationTier = value.duration_tier;
  const videoLanguage = validateVideoLanguage(value.video_language);
  const voiceProvider = value.voice_provider;
  if (durationTier !== 1 && durationTier !== 2 && durationTier !== 3 && durationTier !== 4) {
    throw new Error("Brief có thời lượng không được hỗ trợ.");
  }
  if (voiceProvider !== "vivibe" && voiceProvider !== "elevenlabs" && voiceProvider !== "vieneu") throw new Error("Brief có giọng đọc không hợp lệ.");
  if (videoLanguage === "en" && voiceProvider !== "elevenlabs") throw new Error("Brief tiếng Anh phải dùng ElevenLabs.");
  return { durationTier, videoLanguage, voiceProvider };
}

function validateBriefInput(input: AgentBriefInput): AgentBriefInput {
  if (!input || typeof input !== "object") throw new Error("Nội dung chỉnh sửa brief không hợp lệ.");
  const fields = validateAcceptedBriefFields({
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
    || generated.videoLanguage !== accepted.videoLanguage;
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

function objectOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/** Recover only metadata written by the pre-fix pause/resume merge. */
function repairLegacyResumeResidue(raw: Record<string, unknown>): Record<string, unknown> | null {
  const state = raw.productionState;
  if (!isPausableAgentProductionState(state) || raw.pausedFrom !== state) {
    return null;
  }
  const repaired = { ...raw };
  delete repaired.pausedFrom;
  return parseAgentWorkflow(repaired) ? repaired : null;
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function modelOptionId(provider: string, model: string): string {
  return JSON.stringify([provider, model]);
}

function accessLabel(id: string, fallback?: string): string {
  if (id === "read-only") return "Chỉ đọc";
  if (id === "workspace-write") return "Ghi trong workspace";
  if (id === "danger-full-access") return "Toàn quyền";
  return fallback ?? id;
}

function safeActivityLabel(name: unknown): string | undefined {
  switch (name) {
    case "web_search": return "Tìm kiếm web";
    case "bash":
    case "pwsh":
    case "powershell": return "Đang xử lý tệp và asset";
    case "read":
    case "glob": return "Đang đọc workspace";
    case "read_image": return "Đang xem ảnh";
    case "motionreal_submit_assets": return "Đã gửi asset";
    case "motionreal_submit_brief": return "Đã gửi brief";
    case "motionreal_submit_authoring": return "Đã gửi cảnh";
    case "ask_user_question": return "Đang chờ câu trả lời";
    default: return undefined;
  }
}

function resumePromptFor(state: AgentProductionState): string {
  if (state === "collecting_assets") {
    return "MotionReal tiếp tục bước chuẩn bị asset. Hãy đọc handoff/assets-request.json hiện tại, hoàn thành yêu cầu và gọi motionreal_submit_assets; không tự ghi handoff/assets.json.";
  }
  if (state === "preparing_brief") {
    return "MotionReal tiếp tục tạo brief. Hãy đọc handoff/brief-request.json hiện tại, hoàn thành brief và gọi motionreal_submit_brief; không tự ghi handoff/brief.generated.json.";
  }
  if (state === "authoring" || state === "visual_refine") {
    return "MotionReal tiếp tục authoring. Hãy đọc handoff/authoring-request.json hiện tại, hoàn thành yêu cầu và gọi motionreal_submit_authoring khi xong.";
  }
  throw new Error(`Không thể tiếp tục workflow Video Agent ở bước ${state}.`);
}

async function readContentPlanArtifact(path: string, record: DraftRecord): Promise<ContentPlan | null> {
  if (!existsSync(path)) return null;
  let raw: unknown;
  try { raw = parseJson(await readFile(path, "utf8")); }
  catch (_error) { return null; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const artifact = raw as Record<string, unknown>;
  if (artifact.version !== 1
    || artifact.job_id !== record.activeJobId
    || artifact.request_revision !== record.authoringRequestRevision) return null;
  const parsed = ContentPlanSchema.safeParse(artifact.content_plan);
  return parsed.success ? parsed.data : null;
}

async function removeMatchingContentPlanArtifact(path: string, record: DraftRecord): Promise<void> {
  let raw: unknown;
  try { raw = parseJson(await readFile(path, "utf8")); }
  catch (_error) { return; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  const artifact = raw as Record<string, unknown>;
  if (artifact.job_id === record.activeJobId && artifact.request_revision === record.authoringRequestRevision) {
    await rm(path, { force: true });
  }
}

function isSameAuthoringWork(current: DraftRecord, expected: DraftRecord): boolean {
  return isAutomatedAuthoringState(current.productionState)
    && isAutomatedAuthoringState(expected.productionState)
    && current.workflowRevision === expected.workflowRevision
    && current.activeJobId === expected.activeJobId
    && current.authoringRequestRevision === expected.authoringRequestRevision;
}

function isPendingAuthoringEdit(current: DraftRecord, expected: DraftRecord): boolean {
  return expected.productionState === "authoring"
    && current.productionState === "scene_review"
    && current.workflowRevision + 1 === expected.workflowRevision
    && current.activeJobId === expected.activeJobId
    && current.authoringRequestRevision === expected.authoringRequestRevision;
}

function isAutomatedAuthoringState(state: AgentProductionState): state is "authoring" | "visual_refine" {
  return state === "authoring" || state === "visual_refine";
}

function isArtifactAwaitingState(state: AgentProductionState): state is "collecting_assets" | "preparing_brief" {
  return state === "collecting_assets" || state === "preparing_brief";
}

/** Supports existing drafts created before the per-prompt marker was persisted. */
function isAwaitedArtifactPrompt(data: Record<string, unknown>, record: DraftRecord): boolean {
  if (!isArtifactAwaitingState(record.productionState)) return false;
  const message = objectOf(data.message);
  const source = { ...objectOf(message.source), ...objectOf(data.source) };
  const rpcId = stringOf(source.rpcId);
  if (!rpcId) return false;
  if (record.awaitingArtifactPromptId) return rpcId === record.awaitingArtifactPromptId;
  const content = [...arrayOf(data.content), ...arrayOf(message.content)];
  const text = content.map((item) => stringOf(objectOf(item).text) ?? "").join("\n");
  return record.productionState === "collecting_assets"
    ? text.includes("motionreal_submit_assets")
    : text.includes("motionreal_submit_brief");
}

function isRetryableFailurePhase(value: unknown): value is "collecting_assets" | "preparing_brief" | "authoring" | "visual_refine" {
  return value === "collecting_assets"
    || value === "preparing_brief"
    || value === "authoring"
    || value === "visual_refine";
}

function authoringRepairLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 3;
  return Math.min(10, Math.max(1, Math.floor(value!)));
}

function validVisualRefinePass(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 5) {
    throw new Error("Visual refine có lượt kiểm tra không hợp lệ.");
  }
  return Number(value);
}

function validCleanStreak(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 5 ? Number(value) : 0;
}

/** Return only the scenes whose authored source, manifest entry or asset changed. */
function changedVisualSceneIds(
  before: HarnessSceneFingerprints | undefined,
  after: HarnessSceneFingerprints,
  sceneIds: string[],
): string[] {
  if (!before || before.global !== after.global) return [...sceneIds];
  return sceneIds.filter((id) => before.scenes[id] !== after.scenes[id]);
}

function agentInstructions(title: string): string {
  return `# MotionReal Video Agent\n\nBạn đang làm việc cho video: ${title}\n\n- Nghiên cứu, ghi chú và tải asset vào thư mục \`assets/\` của workspace này.\n- Khi MotionReal yêu cầu chuẩn bị asset, đọc \`handoff/assets-request.json\`, làm đúng job/request revision rồi gọi \`motionreal_submit_assets\`. Không tự ghi file manifest cuối.\n- Khi MotionReal yêu cầu brief, đọc \`handoff/brief-request.json\`, dùng cuộc trò chuyện và đúng asset đã chọn rồi gọi \`motionreal_submit_brief\`. Brief chỉ mô tả nội dung; không quyết định thời lượng, số cảnh hay giọng đọc. Không tự ghi file brief cuối.\n- Chỉ author scene khi có \`handoff/authoring-request.json\`. Khi đó đọc content_plan, giữ đúng expected_scene_ids, xem asset thật, viết \`project/manifest.json\` và \`project/authored/*.tsx\`, rồi gọi \`motionreal_submit_authoring\`.\n- Không tự tạo project hoặc render MP4; MotionReal validate, chụp still và mở từng bước duyệt bên ngoài chat.\n- Mọi đường dẫn ảnh thu thập phải tương đối và nằm trong \`assets/\`.\n`;
}

function harnessToolsPatch(pluginPath: string, searchProvider: AgentSearchProvider, harnessCliPath: string): string {
  const submission = `- insert:\n    - id: motionreal-submission-tools\n      name: ${JSON.stringify(pathToFileURL(resolve(pluginPath)).href)}\n`;
  if (searchProvider !== "exa") return submission;
  return `${submission}      config:\n        exa:\n          harnessCliPath: ${JSON.stringify(resolve(harnessCliPath))}\n`;
}

function agentContract(): string {
  return `# MotionReal Agent Workspace\n\nThis directory is an isolated workspace for one video.\n\n- Follow the local AGENTS.md.\n- Work only inside this directory, including the project/ junction created by MotionReal.\n- Edit project/ only while following the current handoff/authoring-request.json.\n- MotionReal owns validation, still capture, human review, and MP4 rendering.\n`;
}

function harnessSettings(): string {
  return `system-prompt:\n  includeHarnessIdentity: false\n  persona: >-\n    You are MotionReal Agent. Follow the current workspace instructions\n    and MotionReal handoff files for video research and authoring.\nllm-pi-ai:\n  providers:\n    ninerouter:\n      apiKeyEnv: NINEROUTER_API_KEY\n      api: openai-completions\n      baseURL: http://127.0.0.1:20128/v1\n      compat:\n        supportsDeveloperRole: false\n        maxTokensField: max_tokens\n      models:\n        - id: ag/gemini-3.7-flash-high\n          input: [text, image]\nagent-default-model:\n  provider: ninerouter\n  model: ag/gemini-3.7-flash-high\nweb-search-deepseek:\n  apiKeyEnv: DEEPSEEK_API_KEY\n`;
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
        signal: AbortSignal.timeout(1_000),
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

function positiveTimeout(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

async function raceWithTimeout<T>(work: Promise<T>, timeoutMs: number, onTimeout: () => void, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          onTimeout();
          reject(new Error(message));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function settleBounded(work: readonly Promise<unknown>[], timeoutMs: number): Promise<void> {
  if (work.length === 0) return;
  await raceWithTimeout(Promise.allSettled(work).then(() => undefined), timeoutMs, () => {}, "Harness local cleanup timed out.")
    .catch((error) => log.warn({ err: error }, "bounded Harness cleanup did not finish before shutdown"));
}
