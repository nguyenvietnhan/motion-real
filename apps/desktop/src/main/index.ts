import { app, BrowserWindow, ipcMain, shell } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createTools } from "@news/mcp";
import { loadManifest, writeJson, projectPaths, videoToolHome, vivibeApiKey, defaultVivibeVoiceId } from "@news/pipeline";
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
import { toCards } from "../renderer/gallery/gallery-controller.js";
import { defaultSettings } from "../renderer/settings/settings-model.js";
import { SettingsStore } from "./settings/settings-store.js";
import { registerMediaScheme, handleMediaProtocol, mediaUrl } from "./media-protocol.js";
import { events, setEventTarget } from "./event-bus.js";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import type { ModelInfo, ScriptEdit, SettingsModel } from "../shared/types.js";

// The `media://` scheme must be registered before the app is ready.
registerMediaScheme();

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
const authoringBackend = new NineRouterAuthoringBackend({
  client: nrClient,
  tools,
  model: () => selectedModel?.id,
  apiKey: () => undefined, // 9router /v1 is open on localhost
  onRenderProgress: (ratio, projectId) => events.progress({ projectId, ratio, phase: "draft" }),
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
  deleteProject: (id) => rm(projectPaths(id).root, { recursive: true, force: true }),
  revealProject: async (id) => {
    await shell.openPath(projectPaths(id).root);
  },
});

// Create flow (validate → scaffold via the ONE registry → hand off to the
// staged workspace) lives in the tested CreateController (reconcile S5).
const create = new CreateController({
  scaffold: async (prompt) => {
    const res = await tools.scaffold_project({ prompt });
    return res.ok ? { ok: true, projectId: res.data.projectId } : { ok: false, cause: res.error.cause };
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

  "ai:gatewayState": () => gateway.state(),
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

  "review:submitEdits": () => ({ ok: true, revision: 1 }),
  "review:approveDraft": () => ({ ok: false, reason: "draft-first" }),

  "settings:get": () => settingsStore.current(),
  "settings:update": (patch) => settingsStore.update(patch as Partial<SettingsModel>),
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
