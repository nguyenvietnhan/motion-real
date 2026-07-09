import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createLogger, createTools, loadManifest, writeJson, projectPaths, videoToolHome, stagingDir, ensureProject, importImageBytes, reconcileStaleStates, pruneRenderCache, pruneTtsCache, readBrief, listBgmTracks, addBgmTrack, removeBgmTrack, renderThumbnail, workspaceRoot, ELEVENLABS_DEFAULT_MODEL_ID, type VoiceProvider } from "@motionreal/pipeline";
import { registerIpcRouter, type InvokeHandlers } from "./ipc-router.js";
import { ModelGatewayManager } from "./gateway/model-gateway-manager.js";
import { createGatewayHandlers } from "./gateway/gateway-handlers.js";
import { buildNineRouterGatewayDeps } from "./gateway/ninerouter-deps.js";
import { NineRouterClient } from "./gateway/ninerouter-client.js";
import { NineRouterAuthoringBackend } from "./authoring/ninerouter-backend.js";
import { CustomLoopAgentWorker } from "./agent/custom-loop-worker.js";
import { LicenseManager } from "./license/license-manager.js";
import { DevLicenseService } from "./license/dev-license-service.js";
import { WorkspaceController } from "./workspace/workspace-controller.js";
import { runStartupSequence } from "./startup-sequence.js";
import { CreateController } from "./create/create-controller.js";
import { stripL0Tokens } from "./redact/friendly.js";
import { toCards } from "../shared/gallery-controller.js";
import { defaultSettings } from "../shared/settings-model.js";
import { SettingsStore } from "./settings/settings-store.js";
import { createSettingsHandlers } from "./settings/settings-handlers.js";
import { createThumbnailHandlers } from "./thumbnail/thumbnail-handlers.js";
import {
  importDroppedImages,
  importPickedImageFiles,
  sweepStagingDir,
  unstageImage,
  type ImageStagingDeps,
} from "./create/image-staging.js";
import { createControllerArgsFromIpc, parseVoiceProvider } from "./create/create-ipc.js";
import { createBgmHandlers } from "./bgm/bgm-handlers.js";
import {
  saveProjectThumbnail,
  saveProjectVideo,
  type NativeSaveDeps,
  type NativeSaveDialogOptions,
} from "./export/native-save.js";
import { registerMediaScheme, handleMediaProtocol, mediaUrl } from "./media-protocol.js";
import { events, setEventTarget } from "./event-bus.js";
import { existsSync, statSync } from "node:fs";
import { copyFile, readFile, readdir, rm, stat } from "node:fs/promises";
import type { DroppedImage, PickImagesResult, ScriptEdit } from "../shared/types.js";
import { authorInputFromBrief } from "./workspace/recall-author-input.js";
import {
  applyNonSensitiveEnvironment,
  detectProcessPrivilege,
  privilegeStartupError,
  scrubSensitiveEnvironment,
} from "./security/runtime-security.js";
import { readEnvFile, resolveBootVoiceEnv } from "./security/runtime-env.js";

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
 * The bundled 9router gateway is a real 9router on localhost:20128; login is
 * delegated to 9router's own UI. License is dev-bypassed here so the app is
 * launchable for review without a live LicenseService.
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
  ensureReady: () => gateway.ensureReady(),
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
  reviewStill: (id, sceneId) => mediaUrl(join(projectPaths(id).reviewDir, `${sceneId}.png`)) ?? "",
  toMedia: (p) => mediaUrl(p) ?? p,
  hasStill: (id, sceneId) => existsSync(join(projectPaths(id).reviewDir, `${sceneId}.png`)),
  hasOutput: (id) => existsSync(join(projectPaths(id).rendersDir, `${id}.mp4`)),
  outputMedia: (id) => mediaUrl(join(projectPaths(id).rendersDir, `${id}.mp4`)) ?? "",
  hasDraft: (id) => existsSync(join(projectPaths(id).rendersDir, `${id}.draft.mp4`)),
  draftMedia: (id) => mediaUrl(join(projectPaths(id).rendersDir, `${id}.draft.mp4`)) ?? "",
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
  // stores delivery knobs (format/duration tier/language) plus the prompt; urls
  // are re-extracted from it. Create-time images aren't persisted → a rehydrated
  // retry re-authors from text + links only (a degraded but functional recovery).
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
      ...(delivery?.format ? { format: delivery.format } : {}),
      ...(delivery?.durationTier ? { durationTier: delivery.durationTier } : {}),
      ttsProvider: voiceProvider,
      voiceId: config.voiceId,
      ...(config.modelId ? { modelId: config.modelId } : {}),
    });
    return res.ok ? { ok: true, projectId: res.data.projectId } : { ok: false, error: res.error };
  },
  beginCreate: (id, input) => workspace.beginCreate(id, input),
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
    return `Chưa cấu hình ${missing.join(" và ")} cho ${label}. Mở Cài đặt để thêm rồi thử lại.`;
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

// Dev license: starts unactivated so the activation screen shows. The dev code
// "123" activates it via the tested LicenseManager over a DevLicenseService
// (the LicenseService seam; HttpLicenseService is the future online adapter).
const licenseManager = new LicenseManager({ service: new DevLicenseService(), machineId: "dev" });

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

const settingsHandlers = createSettingsHandlers({
  current: () => settingsStore.current(),
  update: (patch) => settingsStore.update(patch),
  setApiKey: (provider, apiKey) => settingsStore.setApiKey(provider, apiKey),
  clearApiKey: (provider) => settingsStore.clearApiKey(provider),
  parseVoiceProvider,
});

const thumbnailHandlers = createThumbnailHandlers({
  generateThumbnail: (projectId) => workspace.generateThumbnail(projectId),
  saveThumbnail: (projectId) => saveProjectThumbnail(projectId, nativeSaveDeps),
});

// IPC ownership inventory: keep Electron lifecycle and dependency
// wiring here, but route contained behavior to focused owners when a seam exists.
// - license: inline thin wrapper over LicenseManager.
// - gateway AI: grouped factory in gateway/gateway-handlers.ts (selectedModel mirror).
// - projects: mixed root wiring; create payload coercion lives in create-ipc.ts,
// create behavior in CreateController, image staging in image-staging.ts,
// workspace behavior in WorkspaceController, and native save in native-save.ts.
// - BGM: grouped factory in bgm/bgm-handlers.ts.
// - thumbnail: grouped factory in thumbnail/thumbnail-handlers.ts.
// - script/review: inline thin wrappers over WorkspaceController/settingsStore.
// - settings/TTS: grouped factory in settings/settings-handlers.ts.
const handlers: InvokeHandlers = {
  "license:get": () => licenseManager.current(),
  "license:activate": (key) => licenseManager.activate(String(key)),

  ...gatewayHandlers,

  "projects:list": () => workspace.list(),
  "projects:create": (input) => {
    const args = createControllerArgsFromIpc(input);
    return create.create(args.raw, args.images, args.choices);
  },
  "projects:pickImages": () => pickImages(),
  "projects:importImageBytes": (files) => importDroppedImages(files as DroppedImage[], imageStagingDeps),
  "projects:removeStagedImage": (ref) => unstageImage(String(ref), imageStagingDeps),
  "projects:stage": (projectId) => workspace.stage(String(projectId)),
  "projects:rename": (projectId, newTitle) => workspace.rename(String(projectId), String(newTitle)),
  "projects:open": (projectId) => workspace.open(String(projectId)),
  "projects:delete": (projectId) => workspace.delete(String(projectId)),
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

  ...bgmHandlers,
  ...thumbnailHandlers,

  "script:get": (projectId) => workspace.scriptGate(String(projectId)),
  "script:applyEdits": (projectId, edits) => workspace.applyEdits(String(projectId), edits as ScriptEdit[]),
  "script:approve": (projectId) => {
    workspace.approve(String(projectId)); // stage 2: approved → render voice + draft
    return undefined;
  },
  "script:setEnabled": (enabled) => {
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

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 1080,
    minHeight: 720,
    show: true,
    icon: join(here, "../../assets/brand/taskbar-logo.png"),
    webPreferences: {
      preload: join(here, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
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

app
  .whenReady()
  .then(async () => {
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
    void sweepStagingDir(imageStagingDeps).catch((error) => {
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
    await runStartupSequence({
      reconcileStaleStates,
      onReconcileError: (error) => {
        log.warn({ err: error }, "stale-state reconcile failed; desktop startup will continue");
      },
      startGateway,
      createWindow,
    });
  })
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error("[desktop] failed to start:", error);
    app.quit();
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});
