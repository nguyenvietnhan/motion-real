import { app, BrowserWindow, ipcMain, shell } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createTools } from "@news/mcp";
import { registerIpcRouter, type InvokeHandlers } from "./ipc-router.js";
import { ModelGatewayManager } from "./gateway/model-gateway-manager.js";
import { buildNineRouterGatewayDeps } from "./gateway/ninerouter-deps.js";
import { toCards } from "../renderer/gallery/gallery-controller.js";
import { defaultSettings } from "../renderer/settings/settings-model.js";
import { validateCreateInput } from "./create/create-controller.js";
import { registerMediaScheme, handleMediaProtocol, mediaUrl } from "./media-protocol.js";
import { events, setEventTarget } from "./event-bus.js";
import type { LicenseState, ModelInfo, SettingsModel } from "../shared/types.js";

// The `media://` scheme must be registered before the app is ready.
registerMediaScheme();

/**
 * Electron main = the ENGINE HOST (web-dashboard). Imports the MCP tools (and
 * through them `@news/pipeline`) from source → ONE `@news/compositions` registry.
 * The bundled Model_Gateway is a real 9router on localhost:20128; login is
 * delegated to 9router's own UI. License is dev-bypassed here so the app is
 * launchable for review without a live License_Service.
 */

const tools = createTools();
const gateway = new ModelGatewayManager(
  buildNineRouterGatewayDeps({ openExternal: (url) => void shell.openExternal(url) }),
);

let settings: SettingsModel = defaultSettings(process.env.VIDEO_TOOL_HOME ?? "");
let selectedModel: ModelInfo | undefined;
// Dev license: starts unactivated so the activation screen shows; the dev code
// "123" activates it (no real License_Service in dev).
const DEV_LICENSE_CODE = "123";
let license: LicenseState = { kind: "unactivated" };

const handlers: InvokeHandlers = {
  "license:get": () => license,
  "license:activate": (key) => {
    license =
      String(key).trim() === DEV_LICENSE_CODE
        ? { kind: "active", machineLocked: true, lastVerifiedAt: new Date().toISOString() }
        : { kind: "error", reason: "invalid" };
    return license;
  },

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

  "projects:list": async () => {
    const res = await tools.list_projects();
    return res.ok ? toCards(res.data).map((c) => ({ ...c, thumbnailPath: mediaUrl(c.thumbnailPath) })) : [];
  },
  "projects:create": async (input) => {
    const raw = (input as { raw: string }).raw;
    const v = validateCreateInput({ raw });
    if (!v.ok) throw new Error(v.reason);
    const prompt = v.classified.kind === "url" ? v.classified.url : v.classified.text;
    const res = await tools.scaffold_project({ prompt });
    if (!res.ok) throw new Error(res.error.cause);
    events.status({ projectId: res.data.projectId, status: "building" });
    return { projectId: res.data.projectId };
  },
  "projects:open": (projectId) => ({ projectId: String(projectId), scenes: [], globalNotes: "" }),

  "script:get": (projectId) => ({ projectId: String(projectId), enabled: settings.scriptGateEnabled, scenes: [] }),
  "script:applyEdits": () => ({ ok: true }),
  "script:approve": () => undefined,
  "script:setEnabled": (enabled) => {
    settings = { ...settings, scriptGateEnabled: Boolean(enabled) };
    return undefined;
  },

  "review:submitEdits": () => ({ ok: true, revision: 1 }),
  "review:approveDraft": () => ({ ok: false, reason: "draft-first" }),

  "settings:get": () => settings,
  "settings:update": (patch) => {
    settings = { ...settings, ...(patch as Partial<SettingsModel>), voiceProvider: "vivibe" };
    return settings;
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
