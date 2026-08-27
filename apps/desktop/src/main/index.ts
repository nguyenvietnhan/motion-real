import { app, BrowserWindow, dialog, ipcMain, nativeImage, Notification, safeStorage, shell } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { appendEvent, createLogger, createTools, loadManifest, writeJson, projectPaths, videoToolHome, stagingDir, ensureProject, importImageBytes, reconcileStaleStates, pruneRenderCache, pruneTtsCache, readBrief, listBgmTracks, addBgmTrack, removeBgmTrack, renderThumbnail, workspaceRoot, ELEVENLABS_DEFAULT_MODEL_ID, runDoctor, readProjectDiagnostics, readProjectEvidence, type VoiceProvider } from "@motionreal/pipeline";
import { QueueStore, queueStorePath } from "./queue/queue-store.js";
import { QueueRunner } from "./queue/queue-runner.js";
import { spillHomeCreateIfBusy, spillHomeSmokeIfBusy } from "./queue/home-spill.js";
import { createSmokeProject } from "./create/smoke-create.js";
import type { QueueJobInput } from "../shared/queue-types.js";
import { LockedVideoSpecSchema } from "@motionreal/schema";
import { projectSceneTimelines } from "./workspace/workspace-view-model.js";
import { setAuthoringDiagnosticObserver } from "./authoring/authoring-failure.js";
import { registerIpcRouter, type InvokeHandlers } from "./ipc-router.js";
import { ModelGatewayManager } from "./gateway/model-gateway-manager.js";
import { createGatewayHandlers } from "./gateway/gateway-handlers.js";
import { buildNineRouterGatewayDeps } from "./gateway/ninerouter-deps.js";
import { NineRouterClient } from "./gateway/ninerouter-client.js";
import { NineRouterAuthoringBackend } from "./authoring/ninerouter-backend.js";
import { CustomLoopAgentWorker } from "./agent/custom-loop-worker.js";
import { WorkspaceController } from "./workspace/workspace-controller.js";
import { CreateController } from "./create/create-controller.js";
import { stripL0Tokens } from "./redact/friendly.js";
import { toCards } from "../shared/gallery-controller.js";
import { defaultSettings, isFullAutoSettings } from "../shared/settings-model.js";
import { SettingsStore } from "./settings/settings-store.js";
import { createSettingsHandlers } from "./settings/settings-handlers.js";
import { createVoiceTester } from "./settings/voice-test.js";
import { buildDesktopReadinessReport, desktopVoiceDoctorCheck } from "./settings/desktop-readiness.js";
import { createThumbnailHandlers } from "./thumbnail/thumbnail-handlers.js";
import {
  importDroppedImages,
  importPickedImageFiles,
  sweepStagingDir,
  unstageImage,
  type ImageStagingDeps,
} from "./create/image-staging.js";
import { createControllerArgsFromIpc, normalizeStagedImages, parseVoiceProvider } from "./create/create-ipc.js";
import { createBgmHandlers } from "./bgm/bgm-handlers.js";
import {
  saveProjectThumbnail,
  saveProjectVideo,
  type NativeSaveDeps,
  type NativeSaveDialogOptions,
} from "./export/native-save.js";
import { registerMediaScheme, handleMediaProtocol, mediaUrl } from "./media-protocol.js";
import { events, setEventTarget } from "./event-bus.js";
import { existsSync, mkdirSync, statSync, unlinkSync } from "node:fs";
import { copyFile, readFile, readdir, rm, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import type { DroppedImage, PickImagesResult, ScriptEdit } from "../shared/types.js";
import { authorInputFromBrief } from "./workspace/recall-author-input.js";
import {
  applyNonSensitiveEnvironment,
  detectProcessPrivilege,
  privilegeStartupError,
  scrubSensitiveEnvironment,
} from "./security/runtime-security.js";
import { readEnvFile, resolveBootVoiceEnv } from "./security/runtime-env.js";
import { isLegacyElectronShortcut } from "./shell-identity.js";
import { HarnessManager } from "./agent/harness-manager.js";

const log = createLogger("desktop");

// The `media://` scheme must be registered before the app is ready.
registerMediaScheme();

// The bundled Electron main is plain Node ESM (no `.tsx` loader), so authored
// scenes are loaded for the admission handshake via esbuild — set process-wide
// so BOTH the authoring step AND renderProject's admission use it.
// Electron reads `.env` once, captures only the voice values it needs in a
// closure, then removes credential-looking variables from process.env before any
// authored module can be loaded. Non-secret runtime configuration still follows
// normal env precedence.
const REPO_ROOT = dirname(process.env.VIDEO_TOOL_HOME ?? videoToolHome());
const fileEnv = readEnvFile(join(REPO_ROOT, ".env"));
const bootVoiceEnv = resolveBootVoiceEnv(process.env, fileEnv);
applyNonSensitiveEnvironment(fileEnv);
scrubSensitiveEnvironment(fileEnv);
scrubSensitiveEnvironment(process.env);

/**
 * Electron main = the ENGINE HOST. Imports the pipeline tools
 * from source -> ONE `@motionreal/compositions` registry.
 * Model chat uses an external 9router-compatible gateway on localhost:20128
 * (not vendored in this repo); login is delegated to the gateway's own UI.
 */

const SETTINGS_FILE = join(videoToolHome(), "motionreal-settings.json");
// `news-studio-settings.json`: pre-rename settings path, read-only migration.
// New writes use `motionreal-settings.json`. Removal needs owner-approved sunset.
const LEGACY_SETTINGS_FILE = join(videoToolHome(), "news-studio-settings.json");

// Settings persistence lives in the tested SettingsStore (reconcile S2): load
// merged over defaults (aiAccount forced from default), update/save excluding
// aiAccount, voiceConfig with.env fallback.
const settingsStore = new SettingsStore({
  filePath: SETTINGS_FILE,
  legacyFilePath: LEGACY_SETTINGS_FILE,
  defaults: () => defaultSettings(videoToolHome()),
  envApiKey: () => bootVoiceEnv.vivibeApiKey,
  envVoiceId: () => bootVoiceEnv.vivibeVoiceId,
  envElevenLabsApiKey: () => bootVoiceEnv.elevenLabsApiKey,
  envElevenLabsVoiceId: () => bootVoiceEnv.elevenLabsVoiceId,
  cipher: {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: (value) => safeStorage.encryptString(value),
    decryptString: (value) => safeStorage.decryptString(value),
  },
});

// TTS config: a user-entered voice key/id (Settings) overrides the.env fallback.
const tools = createTools({
  ttsConfig: async (projectId) => {
    const brief = await readBrief(projectId);
    const provider = brief.tts.provider;
    if (provider === "mock" || provider === "none") {
      return { provider, apiKey: "", voiceId: brief.tts.voiceId, modelId: brief.tts.modelId };
    }
    return settingsStore.voiceConfig(provider, { voiceId: brief.tts.voiceId, modelId: brief.tts.modelId });
  },
});
const nrClient = new NineRouterClient();
const gateway = new ModelGatewayManager(
  buildNineRouterGatewayDeps({ client: nrClient, openExternal: (url) => void shell.openExternal(url) }),
);
const { handlers: gatewayHandlers, getSelectedModelId } = createGatewayHandlers({
  ensureReady: () => gateway.refreshHealth(),
  listProviders: () => gateway.listProviders(),
  refreshConnections: () => gateway.refreshConnections(),
  beginConnect: (providerId) => gateway.beginConnect(providerId),
  listModels: () => gateway.listModels(),
  selectModel: (model) => gateway.selectModel(model),
  getSelectedFromGateway: () => gateway.selectedModel(),
});

// The authoring brain: AI writes an open AUTHOR manifest and fresh scene
// modules; we admit + render. Drives the SAME tools / one registry; render
// progress is forwarded to the UI.
// `reportProgress` is a forwarder set once the WorkspaceController exists (below),
// so the renderer's real per-frame progress drives the staged rendering bar.
let reportProgress: (projectId: string, ratio: number) => void = () => {};
const authoringBackend = new NineRouterAuthoringBackend({
  client: nrClient,
  tools,
  model: () => getSelectedModelId(),
  apiKey: () => undefined, // 9router /v1 is open on localhost
  // Per-voice CALIBRATED narration rate for the author word-budget;
  // undefined when uncalibrated/stale ⇒ the prompt uses its baked default (~4.7).
  wordsPerSecond: async (projectId) => {
    const brief = await readBrief(projectId);
    // Existing calibrations are measured with Vietnamese passages. English uses
    // the language-specific prompt default until calibration keys include language.
    if (brief.language === "en") return undefined;
    if (brief.tts.provider !== "vivibe" && brief.tts.provider !== "elevenlabs") return undefined;
    return settingsStore.calibratedWordsPerSecond({
      provider: brief.tts.provider,
      voiceId: brief.tts.voiceId,
      modelId: brief.tts.modelId,
      speed: brief.tts.speed,
    });
  },
  onRenderProgress: (ratio, projectId) => {
    // Drive the staged rendering bar from the renderer's REAL per-frame ratio.
    // The active phase (draft/qa/edit/full) is owned by the WorkspaceController
    // stage, which the UI polls — so we do NOT emit a second progress event here
    // (it was unconsumed by the renderer and hard-coded "draft", which mislabeled
    // full renders; emitting it per frame was also dead IPC chatter).
    reportProgress(projectId, ratio);
  },
});
const worker = new CustomLoopAgentWorker(authoringBackend);

// Staged-workspace orchestration + project/script reads live in the tested
// WorkspaceController (reconcile S4). index.ts only supplies the Electron/engine
// seams; the ordering/stage/fallback logic is owned + tested in the controller.
const workspace = new WorkspaceController({
  worker,
  events,
  settings: settingsStore,
  listProjects: async () => {
    const res = await tools.list_projects();
    return res.ok ? toCards(res.data).map((c) => ({ ...c, thumbnailPath: mediaUrl(c.thumbnailPath) })) : [];
  },
  loadManifest: (id) => loadManifest(id),
  writeManifest: (id, manifest) => writeJson(projectPaths(id).manifest, manifest),
  loadEvidence: async (id) => {
    const raw = await readProjectEvidence(id);
    if (!raw) return undefined;
    const sceneByClaim = new Map<string, string[]>();
    for (const scene of raw.scenes) {
      for (const claimId of scene.evidenceClaimIds) {
        const list = sceneByClaim.get(claimId) ?? [];
        list.push(scene.sceneId);
        sceneByClaim.set(claimId, list);
      }
    }
    return {
      sources: raw.sources.map((s) => ({
        id: s.id,
        sourceUrl: s.sourceUrl,
        title: s.title,
        ...(s.site ? { site: s.site } : {}),
        ...(s.publishedDate ? { publishedDate: s.publishedDate } : {}),
      })),
      claims: raw.claims.map((c) => ({
        id: c.id,
        text: c.text,
        ...(c.sourceRef?.sourceId ? { sourceId: c.sourceRef.sourceId } : {}),
        ...(c.sourceRef?.excerpt ? { excerpt: c.sourceRef.excerpt } : {}),
        sceneIds: sceneByClaim.get(c.id) ?? [],
      })),
    };
  },
  reviewStill: (id, sceneId) => mediaUrl(join(projectPaths(id).reviewDir, `${sceneId}.png`)) ?? "",
  // Never fall back to a raw absolute path — denied/unclassified media stays empty.
  toMedia: (p) => mediaUrl(p) ?? "",
  hasStill: (id, sceneId) => existsSync(join(projectPaths(id).reviewDir, `${sceneId}.png`)),
  hasOutput: (id) => existsSync(join(projectPaths(id).rendersDir, `${id}.mp4`)),
  outputMedia: (id) => mediaUrl(join(projectPaths(id).rendersDir, `${id}.mp4`)) ?? "",
  hasDraft: (id) => existsSync(join(projectPaths(id).rendersDir, `${id}.draft.mp4`)),
  draftMedia: (id) => mediaUrl(join(projectPaths(id).rendersDir, `${id}.draft.mp4`)) ?? "",
  inspectArtifacts: async (id) => {
    const { isHealthyMediaFile } = await import("./workspace/workspace-recovery.js");
    const health = (abs: string) => {
      try {
        if (!existsSync(abs)) return isHealthyMediaFile(null);
        const s = statSync(abs);
        return isHealthyMediaFile({ isFile: s.isFile(), size: s.size });
      } catch (_error) {
        return isHealthyMediaFile(null);
      }
    };
    const p = projectPaths(id);
    return {
      full: health(join(p.rendersDir, `${id}.mp4`)),
      draft: health(join(p.rendersDir, `${id}.draft.mp4`)),
    };
  },
  loadSceneTimelines: async (id) => {
    try {
      const raw = JSON.parse(await readFile(projectPaths(id).lock, "utf8")) as unknown;
      const parsed = LockedVideoSpecSchema.safeParse(raw);
      if (!parsed.success) return {};
      return projectSceneTimelines({
        fps: parsed.data.fps,
        scenes: parsed.data.scenes.map((s) => ({
          id: s.id,
          startFrame: s.startFrame,
          durationInFrames: s.durationInFrames,
        })),
      });
    } catch (error) {
      log.debug({ err: error, projectId: id }, "locked timeline unreadable; storyboard seeks disabled");
      return {};
    }
  },
  // Render the first authored scene without TTS/captions, then expose the stable
  // review/thumbnail.png artifact on the published screen.
  renderThumbnail: async (id) => {
    const { path } = await renderThumbnail(id);
    return { path };
  },
  hasThumbnail: (id) => existsSync(join(projectPaths(id).reviewDir, "thumbnail.png")),
  thumbnailMedia: (id) => mediaUrl(join(projectPaths(id).reviewDir, "thumbnail.png")) ?? "",
  // A crawled image's project-relative ref ("assets/<sha>.<ext>") → a media:// URL
  // for the review screen preview. Resolved under videoToolHome like every asset.
  assetMedia: (id, ref) => mediaUrl(join(projectPaths(id).root, ref)) ?? "",
  deleteProject: (id) => rm(projectPaths(id).root, { recursive: true, force: true }),
  revealProject: async (id) => {
    await shell.openPath(projectPaths(id).root);
  },
  // Rehydrate a project's AuthorInput from the persisted brief when the in-memory
  // input is gone (after an app restart), so the error screen's "Thử lại" can
  // recover a project stranded across a restart instead of no-op'ing. The brief
  // stores fixed short-form delivery (tiktok / tier) + language + the prompt;
  // urls are re-extracted from it. Create-time images aren't persisted → a
  // rehydrated retry re-authors from text + links only.
  recallInput: async (id) => {
    try {
      const brief = await readBrief(id);
      return authorInputFromBrief(brief);
    } catch (error) {
      log.warn({ err: error, projectId: id }, "project brief unreadable; retry remains in-session only");
      return null; // no readable brief → in-session retry only
    }
  },
  redact: stripL0Tokens,
  appendProjectEvent: (projectId, event) => {
    void appendEvent(projectId, event).catch((error) => {
      log.debug({ err: error, projectId, type: event.type }, "diagnostic event append failed");
    });
  },
  // Unattended: system toast when a job ends (done/error). Click focuses the app.
  onJobNotify: ({ title, body }) => {
    try {
      if (!Notification.isSupported()) return;
      const n = new Notification({ title, body, silent: false });
      n.on("click", () => {
        const win = BrowserWindow.getAllWindows()[0];
        if (!win || win.isDestroyed()) return;
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      });
      n.show();
    } catch (error) {
      log.debug({ err: error }, "OS job notification failed");
    }
  },
});

// Fan out safe authoring failure metadata into the project event stream (best-effort).
setAuthoringDiagnosticObserver((payload) => {
  if (!payload.projectId) return;
  void appendEvent(payload.projectId, {
    type: payload.type,
    failureClass: payload.failureClass,
    level: payload.level,
    projectId: payload.projectId,
  }).catch((error) => {
    log.debug({ err: error, projectId: payload.projectId }, "authoring diagnostic append failed");
  });
});

// Now that the workspace exists, point the render-progress forwarder at it so
// the renderer's real per-frame progress drives the staged rendering bar.
reportProgress = (projectId, ratio) => workspace.reportRenderProgress(projectId, ratio);

// Create flow (validate → scaffold via the ONE registry → hand off to the
// staged workspace) lives in the tested CreateController (reconcile S5).
const create = new CreateController({
  scaffold: async (prompt, voiceProvider, videoLanguage, delivery) => {
    const config = settingsStore.voiceConfig(voiceProvider);
    const res = await tools.scaffold_project({
      prompt,
      language: videoLanguage,
      format: delivery?.format ?? "tiktok",
      durationTier: delivery?.durationTier ?? 1,
      // Tier-derived pacing seconds (UI knobs win over prompt length).
      ...(delivery?.targetSeconds !== undefined ? { duration: delivery.targetSeconds } : {}),
      ttsProvider: voiceProvider,
      voiceId: config.voiceId,
      ...(config.modelId ? { modelId: config.modelId } : {}),
    });
    return res.ok ? { ok: true, projectId: res.data.projectId } : { ok: false, error: res.error };
  },
  beginCreate: (id, input) => workspace.beginCreate(id, input),
  // Create-time BGM from Home knobs (needed before skip_edit auto-full).
  setProjectBgm: async (projectId, name) => {
    await bgmHandlers["bgm:setForProject"](projectId, name);
  },
  // Preflight: block create on a guaranteed-fatal LOCAL config gap (a missing
  // Vivibe voice key/id read from SETTINGS — env is only the fallback), so the
  // whole AI authoring pass doesn't burn and then fail at TTS. Read from the
  // settings store, not env, so a key configured in the Settings UI counts. We
  // do NOT gate on gateway/model here — that stays a "guide, don't gate" chip.
  preflight: (voiceProvider, videoLanguage) => {
    if (voiceProvider === "vivibe" && videoLanguage === "en") {
      return "Vivibe chỉ hỗ trợ tiếng Việt. Hãy chọn ElevenLabs để tạo video tiếng Anh.";
    }
    const { apiKey, voiceId } = settingsStore.voiceConfig(voiceProvider);
    const missing: string[] = [];
    if (!apiKey) missing.push("API key giọng đọc");
    if (!voiceId) missing.push("giọng đọc (voice id)");
    if (missing.length === 0) return undefined;
    const label = voiceProvider === "vivibe" ? "Vivibe" : "ElevenLabs";
    return {
      message: `Chưa cấu hình ${missing.join(" và ")} cho ${label}. Mở Cài đặt để thêm rồi thử lại.`,
      voiceFailure: {
        provider: voiceProvider,
        code: !apiKey ? "not_configured" : "voice_not_found",
        retryable: false,
      },
    };
  },
  // Move each staged create-time image into the project's assetsDir by RE-importing
  // its bytes (content-addressed, so the <sha>.<ext> filename — and thus the ref —
  // is identical to staging). A staged file we can't read/import just drops out.
  promoteImages: async (projectId, images) => {
    await ensureProject(projectId);
    const assetsDir = projectPaths(projectId).assetsDir;
    const out: { ref: string; width: number; height: number }[] = [];
    for (const img of images) {
      try {
        const stagedAbs = join(videoToolHome(), img.ref); // ref is "staging/<sha>.<ext>"
        const bytes = await readFile(stagedAbs);
        const res = await importImageBytes(bytes, assetsDir, { refPrefix: "assets" });
        if (res.ok) out.push({ ref: res.ref, width: res.width, height: res.height });
      } catch (error) {
        log.warn(
          { err: error, projectId, stagedRef: img.ref },
          "staged image promotion failed; create will continue without this image",
        );
      }
    }
    return out;
  },
});

const imageStagingDeps: ImageStagingDeps = {
  stagingDir,
  importImageBytes,
  mediaUrl,
  readFile,
  readdir,
  stat,
  rm,
  now: () => Date.now(),
  warn: (details, message) => log.warn(details, message),
};

// DeepSeek Harness is developed next to this repository. Production packaging is
// deliberately deferred; an explicit MOTIONREAL_DSH_CLI always wins for a custom
// install. Each Agent video owns a private DSH_HOME under agent-drafts, so its
// chat/tool history has the same lifecycle as the video it creates.
const harness = new HarnessManager({
  draftsRoot: join(videoToolHome(), "agent-drafts"),
  harnessCliPath:
    process.env.MOTIONREAL_DSH_CLI ??
    join(dirname(REPO_ROOT), "deepseek-harness", "apps", "cli", "lib", "bin.js"),
});

async function activateHarnessDraft(draftId: string) {
  const state = await gateway.refreshHealth();
  if (state.kind !== "ready") throw new Error("9router chưa sẵn sàng. Hãy mở 9router rồi thử lại.");
  const key = gateway.localApiKey();
  if (!key) throw new Error("Chưa lấy được khóa nội bộ từ 9router. Hãy thử lại sau ít giây.");
  return harness.activate(draftId, key);
}

async function stageHarnessImages(paths: string[]) {
  const staged: { ref: string; width: number; height: number }[] = [];
  for (const path of paths) {
    try {
      const result = await importImageBytes(await readFile(path), stagingDir(), { refPrefix: "staging" });
      if (result.ok) staged.push({ ref: result.ref, width: result.width, height: result.height });
    } catch (error) {
      log.warn({ err: error }, "Agent asset staging failed; skipping one image");
    }
  }
  return staged;
}

/**
 * Native image picker for the create screen (create-time image staging). Opens a
 * multi-select file dialog, imports each pick into the home-level STAGING dir
 * (content-addressed, magic-byte sniffed, capped) so it can preview through the
 * `media://` protocol before a project exists, and returns the staged images +
 * per-file rejections. The bytes are promoted into the project's `assetsDir` on
 * create (`promoteImages`). Cancelling the dialog yields an empty result.
 */
async function pickImages(): Promise<PickImagesResult> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const opts = {
    title: "Chọn ảnh",
    properties: ["openFile", "multiSelections"] as Array<"openFile" | "multiSelections">,
    filters: [{ name: "Ảnh", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
  };
  const picked = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  if (picked.canceled || picked.filePaths.length === 0) return { staged: [], rejected: [] };

  return importPickedImageFiles(picked.filePaths, imageStagingDeps);
}

async function pickBgmAudioFiles(): Promise<string[] | null> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const opts = {
    title: "Thêm nhạc nền",
    properties: ["openFile", "multiSelections"] as Array<"openFile" | "multiSelections">,
    filters: [{ name: "Âm thanh", extensions: ["mp3", "m4a", "wav"] }],
  };
  const picked = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  return picked.canceled ? null : picked.filePaths;
}

const bgmHandlers = createBgmHandlers({
  workspaceRoot,
  exists: existsSync,
  fileSize: (path) => statSync(path).size,
  listBgmTracks,
  mediaUrl,
  warn: (details, message) => log.warn(details, message),
  pickAudioFiles: pickBgmAudioFiles,
  addBgmTrack,
  removeBgmTrack,
  loadManifest,
  writeManifest: (projectId, manifest) => writeJson(projectPaths(projectId).manifest, manifest),
});

async function showNativeSaveDialog(options: NativeSaveDialogOptions) {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  return win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options);
}

const nativeSaveDeps: NativeSaveDeps = {
  exists: existsSync,
  copyFile,
  showSaveDialog: showNativeSaveDialog,
  currentOutputDir: () => settingsStore.current().outputDir,
  downloadsDir: () => app.getPath("downloads"),
  projectTitle: async (projectId) => {
    const cards = await tools.list_projects();
    return cards.ok ? toCards(cards.data).find((card) => card.projectId === projectId)?.title : undefined;
  },
  videoSourcePath: (projectId) => join(projectPaths(projectId).rendersDir, `${projectId}.mp4`),
  thumbnailSourcePath: (projectId) => join(projectPaths(projectId).reviewDir, "thumbnail.png"),
  warn: (details, message) => log.warn(details, message),
};

const queueStore = new QueueStore({ filePath: queueStorePath(videoToolHome()) });
// Crash/restart: no in-process runner can still own a `running` job from disk.
const staleQueueJobs = queueStore.reconcileStaleRunningJobs();
if (staleQueueJobs > 0) {
  log.info({ count: staleQueueJobs }, "reconciled stale running queue jobs");
}

const smokeCreateDeps = {
  tools,
  beginCreate: (projectId: string, input: import("./agent/agent-worker.js").AuthorInput) =>
    workspace.beginCreate(projectId, input),
  rename: (projectId: string, title: string) => workspace.rename(projectId, title),
};

// Serial queue: only runs after explicit queue:start (addJob never renders).
const queueRunner = new QueueRunner({
  store: queueStore,
  create,
  createSmoke: (input) => createSmokeProject(smokeCreateDeps, input),
  stageOf: (projectId) => workspace.stage(projectId),
  cancelProject: (projectId) => workspace.cancel(projectId),
  renameProject: async (projectId, title) => {
    await workspace.rename(projectId, title);
  },
  projectTitle: async (projectId) => {
    try {
      const m = await loadManifest(projectId);
      const t = typeof m.title === "string" ? m.title.trim() : "";
      // Ignore placeholders; keep the user prompt on the card until a real clip title exists.
      if (!t || /^project-\d+$/i.test(t) || t === "Untitled" || t === "Smoke test") return undefined;
      return t;
    } catch (error) {
      log.debug({ err: error, projectId }, "queue project title unavailable");
      return undefined;
    }
  },
  fullAutoReady: () => isFullAutoSettings(settingsStore.current()),
  resumeProject: (projectId) => workspace.resumeUnattended(projectId),
  projectExists: (projectId) => existsSync(projectPaths(projectId).root),
  log: (msg, extra) => log.info(extra ?? {}, msg),
});

// ponytail: one smoke at a time; no queue for a test button
let smokeRenderInFlight = false;
const testVoice = createVoiceTester({ rootDir: join(videoToolHome(), "voice-tests") });

const settingsHandlers = createSettingsHandlers({
  current: () => settingsStore.current(),
  update: (patch) => {
    if (queueRunner.hasScheduledWork() && !isFullAutoSettings({ ...settingsStore.current(), ...patch })) {
      throw new Error("Không thể bật bước duyệt tay khi hàng đợi đang chạy.");
    }
    return settingsStore.update(patch);
  },
  setApiKey: (provider, apiKey) => settingsStore.setApiKey(provider, apiKey),
  clearApiKey: (provider) => settingsStore.clearApiKey(provider),
  testVoice: (provider) => testVoice(settingsStore.voiceConfig(provider)),
  parseVoiceProvider,
  readiness: async () => {
    const current = settingsStore.current();
    const voiceCfg = settingsStore.voiceConfig();
    const voice = {
      hasApiKey: Boolean(voiceCfg.apiKey?.trim()),
      hasVoiceId: Boolean(voiceCfg.voiceId?.trim()),
      providerLabel: voiceCfg.provider === "elevenlabs" ? "ElevenLabs" : "Vivibe",
    };
    const doctor = await runDoctor({
      checkEnv: () => desktopVoiceDoctorCheck(voice),
    });
    const gw = gateway.state();
    const account = await gateway.refreshConnections().catch((_error: unknown) => ({ kind: "disconnected" as const }));
    const models = gw.kind === "ready" ? await gateway.listModels().catch((_error: unknown) => []) : [];
    return buildDesktopReadinessReport({
      gateway: gw,
      account,
      selectedModelId: gateway.selectedModel()?.id,
      preferredModelId: current.preferredAiModelId,
      availableModelIds: models.map((m) => m.id),
      voice,
      doctor,
    });
  },
  // Home smoke: if queue runner busy → spill smoke job into ephemeral `home` (no parallel).
  // Idle → run immediately. Tab queue smoke still only enqueues until Start.
  renderSmoke: async (input) => {
    const args = (input && typeof input === "object" ? input : {}) as {
      raw?: unknown;
      videoLanguage?: unknown;
    };
    const raw = typeof args.raw === "string" ? args.raw : "";
    const videoLanguage = args.videoLanguage === "en" ? "en" : "vi";

    const spill = spillHomeSmokeIfBusy({
      busy: queueRunner.isBusy() || workspace.isBusy(),
      raw,
      videoLanguage,
      store: queueStore,
      runner: queueRunner,
    });
    if (spill.kind === "error") {
      return { ok: false as const, error: spill.error };
    }
    if (spill.kind === "queued") {
      return {
        ok: true as const,
        kind: "queued" as const,
        queueId: spill.queueId,
        jobId: spill.jobId,
      };
    }

    if (smokeRenderInFlight) {
      return { ok: false as const, error: "Đang tạo smoke — chờ xong rồi bấm lại." };
    }
    smokeRenderInFlight = true;
    try {
      const result = await createSmokeProject(smokeCreateDeps, { raw, videoLanguage });
      if (!result.ok) return result;
      return { ok: true as const, kind: "started" as const, projectId: result.projectId };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { ok: false as const, error: stripL0Tokens(msg).slice(0, 240) || "Smoke thất bại." };
    } finally {
      smokeRenderInFlight = false;
    }
  },
});

const thumbnailHandlers = createThumbnailHandlers({
  generateThumbnail: (projectId) => workspace.generateThumbnail(projectId),
  saveThumbnail: (projectId) => saveProjectThumbnail(projectId, nativeSaveDeps),
});

// IPC ownership inventory: keep Electron lifecycle and dependency
// wiring here, but route contained behavior to focused owners when a seam exists.
// - gateway AI: grouped factory in gateway/gateway-handlers.ts (selectedModel mirror).
// - projects: mixed root wiring; create payload coercion lives in create-ipc.ts,
// create behavior in CreateController, image staging in image-staging.ts,
// workspace behavior in WorkspaceController, and native save in native-save.ts.
// - BGM: grouped factory in bgm/bgm-handlers.ts.
// - thumbnail: grouped factory in thumbnail/thumbnail-handlers.ts.
// - script/review: inline thin wrappers over WorkspaceController/settingsStore.
// - settings/TTS: grouped factory in settings/settings-handlers.ts.
const handlers: InvokeHandlers = {
  ...gatewayHandlers,

  "agent:list": () => harness.list(),
  "agent:createDraft": async (title) => {
    const draft = await harness.createDraft(String(title ?? ""));
    return activateHarnessDraft(draft.id);
  },
  "agent:openDraft": (draftId) => activateHarnessDraft(String(draftId)),
  "agent:status": (draftId) => harness.status(String(draftId)),
  "agent:createVideo": async (draftId) => {
    const request = await harness.readCreateRequest(String(draftId));
    const images = await stageHarnessImages(request.imagePaths);
    // This is intentionally the existing Home Create Flow, including all
    // validation, staging promotion, authoring, still/refine, and rollback.
    const created = await create.create(request.prompt, images);
    await harness.linkProject(request.draftId, created.projectId);
    return created;
  },
  "agent:deleteDraft": async (draftId) => {
    const draft = await harness.status(String(draftId));
    if (draft.projectId) await workspace.delete(draft.projectId);
    await harness.removeDraft(draft.id);
  },

  "projects:list": () => workspace.list(),
  "projects:create": async (input) => {
    const args = createControllerArgsFromIpc(input);
    // Home create while queue runner busy → ephemeral home container (no parallel workflow).
    const spill = spillHomeCreateIfBusy({
      source: args.source,
      busy: queueRunner.isBusy() || workspace.isBusy(),
      raw: args.raw,
      choices: args.choices,
      images: args.images,
      store: queueStore,
      runner: queueRunner,
    });
    if (spill.kind === "error") throw new Error(spill.error);
    if (spill.kind === "queued") {
      return {
        kind: "queued" as const,
        queueId: spill.queueId,
        jobId: spill.jobId,
      };
    }
    const created = await create.create(args.raw, args.images, args.choices);
    return { kind: "started" as const, projectId: created.projectId };
  },
  "projects:pickImages": () => pickImages(),
  "projects:importImageBytes": (files) => importDroppedImages(files as DroppedImage[], imageStagingDeps),
  "projects:removeStagedImage": (ref) => {
    const normalized = String(ref);
    if (queueStore.usesStagedRef(normalized)) return undefined;
    return unstageImage(normalized, imageStagingDeps);
  },
  "projects:stage": (projectId) => workspace.stage(String(projectId)),
  "projects:rename": (projectId, newTitle) => workspace.rename(String(projectId), String(newTitle)),
  "projects:open": (projectId) => workspace.open(String(projectId)),
  "projects:delete": async (projectId) => {
    const id = String(projectId);
    // A video created by Agent owns its isolated Harness state as well.
    const draft = await harness.draftForProject(id);
    await workspace.delete(id);
    if (draft) await harness.removeDraft(draft.id);
  },
  "projects:reveal": (projectId) => workspace.reveal(String(projectId)),
  "projects:save": (projectId) => saveProjectVideo(projectId, nativeSaveDeps),
  "projects:cancel": (projectId) => {
    workspace.cancel(String(projectId));
    return undefined;
  },
  "projects:retry": (projectId) => {
    workspace.retry(String(projectId));
    return undefined;
  },
  "projects:fixWithAi": (projectId) => {
    workspace.fixWithAi(String(projectId));
    return undefined;
  },
  "projects:submitImageReview": (projectId, selectedRefs) => {
    workspace.submitImageReview(String(projectId), Array.isArray(selectedRefs) ? (selectedRefs as unknown[]).map(String) : []);
    return undefined;
  },
  "projects:diagnostics": (projectId) => readProjectDiagnostics(String(projectId)),

  ...bgmHandlers,
  ...thumbnailHandlers,

  "queue:list": () => queueStore.list(),
  "queue:get": (queueId) => queueStore.get(String(queueId)),
  "queue:create": (title) => queueStore.create(typeof title === "string" ? title : undefined),
  "queue:delete": (queueId) => {
    const id = String(queueId);
    // Refuse delete while this queue is the active serial run.
    if (queueRunner.isBusy() && queueRunner.activeQueue() === id) {
      throw new Error("Không xóa được: hàng đợi này đang chạy.");
    }
    // Drop from pending schedule if Start was queued behind another container.
    queueRunner.unschedule(id);
    return queueStore.delete(id);
  },
  "queue:rename": (queueId, title) => queueStore.rename(String(queueId), String(title ?? "")),
  "queue:addJob": (queueId, input) => {
    if (!input || typeof input !== "object") throw new Error("Dữ liệu hàng đợi không hợp lệ.");
    const body = (input && typeof input === "object" ? input : {}) as Partial<QueueJobInput>;
    const raw = typeof body.raw === "string" ? body.raw : "";
    const durationTier = body.durationTier === 2 || body.durationTier === 3 || body.durationTier === 4 ? body.durationTier : 1;
    const videoLanguage = body.videoLanguage === "en" ? "en" : "vi";
    const voiceProvider = body.voiceProvider === "elevenlabs" ? "elevenlabs" : "vivibe";
    const bgm = typeof body.bgm === "string" ? body.bgm : null;
    const smoke = body.smoke === true;
    const images = normalizeStagedImages(body.images);
    // Only enqueue — never start render here (including smoke jobs).
    return queueStore.addJob(String(queueId), {
      raw: smoke && !raw.trim() ? "Smoke test — video ngắn 10 giây, không tiếng." : raw,
      durationTier,
      videoLanguage,
      voiceProvider,
      bgm: smoke ? null : bgm,
      ...(images.length > 0 ? { images } : {}),
      ...(smoke ? { smoke: true } : {}),
    });
  },
  "queue:updateJob": (queueId, jobId, patch) => {
    if (!patch || typeof patch !== "object") throw new Error("Dữ liệu cập nhật hàng đợi không hợp lệ.");
    const body = (patch && typeof patch === "object" ? patch : {}) as Partial<QueueJobInput>;
    return queueStore.updateJobInput(String(queueId), String(jobId), {
      ...(typeof body.raw === "string" ? { raw: body.raw } : {}),
      ...(body.durationTier === 1 || body.durationTier === 2 || body.durationTier === 3 || body.durationTier === 4
        ? { durationTier: body.durationTier }
        : {}),
      ...(body.videoLanguage === "en" || body.videoLanguage === "vi" ? { videoLanguage: body.videoLanguage } : {}),
      ...(body.voiceProvider === "vivibe" || body.voiceProvider === "elevenlabs"
        ? { voiceProvider: body.voiceProvider }
        : {}),
      ...(body.bgm !== undefined ? { bgm: typeof body.bgm === "string" ? body.bgm : null } : {}),
      ...(body.smoke === true || body.smoke === false ? { smoke: body.smoke } : {}),
      ...(body.images !== undefined ? { images: normalizeStagedImages(body.images) } : {}),
    });
  },
  "queue:deleteJob": (queueId, jobId) => queueStore.deleteJob(String(queueId), String(jobId)),
  "queue:cancelJob": (queueId, jobId) => queueRunner.cancelJob(String(queueId), String(jobId)),
  "queue:start": (queueId) => queueRunner.start(String(queueId)),
  "queue:pause": () => queueRunner.pause(),
  "queue:resume": () => queueRunner.resume(),
  "queue:status": () => queueRunner.status(),

  "script:get": (projectId) => workspace.scriptGate(String(projectId)),
  "script:applyEdits": (projectId, edits) => workspace.applyEdits(String(projectId), edits as ScriptEdit[]),
  "script:approve": (projectId) => {
    workspace.approve(String(projectId)); // stage 2: approved → render voice + draft
    return undefined;
  },
  "script:setEnabled": (enabled) => {
    if (queueRunner.hasScheduledWork() && Boolean(enabled)) {
      throw new Error("Không thể bật duyệt kịch bản khi hàng đợi đang chạy.");
    }
    settingsStore.setScriptGateEnabled(enabled);
    return undefined;
  },

  "review:submitEdits": (projectId, batch) => {
    const b = batch as { perScene: { sceneId: string; text: string }[]; globalNotes: string };
    workspace.submitEdits(String(projectId), b.perScene ?? [], b.globalNotes ?? "");
    return { ok: true, revision: 1 };
  },
  "review:approveDraft": (projectId) => {
    workspace.publish(String(projectId));
    return { ok: true, outputPath: "" };
  },

  ...settingsHandlers,
};

registerIpcRouter(ipcMain, handlers);

// Start the gateway in the background once the app is ready (non-blocking).
function startGateway(): void {
  void gateway.start().catch((error) => {
    // eslint-disable-next-line no-console
    console.error("[desktop] gateway start failed:", error);
  });
}

const here = dirname(fileURLToPath(import.meta.url));
/** apps/desktop package root (from dist-electron/main → ../..) */
const desktopAppRoot = join(here, "../..");
/** Stable AUMID — must match Start Menu shortcut or Windows shows wrong taskbar icon. */
const WINDOWS_AUMID = "com.motionreal.desktop";

/** Absolute brand PNG (title bar). Prefer PNG — broken/partial ICO falls back to Atom. */
function brandIconPngPath(): string {
  const png = join(desktopAppRoot, "assets/brand/taskbar-logo.png");
  const logo = join(desktopAppRoot, "assets/brand/logo.png");
  if (existsSync(png)) return png;
  return logo;
}

function brandIconIcoPath(): string {
  return join(desktopAppRoot, "assets/brand/taskbar-logo.ico");
}

function loadBrandNativeImage(): Electron.NativeImage | undefined {
  const png = brandIconPngPath();
  if (!existsSync(png)) return undefined;
  const img = nativeImage.createFromPath(png);
  if (img.isEmpty()) return undefined;
  return img;
}

/**
 * Write Start Menu .lnk with brand icon + AUMID.
 * Electron `writeShortcutLink(..., "replace")` returns false if file missing —
 * must create first. Falls back to PowerShell WScript.Shell COM.
 */
function writeBrandShortcut(lnk: string, iconPath: string): boolean {
  const shortcutArgs = `"${desktopAppRoot}"`;
  const details = {
    target: process.execPath,
    args: shortcutArgs,
    cwd: desktopAppRoot,
    appUserModelId: WINDOWS_AUMID,
    icon: iconPath,
    iconIndex: 0,
    description: "Motion Real",
  } as const;

  const op = existsSync(lnk) ? "replace" : "create";
  try {
    if (shell.writeShortcutLink(lnk, op, { ...details })) return true;
  } catch (error) {
    log.debug({ err: error, shortcut: lnk }, "shortcut write failed; trying fallback");
  }
  // Retry opposite op once
  try {
    const op2 = op === "create" ? "replace" : "create";
    if (shell.writeShortcutLink(lnk, op2, { ...details })) return true;
  } catch (error) {
    log.debug({ err: error, shortcut: lnk }, "shortcut fallback write failed; trying PowerShell");
  }

  // PowerShell COM fallback (proven on this machine)
  try {
    const ps = `
$W = New-Object -ComObject WScript.Shell
$S = $W.CreateShortcut(${JSON.stringify(lnk)})
$S.TargetPath = ${JSON.stringify(process.execPath)}
$S.Arguments = ${JSON.stringify(shortcutArgs ?? "")}
$S.WorkingDirectory = ${JSON.stringify(desktopAppRoot)}
$S.IconLocation = ${JSON.stringify(`${iconPath},0`)}
$S.Description = "Motion Real"
$S.Save()
`;
    execFileSync("powershell.exe", ["-NoProfile", "-Command", ps], { stdio: "ignore" });
    return existsSync(lnk);
  } catch (error) {
    log.debug({ err: error, shortcut: lnk }, "PowerShell shortcut write failed");
    return false;
  }
}

function ensureWindowsBrandShellIdentity(): void {
  if (process.platform !== "win32") return;
  app.setAppUserModelId(WINDOWS_AUMID);
  const ico = brandIconIcoPath();
  const png = brandIconPngPath();
  const iconPath = existsSync(ico) ? ico : png;
  if (!existsSync(iconPath)) return;
  try {
    const programs = join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs");
    mkdirSync(programs, { recursive: true });
    const legacyLnk = join(programs, "Electron.lnk");
    try {
      if (
        existsSync(legacyLnk) &&
        isLegacyElectronShortcut(shell.readShortcutLink(legacyLnk), WINDOWS_AUMID)
      ) {
        unlinkSync(legacyLnk);
      }
    } catch (error) {
      log.debug({ err: error, shortcut: legacyLnk }, "legacy Electron shortcut cleanup failed");
    }
    const lnk = join(programs, "Motion Real.lnk");
    try {
      if (existsSync(lnk)) unlinkSync(lnk);
    } catch (error) {
      log.debug({ err: error, shortcut: lnk }, "stale shortcut removal failed");
    }
    writeBrandShortcut(lnk, iconPath);
  } catch (error) {
    log.debug({ err: error }, "Start Menu brand shortcut failed");
  }
}

async function createWindow(): Promise<void> {
  // Windows title bar prefers a real .ico path; PNG NativeImage alone often stays Atom.
  const ico = brandIconIcoPath();
  const brandImg = loadBrandNativeImage();
  const windowIcon = existsSync(ico) ? ico : brandImg;

  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 1080,
    minHeight: 720,
    show: true,
    title: "Motion Real",
    ...(windowIcon ? { icon: windowIcon } : {}),
    webPreferences: {
      preload: join(here, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  try {
    if (existsSync(ico)) {
      const icoImg = nativeImage.createFromPath(ico);
      if (!icoImg.isEmpty()) {
        win.setIcon(icoImg);
      } else if (brandImg) {
        win.setIcon(brandImg);
      }
    } else if (brandImg) {
      win.setIcon(brandImg);
    }
  } catch (error) {
    log.debug({ err: error }, "window icon setup failed; using executable icon");
  }
  win.removeMenu();
  setEventTarget(win.webContents);
  win.on("closed", () => setEventTarget(null));

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    await win.loadURL(devUrl);
  } else {
    await win.loadFile(join(here, "../renderer/index.html"));
  }
}

// MUST run before app.ready / any BrowserWindow (Windows).
if (process.platform === "win32") {
  app.setAppUserModelId(WINDOWS_AUMID);
}

app
  .whenReady()
  .then(async () => {
    ensureWindowsBrandShellIdentity();
    if (!settingsStore.migrateLegacySecret()) {
      log.warn("legacy Vivibe API key could not be encrypted; user must re-enter it in Settings");
    }
    const privilegeError = privilegeStartupError(detectProcessPrivilege());
    if (privilegeError) {
      dialog.showErrorBox("Không thể khởi động an toàn", privilegeError);
      app.exit(1);
      return;
    }
    handleMediaProtocol();
    // Clear stale staged create-time images (picked but never used). Best-effort.
    void sweepStagingDir(imageStagingDeps, undefined, queueStore.stagedImageRefs()).catch((error) => {
      // eslint-disable-next-line no-console
      console.error("[desktop] staging sweep failed:", error);
    });
    // Cap the shared render + TTS caches so they don't grow without bound. These
    // caches live OUTSIDE project folders (so a re-render of the same spec is
    // free) and are NOT cleared on project delete; pruning by size here is what
    // keeps them bounded. Best-effort — a prune failure must never block startup.
    void pruneRenderCache().catch((error) => {
      // eslint-disable-next-line no-console
      console.error("[desktop] render-cache prune failed:", error);
    });
    void pruneTtsCache().catch((error) => {
      // eslint-disable-next-line no-console
      console.error("[desktop] tts-cache prune failed:", error);
    });
    // Reconcile stale project state before gateway/window so no job starts mid-repair.
    try {
      await reconcileStaleStates();
      const { reconcileAuthoringCandidateTransactions } = await import("./authoring/author-candidate-transaction.js");
      await reconcileAuthoringCandidateTransactions(join(videoToolHome(), "projects"));
    } catch (error) {
      log.warn({ err: error }, "stale-state reconcile failed; desktop startup will continue");
    }
    startGateway();
    await createWindow();
    const restoredQueue = queueRunner.restore();
    if (restoredQueue) log.info({ result: restoredQueue }, "restored persisted queue schedule");
  })
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error("[desktop] failed to start:", error);
    app.quit();
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  void harness.dispose();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});
