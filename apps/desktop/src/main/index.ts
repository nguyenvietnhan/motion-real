import { app, BrowserWindow, ipcMain } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createTools } from "@news/mcp";
import { registerIpcRouter } from "./ipc-router.js";

/**
 * Electron main = the ENGINE HOST (web-dashboard Task 1.1).
 *
 * It imports the MCP tool layer (and through it `@news/pipeline`) FROM SOURCE,
 * so registration resolves to the ONE `@news/compositions` registry instance —
 * exactly the path the CLI and tests use (AGENTS.md "the reliable path"; R12.10).
 * No second registry is created. The renderer is a pure UI process reached only
 * through the typed preload bridge (contextIsolation on, nodeIntegration off).
 */

// The single tool instance for this process. Holds the one registry; every
// dashboard operation (create/draft/full/...) goes through these tools.
const tools = createTools();
void tools; // wired to IPC handlers in later waves

// Register the typed IPC router skeleton. Handlers are stubbed for now (Task
// 1.2); later waves attach the license/ai/projects/script/review/settings
// controllers. Every allow-listed channel exists so the renderer's typed client
// has a live endpoint; an unwired channel fails loud rather than silently.
registerIpcRouter(ipcMain, {});

const here = dirname(fileURLToPath(import.meta.url));

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    show: true,
    webPreferences: {
      preload: join(here, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    await win.loadURL(devUrl);
  } else {
    await win.loadFile(join(here, "../renderer/index.html"));
  }
}

app.whenReady().then(createWindow).catch((error) => {
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
