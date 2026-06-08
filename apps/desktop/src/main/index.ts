import { app, BrowserWindow, ipcMain, shell } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createTools } from "@news/mcp";
import { loadManifest, writeJson, projectPaths, videoToolHome, vivibeApiKey, defaultVivibeVoiceId, setAuthoredLoader } from "@news/pipeline";
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
import { rm } from "node:fs/promises";
import type { ModelInfo, ScriptEdit, SettingsModel } from "../shared/types.js";

// The `media://` scheme must be registered before the app is ready.
registerMediaScheme();

// The bundled Electron main is plain Node ESM (no `.tsx` loader), so authored
// scenes are loaded for the admission handshake via esbuild — set process-wide
// so BOTH the authoring step AND renderProject's admission use it.
setAuthoredLoader(loadAuthoredTsx);

// Electron is NOT launched with `--env-file=.env` (unlike the tsx build scripts),
// so the repo `.env` is loaded here into process.env — the engine's
// `vivibeApiKey()`/`defaultVivibeVoiceId()` read process.env. Existing env wins.
function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  try {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (!m || line.trim().startsWith("#")) continue;
      const key = m[1]!;
      let val = m[2]!;
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch (e) {
    console.warn("[env] failed to load .env:", e);
  }
}
const REPO_ROOT = dirname(process.env.VIDEO_TOOL_HOME ?? videoToolHome());
loadEnvFile(join(REPO_ROOT, ".env"));

/** Bridge user-entered voice settings into the env the engine reads. */
function applyVoiceEnv(s: SettingsModel): void {
  const key = s.voiceApiKey?.trim();
  const voice = s.voiceId?.trim();
  if (key) process.env.VIETNAMESE_API_KEY = key;
  if (voice) process.env.VIETNAMESE_VOICEID = voice;
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
  envApiKey: vivibeApiKey,
  envVoiceId: defaultVivibeVoiceId,
});
applyVoiceEnv(settingsStore.current());
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
  onRenderProgress: (ratio, projectId) => {
    reportProgress(projectId, ratio);
    events.progress({ projectId, ratio, phase: "draft" });
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
  deleteProject: (id) => rm(projectPaths(id).root, { recursive: true, force: true }),
  revealProject: async (id) => {
    await shell.openPath(projectPaths(id).root);
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
  beginScript: (id, input) => workspace.beginScript(id, input),
});

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
  "projects:create": (input) => create.create((input as { raw: string }).raw),
  "projects:stage": (projectId) => workspace.stage(String(projectId)),
  "projects:open": (projectId) => workspace.open(String(projectId)),
  "projects:delete": (projectId) => workspace.delete(String(projectId)),
  "projects:reveal": (projectId) => workspace.reveal(String(projectId)),
  "projects:retry": (projectId) => {
    workspace.retry(String(projectId));
    return undefined;
  },
  "projects:fixWithAi": (projectId) => {
    workspace.fixWithAi(String(projectId));
    return undefined;
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
    const next = settingsStore.update(patch as Partial<SettingsModel>);
    applyVoiceEnv(next);
    return next;
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
    handleMediaProtocol();
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
