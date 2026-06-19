import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { fileURLToPath } from "node:url";
import { basename, dirname, join } from "node:path";
import { createTools } from "@news/mcp";
import { loadManifest, writeJson, projectPaths, videoToolHome, stagingDir, ensureProject, importImageBytes, setAuthoredLoader, reconcileStaleStates, pruneRenderCache, pruneTtsCache, readBrief, listBgmTracks, addBgmTrack, removeBgmTrack, renderThumbnail, type BgmTrack } from "@news/pipeline";
import { registerIpcRouter, type InvokeHandlers } from "./ipc-router.js";
import { ModelGatewayManager } from "./gateway/model-gateway-manager.js";
import { buildNineRouterGatewayDeps } from "./gateway/ninerouter-deps.js";
import { NineRouterClient } from "./gateway/ninerouter-client.js";
import { NineRouterAuthoringBackend } from "./authoring/ninerouter-backend.js";
import { CustomLoopAgentWorker } from "./agent/custom-loop-worker.js";
import { LicenseManager } from "./license/license-manager.js";
import { DevLicenseService } from "./license/dev-license-service.js";
import { WorkspaceController } from "./workspace/workspace-controller.js";
import { CreateController } from "./create/create-controller.js";
import { stripL0Tokens } from "./redact/friendly.js";
import { toCards } from "../shared/gallery-controller.js";
import { defaultSettings } from "../shared/settings-model.js";
import { SettingsStore } from "./settings/settings-store.js";
import { registerMediaScheme, handleMediaProtocol, mediaUrl } from "./media-protocol.js";
import { events, setEventTarget } from "./event-bus.js";
import { loadAuthoredTsx } from "./authoring/tsx-loader.js";
import { existsSync, readFileSync } from "node:fs";
import { copyFile, readFile, readdir, rm, stat } from "node:fs/promises";
import type { DroppedImage, ModelInfo, PickImagesResult, ScriptEdit, SettingsModel } from "../shared/types.js";
import { extractUrls } from "../shared/create-validation.js";
import {
  applyNonSensitiveEnvironment,
  detectProcessPrivilege,
  privilegeStartupError,
  scrubSensitiveEnvironment,
} from "./security/runtime-security.js";

// The `media://` scheme must be registered before the app is ready.
registerMediaScheme();

// The bundled Electron main is plain Node ESM (no `.tsx` loader), so authored
// scenes are loaded for the admission handshake via esbuild — set process-wide
// so BOTH the authoring step AND renderProject's admission use it.
setAuthoredLoader(loadAuthoredTsx);

// Electron reads `.env` once, captures only the Vivibe values it needs in a
// closure, then removes credential-looking variables from process.env before any
// authored module can be loaded. Non-secret runtime configuration still follows
// normal env precedence.
function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const values: Record<string, string> = {};
  try {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (!m || line.trim().startsWith("#")) continue;
      const key = m[1]!;
      let val = m[2]!;
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      values[key] = val;
    }
  } catch (e) {
    console.warn("[env] failed to load .env:", e);
  }
  return values;
}
const REPO_ROOT = dirname(process.env.VIDEO_TOOL_HOME ?? videoToolHome());
const fileEnv = readEnvFile(join(REPO_ROOT, ".env"));
const bootVoiceEnv = Object.freeze({
  apiKey:
    process.env.VIVIBE_API_KEY?.trim() ||
    process.env.VIETNAMESE_API_KEY?.trim() ||
    fileEnv.VIVIBE_API_KEY?.trim() ||
    fileEnv.VIETNAMESE_API_KEY?.trim() ||
    "",
  voiceId:
    process.env.VIVIBE_VOICE_ID?.trim() ||
    process.env.VIETNAMESE_VOICEID?.trim() ||
    fileEnv.VIVIBE_VOICE_ID?.trim() ||
    fileEnv.VIETNAMESE_VOICEID?.trim(),
});
applyNonSensitiveEnvironment(fileEnv);
scrubSensitiveEnvironment(fileEnv);
scrubSensitiveEnvironment(process.env);

/** Map a library BGM track to its renderer VM (a compact human size label). */
function toBgmVM(t: BgmTrack): { name: string; sizeLabel: string } {
  const mb = t.sizeBytes / (1024 * 1024);
  const sizeLabel = mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(t.sizeBytes / 1024))} KB`;
  return { name: t.name, sizeLabel };
}

/**
 * Electron main = the ENGINE HOST (web-dashboard). Imports the MCP tools (and
 * through them `@news/pipeline`) from source → ONE `@news/compositions` registry.
 * The bundled Model_Gateway is a real 9router on localhost:20128; login is
 * delegated to 9router's own UI. License is dev-bypassed here so the app is
 * launchable for review without a live License_Service.
 */

const SETTINGS_FILE = join(videoToolHome(), "news-studio-settings.json");

// Settings persistence lives in the tested SettingsStore (reconcile S2): load
// merged over defaults (aiAccount forced from default), update/save excluding
// aiAccount, voiceConfig with .env fallback.
const settingsStore = new SettingsStore({
  filePath: SETTINGS_FILE,
  defaults: () => defaultSettings(videoToolHome()),
  envApiKey: () => bootVoiceEnv.apiKey,
  envVoiceId: () => bootVoiceEnv.voiceId,
});
let selectedModel: ModelInfo | undefined;

// TTS config: a user-entered voice key/id (Settings) overrides the .env fallback.
const tools = createTools({
  ttsConfig: () => settingsStore.voiceConfig(),
});
const nrClient = new NineRouterClient();
const gateway = new ModelGatewayManager(
  buildNineRouterGatewayDeps({ client: nrClient, openExternal: (url) => void shell.openExternal(url) }),
);

// The authoring brain: AI writes a kit-based manifest; we admit + render. Drives
// the SAME tools / one registry; render progress is forwarded to the UI.
// `reportProgress` is a forwarder set once the WorkspaceController exists (below),
// so the renderer's real per-frame progress drives the staged rendering bar.
let reportProgress: (projectId: string, ratio: number) => void = () => {};
const authoringBackend = new NineRouterAuthoringBackend({
  client: nrClient,
  tools,
  model: () => selectedModel?.id,
  apiKey: () => undefined, // 9router /v1 is open on localhost
  // Per-voice CALIBRATED narration rate for the author word-budget (K1/R5.4/D13);
  // undefined when uncalibrated/stale ⇒ the prompt uses its baked default (~4.7).
  wordsPerSecond: () => settingsStore.calibratedWordsPerSecond(),
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
  // for the review screen preview. Resolved under videoToolHome() like every asset.
  assetMedia: (id, ref) => mediaUrl(join(projectPaths(id).root, ref)) ?? "",
  deleteProject: (id) => rm(projectPaths(id).root, { recursive: true, force: true }),
  revealProject: async (id) => {
    await shell.openPath(projectPaths(id).root);
  },
  // Rehydrate a project's AuthorInput from the persisted brief when the in-memory
  // input is gone (after an app restart), so the error screen's "Thử lại" can
  // recover a project stranded across a restart instead of no-op'ing. The brief
  // stores only the prompt; urls are re-extracted from it. stylePackId/images
  // chosen at create time aren't persisted → a rehydrated retry re-authors from
  // text + links only (a degraded but functional recovery).
  recallInput: async (id) => {
    try {
      const brief = await readBrief(id);
      const text = brief.prompt?.trim();
      if (!text) return null;
      return { text, urls: extractUrls(text) };
    } catch {
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
  scaffold: async (prompt) => {
    const res = await tools.scaffold_project({ prompt });
    return res.ok ? { ok: true, projectId: res.data.projectId } : { ok: false, error: res.error };
  },
  beginCreate: (id, input) => workspace.beginCreate(id, input),
  // Preflight: block create on a guaranteed-fatal LOCAL config gap (a missing
  // Vivibe voice key/id read from SETTINGS — env is only the fallback), so the
  // whole AI authoring pass doesn't burn and then fail at TTS. Read from the
  // settings store, not env, so a key configured in the Settings UI counts. We
  // do NOT gate on gateway/model here — that stays a "guide, don't gate" chip.
  preflight: () => {
    const { apiKey, voiceId } = settingsStore.voiceConfig();
    const missing: string[] = [];
    if (!apiKey) missing.push("API key giọng đọc");
    if (!voiceId) missing.push("giọng đọc (voice id)");
    if (missing.length === 0) return undefined;
    return `Chưa cấu hình ${missing.join(" và ")} cho giọng đọc tiếng Việt. Mở Cài đặt để thêm rồi thử lại.`;
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
      } catch {
        /* unreadable staged file → skip; create proceeds without this image */
      }
    }
    return out;
  },
});

/**
 * Native image picker for the create screen (Phase 2 Block A). Opens a
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

  const result: PickImagesResult = { staged: [], rejected: [] };
  for (const path of picked.filePaths) {
    const name = path.split(/[\\/]/).pop() ?? path;
    try {
      await stageImported(name, await readFile(path), result);
    } catch {
      result.rejected.push({ name, reason: "decode-failed" });
    }
  }
  return result;
}

/**
 * Import raw image bytes the renderer captured from a paste (Ctrl+V) or
 * drag-drop (Phase 2 Block A). These have no filesystem path, so the bytes cross
 * IPC directly; staging + content-addressing + the result shape are identical to
 * the native picker (both funnel through `stageImported`). A bad item is dropped
 * with its reason; the rest still stage.
 */
async function importDroppedImages(files: DroppedImage[]): Promise<PickImagesResult> {
  const result: PickImagesResult = { staged: [], rejected: [] };
  for (const file of files) {
    try {
      // The bytes arrive base64-encoded over IPC; decode to a Buffer to import.
      await stageImported(file.name, Buffer.from(file.dataBase64, "base64"), result);
    } catch {
      result.rejected.push({ name: file.name, reason: "decode-failed" });
    }
  }
  return result;
}

/**
 * Import one image's bytes into the home staging dir (content-addressed) and
 * push either a staged preview or a per-file rejection onto `result`. Shared by
 * the native picker and the paste/drag-drop path so both stage identically.
 */
async function stageImported(name: string, bytes: Uint8Array, result: PickImagesResult): Promise<void> {
  const dir = stagingDir();
  const res = await importImageBytes(bytes, dir, { refPrefix: "staging" });
  if (res.ok) {
    result.staged.push({
      ref: res.ref,
      previewUrl: mediaUrl(join(dir, `${res.sha}.${res.ext}`)) ?? "",
      width: res.width,
      height: res.height,
      bytes: res.bytes,
      name,
    });
  } else {
    result.rejected.push({ name, reason: res.reason });
  }
}

/**
 * Delete one staged image the user removed at the create screen (the ✕ on a
 * thumbnail). Without this, a picked-then-removed image lingers in the staging
 * dir until the 24h startup sweep — bytes accumulate within a session. The 24h
 * sweep stays as the safety net for picked-but-never-removed images.
 *
 * Path-safe: the ref must be exactly `staging/<filename>` (the shape
 * `importImageBytes` returns). We strip to the basename and rebuild the path
 * under `stagingDir()`, so a crafted ref with `..` or an absolute path can never
 * escape the staging dir. A missing file is a no-op (idempotent).
 */
async function unstageImage(ref: string): Promise<void> {
  if (!ref.startsWith("staging/")) return; // only staging refs are ours to delete
  const name = basename(ref); // collapse any traversal to a bare filename
  if (!name || name === "." || name === "..") return;
  await rm(join(stagingDir(), name), { force: true });
}

/**
 * Best-effort sweep of staged create-time images older than ~24h (Phase 2 Block
 * A). A user who picks images but never creates the project leaves bytes in the
 * staging dir; this clears stale ones so they don't accumulate. Never blocks
 * startup — a sweep failure (missing dir, locked file) is swallowed.
 */
async function sweepStagingDir(maxAgeMs = 24 * 60 * 60 * 1000): Promise<void> {
  const dir = stagingDir();
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return; // no staging dir yet → nothing to sweep
  }
  const now = Date.now();
  for (const name of entries) {
    const abs = join(dir, name);
    try {
      const st = await stat(abs);
      if (now - st.mtimeMs > maxAgeMs) await rm(abs, { force: true });
    } catch {
      /* a single unstattable/locked entry must not abort the sweep */
    }
  }
}

// Dev license: starts unactivated so the activation screen shows. The dev code
// "123" activates it via the tested LicenseManager over a DevLicenseService
// (the LicenseService seam; HttpLicenseService is the future online adapter).
const licenseManager = new LicenseManager({ service: new DevLicenseService(), machineId: "dev" });

const handlers: InvokeHandlers = {
  "license:get": () => licenseManager.current(),
  "license:activate": (key) => licenseManager.activate(String(key)),

  "ai:gatewayState": () => gateway.ensureReady(),
  "ai:listProviders": () => gateway.listProviders(),
  "ai:connectedAccounts": () => gateway.refreshConnections(),
  "ai:beginConnect": (providerId) => gateway.beginConnect(String(providerId)),
  "ai:listModels": () => gateway.listModels(),
  "ai:selectModel": (modelId) => {
    selectedModel = { id: String(modelId), label: String(modelId) };
    return gateway.selectModel(selectedModel);
  },
  "ai:selectedModel": () => gateway.selectedModel(),

  "projects:list": () => workspace.list(),
  "projects:create": (input) => {
    const i = input as {
      raw: string;
      format?: "tiktok" | "youtube";
      durationTier?: 1 | 2 | 3;
      titleLanguage?: "vi" | "en" | "mix";
      images?: { ref: string; width: number; height: number }[];
    };
    return create.create(i.raw, i.images ?? [], {
      ...(i.format ? { format: i.format } : {}),
      ...(i.durationTier ? { durationTier: i.durationTier } : {}),
      ...(i.titleLanguage ? { titleLanguage: i.titleLanguage } : {}),
    });
  },
  "projects:pickImages": () => pickImages(),
  "projects:importImageBytes": (files) => importDroppedImages(files as DroppedImage[]),
  "projects:removeStagedImage": (ref) => unstageImage(String(ref)),
  "projects:stage": (projectId) => workspace.stage(String(projectId)),
  "projects:rename": (projectId, newTitle) => workspace.rename(String(projectId), String(newTitle)),
  "projects:open": (projectId) => workspace.open(String(projectId)),
  "projects:delete": (projectId) => workspace.delete(String(projectId)),
  "projects:reveal": (projectId) => workspace.reveal(String(projectId)),
  "projects:save": async (projectId) => {
    // Export the finished full MP4 to a user-chosen location. Distinct from
    // `reveal` (which only opens the store folder): a native Save dialog lets a
    // non-tech user drop the video wherever they want. We COPY (never move) —
    // the original must stay in the store so `hasOutput`/the `published` stage
    // keep resolving. Writing OUTSIDE the `.video-tool` sandbox is intentional
    // here: it's a user-initiated export gated by the dialog, the one allowed
    // path out. No dialog ⇒ no write, ever.
    const id = String(projectId);
    const src = join(projectPaths(id).rendersDir, `${id}.mp4`);
    if (!existsSync(src)) return { saved: false };
    const cards = await tools.list_projects();
    const title = cards.ok ? toCards(cards.data).find((c) => c.projectId === id)?.title : undefined;
    const safeName = (title ?? id).replace(/[\\/:*?"<>|]/g, "_").trim() || id;
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const opts = {
      title: "Lưu video",
      defaultPath: join(settingsStore.current().outputDir || app.getPath("downloads"), `${safeName}.mp4`),
      filters: [{ name: "Video MP4", extensions: ["mp4"] }],
    };
    const picked = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (picked.canceled || !picked.filePath) return { saved: false };
    try {
      await copyFile(src, picked.filePath);
      return { saved: true };
    } catch (e) {
      // A raw fs error here (a locked destination, EPERM/EACCES on a protected
      // folder, a removed drive) would otherwise propagate the absolute path +
      // OS error code straight to the renderer's rejected invoke — every other
      // handler redacts. Swallow to a clean flag + a generic Vietnamese reason.
      console.warn(`[desktop] save/export failed for ${id}:`, e);
      return { saved: false, error: "Không lưu được video ra vị trí đã chọn. Hãy thử lại hoặc chọn thư mục khác." };
    }
  },
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

  "bgm:list": async () => (await listBgmTracks()).map(toBgmVM),
  "bgm:add": async () => {
    // Open a native multi-select picker and copy each chosen audio file into the
    // per-machine library (collision-safe). A single bad/locked file is skipped
    // (logged) rather than aborting the rest; the updated list is returned.
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const opts = {
      title: "Thêm nhạc nền",
      properties: ["openFile", "multiSelections"] as Array<"openFile" | "multiSelections">,
      filters: [{ name: "Âm thanh", extensions: ["mp3", "m4a", "wav"] }],
    };
    const picked = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (!picked.canceled) {
      for (const path of picked.filePaths) {
        try {
          await addBgmTrack(path);
        } catch (e) {
          console.warn(`[desktop] bgm:add skipped "${path}":`, e);
        }
      }
    }
    return (await listBgmTracks()).map(toBgmVM);
  },
  "bgm:remove": async (name) => {
    await removeBgmTrack(String(name));
    return (await listBgmTracks()).map(toBgmVM);
  },
  "bgm:getForProject": async (projectId) => {
    try {
      const manifest = await loadManifest(String(projectId));
      const bgm = (manifest as { bgm?: unknown }).bgm;
      return typeof bgm === "string" && bgm.length > 0 ? bgm : null;
    } catch (e) {
      console.warn(`[desktop] bgm:getForProject failed for ${String(projectId)}:`, e);
      return null;
    }
  },
  "bgm:setForProject": async (projectId, name) => {
    // Persist the project's BGM choice on its manifest (load full → patch → write,
    // same as rename so theme/format/scenes survive). null/empty clears it.
    const id = String(projectId);
    try {
      const manifest = await loadManifest(id);
      const chosen = typeof name === "string" && name.length > 0 ? name : undefined;
      const next = { ...manifest, ...(chosen ? { bgm: chosen } : { bgm: undefined }) };
      await writeJson(projectPaths(id).manifest, next);
    } catch (e) {
      console.warn(`[desktop] bgm:setForProject failed for ${id}:`, e);
    }
    return undefined;
  },

  "thumbnail:generate": (projectId) => workspace.generateThumbnail(String(projectId)),
  "thumbnail:save": async (projectId) => {
    const id = String(projectId);
    const src = join(projectPaths(id).reviewDir, "thumbnail.png");
    if (!existsSync(src)) return { saved: false };
    const cards = await tools.list_projects();
    const title = cards.ok ? toCards(cards.data).find((card) => card.projectId === id)?.title : undefined;
    const safeName = (title ?? id).replace(/[\\/:*?"<>|]/g, "_").trim() || id;
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const opts = {
      title: "Lưu ảnh bìa",
      defaultPath: join(settingsStore.current().outputDir || app.getPath("downloads"), `${safeName}-cover.png`),
      filters: [{ name: "Ảnh PNG", extensions: ["png"] }],
    };
    const picked = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (picked.canceled || !picked.filePath) return { saved: false };
    try {
      await copyFile(src, picked.filePath);
      return { saved: true };
    } catch (error) {
      console.warn(`[desktop] thumbnail export failed for ${id}:`, error);
      return { saved: false, error: "Không lưu được ảnh bìa. Hãy thử lại hoặc chọn thư mục khác." };
    }
  },

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

  "settings:get": () => settingsStore.current(),
  "settings:update": (patch) => {
    return settingsStore.update(patch as Partial<SettingsModel>);
  },
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
    show: true,
    webPreferences: {
      preload: join(here, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
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
  .then(() => {
    const privilegeError = privilegeStartupError(detectProcessPrivilege());
    if (privilegeError) {
      dialog.showErrorBox("Không thể khởi động an toàn", privilegeError);
      app.exit(1);
      return;
    }
    handleMediaProtocol();
    // Reset any project left mid-job by a crashed prior session (audit P1-5), so
    // the gallery never shows a permanently-stuck "rendering" badge. Best-effort:
    // a sweep failure must never block startup.
    void reconcileStaleStates().catch((error) => {
      // eslint-disable-next-line no-console
      console.error("[desktop] stale-state reconcile failed:", error);
    });
    // Clear stale staged create-time images (picked but never used). Best-effort.
    void sweepStagingDir().catch((error) => {
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
    startGateway();
    return createWindow();
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
