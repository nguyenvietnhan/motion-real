import { app, BrowserWindow, ipcMain, shell } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createTools } from "@news/mcp";
import { loadManifest } from "@news/pipeline";
import { registerIpcRouter, type InvokeHandlers } from "./ipc-router.js";
import { ModelGatewayManager } from "./gateway/model-gateway-manager.js";
import { buildNineRouterGatewayDeps } from "./gateway/ninerouter-deps.js";
import { NineRouterClient } from "./gateway/ninerouter-client.js";
import { NineRouterAuthoringBackend } from "./authoring/ninerouter-backend.js";
import { CustomLoopAgentWorker } from "./agent/custom-loop-worker.js";
import type { AgentHooks, AuthorInput } from "./agent/agent-worker.js";
import { toCards } from "../renderer/gallery/gallery-controller.js";
import { defaultSettings } from "../renderer/settings/settings-model.js";
import { validateCreateInput } from "./create/create-controller.js";
import { registerMediaScheme, handleMediaProtocol, mediaUrl } from "./media-protocol.js";
import { events, setEventTarget } from "./event-bus.js";
import { projectPaths } from "@news/pipeline";
import { join } from "node:path";
import type { LicenseState, ModelInfo, SceneCard, SettingsModel, StoryboardModel } from "../shared/types.js";

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
  buildNineRouterGatewayDeps({ client: nrClient, openExternal: (url) => void shell.openExternal(url) }),
);

let settings: SettingsModel = defaultSettings(process.env.VIDEO_TOOL_HOME ?? "");
let selectedModel: ModelInfo | undefined;
let activeProjectId: string | null = null;

// The authoring brain: AI writes a kit-based manifest; we admit + render. Drives
// the SAME tools / one registry; render progress is forwarded to the UI.
const authoringBackend = new NineRouterAuthoringBackend({
  client: nrClient,
  tools,
  model: () => selectedModel?.id,
  apiKey: () => undefined, // 9router /v1 is open on localhost
  onRenderProgress: (ratio) => events.progress({ projectId: activeProjectId ?? "", ratio, phase: "draft" }),
});
const worker = new CustomLoopAgentWorker(authoringBackend);

/** Run the silent authoring + generate-validate-repair loop for a project. */
async function runAuthoring(projectId: string, input: AuthorInput): Promise<void> {
  activeProjectId = projectId;
  const hooks: AgentHooks = {
    onProgress: (ratio) => events.progress({ projectId, ratio, phase: "draft" }),
    onSceneProduced: (sceneId, stillPath) => events.scene({ projectId, sceneId, stillPath: mediaUrl(stillPath) ?? stillPath }),
    onRepair: () => {},
  };
  events.status({ projectId, status: "building" });
  try {
    const authored = await worker.author({ projectId, input, scriptGate: false }, hooks);
    if (authored.kind !== "authored") {
      events.friendlyError({ projectId, message: authored.message, retry: "create" });
      events.status({ projectId, status: "error" });
      return;
    }
    const outcome = await worker.generateValidateRepair(projectId, { maxAttempts: settings.maxRepairAttempts }, hooks);
    events.status({ projectId, status: outcome.kind === "passed" ? "draft-ready" : "error" });
    if (outcome.kind !== "passed") {
      events.friendlyError({ projectId, message: "Chưa hoàn tất được video. Hãy thử tạo lại.", retry: "create" });
    }
  } catch (e) {
    events.friendlyError({ projectId, message: e instanceof Error ? e.message : "Có lỗi khi dựng video.", retry: "create" });
    events.status({ projectId, status: "error" });
  }
}

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
    const projectId = res.data.projectId;
    const authorInput: AuthorInput =
      v.classified.kind === "url" ? { kind: "url", url: v.classified.url } : { kind: "topic", text: v.classified.text };
    void runAuthoring(projectId, authorInput); // silent background authoring
    return { projectId };
  },
  "projects:open": async (projectId): Promise<StoryboardModel> => {
    const id = String(projectId);
    const reviewDir = projectPaths(id).reviewDir;
    try {
      const manifest = await loadManifest(id);
      const scenes: SceneCard[] = manifest.scenes.map((s, i) => ({
        sceneId: s.id,
        order: i,
        stillPath: mediaUrl(join(reviewDir, `${s.id}.png`)) ?? "",
        editText: "",
      }));
      return { projectId: id, scenes, globalNotes: "" };
    } catch {
      return { projectId: id, scenes: [], globalNotes: "" };
    }
  },

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
