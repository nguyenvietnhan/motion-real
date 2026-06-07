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
import type { AgentHooks, AuthorInput } from "./agent/agent-worker.js";
import { toCards } from "../renderer/gallery/gallery-controller.js";
import { defaultSettings } from "../renderer/settings/settings-model.js";
import { SettingsStore } from "./settings/settings-store.js";
import { validateCreateInput } from "./create/create-controller.js";
import { registerMediaScheme, handleMediaProtocol, mediaUrl } from "./media-protocol.js";
import { events, setEventTarget } from "./event-bus.js";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import type { ModelInfo, ProjectStage, SceneCard, SettingsModel, StoryboardModel } from "../shared/types.js";

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

/** Per-project live workspace stage (drives the staged UI). */
const stages = new Map<string, ProjectStage>();

function setStage(projectId: string, stage: ProjectStage): void {
  stages.set(projectId, stage);
  const status =
    stage.kind === "ready" ? "draft-ready" : stage.kind === "error" ? "error" : "building";
  events.status({ projectId, status });
}

async function scriptLinesOf(projectId: string): Promise<import("../shared/types.js").ScriptLine[]> {
  const manifest = await loadManifest(projectId);
  return manifest.scenes.map((s, i) => ({ sceneId: s.id, order: i, headline: s.headline ?? "", narration: s.narration ?? "" }));
}

async function storyboardScenesOf(projectId: string): Promise<SceneCard[]> {
  const reviewDir = projectPaths(projectId).reviewDir;
  const manifest = await loadManifest(projectId);
  return manifest.scenes.map((s, i) => ({
    sceneId: s.id,
    order: i,
    stillPath: mediaUrl(join(reviewDir, `${s.id}.png`)) ?? "",
    editText: "",
  }));
}

/** Stage 1: AI writes the script (manifest). Then wait for approval unless the gate is off. */
async function runScript(projectId: string, input: AuthorInput): Promise<void> {
  setStage(projectId, { kind: "writing" });
  const hooks: AgentHooks = { onProgress: () => {}, onSceneProduced: () => {}, onRepair: () => {} };
  try {
    const authored = await worker.author({ projectId, input, scriptGate: settingsStore.scriptGateEnabled }, hooks);
    if (authored.kind !== "authored") {
      setStage(projectId, { kind: "error", message: authored.message });
      events.friendlyError({ projectId, message: authored.message, retry: "create" });
      return;
    }
    if (settingsStore.scriptGateEnabled) {
      setStage(projectId, { kind: "script", lines: await scriptLinesOf(projectId) });
    } else {
      await runRender(projectId);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Có lỗi khi viết kịch bản.";
    setStage(projectId, { kind: "error", message });
    events.friendlyError({ projectId, message, retry: "create" });
  }
}

/** Stage 2: render voice + draft with the generate-validate-repair loop. */
async function runRender(projectId: string): Promise<void> {
  setStage(projectId, { kind: "rendering", percent: 0 });
  const hooks: AgentHooks = {
    onProgress: (ratio) => {
      setStage(projectId, { kind: "rendering", percent: Math.round(ratio * 100) });
      events.progress({ projectId, ratio, phase: "draft" });
    },
    onSceneProduced: (sceneId, stillPath) => events.scene({ projectId, sceneId, stillPath: mediaUrl(stillPath) ?? stillPath }),
    onRepair: () => {},
  };
  try {
    const outcome = await worker.generateValidateRepair(projectId, { maxAttempts: settingsStore.maxRepairAttempts }, hooks);
    if (outcome.kind === "passed") {
      setStage(projectId, { kind: "ready", scenes: await storyboardScenesOf(projectId) });
    } else {
      const message = "Chưa hoàn tất được video sau nhiều lần thử. Hãy thử tạo lại.";
      setStage(projectId, { kind: "error", message });
      events.friendlyError({ projectId, message, retry: "draft" });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Có lỗi khi dựng video.";
    setStage(projectId, { kind: "error", message });
    events.friendlyError({ projectId, message, retry: "draft" });
  }
}

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
    setStage(projectId, { kind: "writing" });
    void runScript(projectId, authorInput); // stage 1: write the script
    return { projectId };
  },
  "projects:stage": async (projectId): Promise<ProjectStage> => {
    const id = String(projectId);
    const known = stages.get(id);
    if (known) return known;
    // Recover a stage for an existing project opened after a restart.
    try {
      const reviewDir = projectPaths(id).reviewDir;
      const manifest = await loadManifest(id);
      if (manifest.scenes.length === 0) return { kind: "writing" };
      const hasStills = manifest.scenes.some((s) => existsSync(join(reviewDir, `${s.id}.png`)));
      if (hasStills) return { kind: "ready", scenes: await storyboardScenesOf(id) };
      return { kind: "script", lines: await scriptLinesOf(id) };
    } catch {
      return { kind: "writing" };
    }
  },
  "projects:open": async (projectId): Promise<StoryboardModel> => {
    const id = String(projectId);
    try {
      return { projectId: id, scenes: await storyboardScenesOf(id), globalNotes: "" };
    } catch {
      return { projectId: id, scenes: [], globalNotes: "" };
    }
  },
  "projects:delete": async (projectId) => {
    const id = String(projectId);
    stages.delete(id);
    await rm(projectPaths(id).root, { recursive: true, force: true });
    return undefined;
  },
  "projects:reveal": async (projectId) => {
    await shell.openPath(projectPaths(String(projectId)).root);
    return undefined;
  },

  "script:get": async (projectId) => {
    const id = String(projectId);
    try {
      const lines = await scriptLinesOf(id);
      return { projectId: id, enabled: settingsStore.scriptGateEnabled, scenes: lines.map((l) => ({ sceneId: l.sceneId, order: l.order, narration: l.narration, headline: l.headline })) };
    } catch {
      return { projectId: id, enabled: settingsStore.scriptGateEnabled, scenes: [] };
    }
  },
  "script:applyEdits": async (projectId, edits) => {
    const id = String(projectId);
    try {
      const manifest = await loadManifest(id);
      const byId = new Map((edits as { sceneId: string; narration?: string; headline?: string }[]).map((e) => [e.sceneId, e]));
      for (const s of manifest.scenes) {
        const e = byId.get(s.id);
        if (!e) continue;
        if (e.narration !== undefined && e.narration.trim().length === 0) return { ok: false, reason: "empty-narration", sceneId: s.id };
        if (e.narration !== undefined) s.narration = e.narration;
        if (e.headline !== undefined) s.headline = e.headline;
      }
      await writeJson(projectPaths(id).manifest, manifest);
      if (stages.get(id)?.kind === "script") setStage(id, { kind: "script", lines: await scriptLinesOf(id) });
      return { ok: true };
    } catch {
      return { ok: false, reason: "write-failed" };
    }
  },
  "script:approve": (projectId) => {
    const id = String(projectId);
    void runRender(id); // stage 2: approved → render voice + draft
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
