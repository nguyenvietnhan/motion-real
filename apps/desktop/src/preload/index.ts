import { contextBridge, ipcRenderer } from "electron";
import { createDashboardClient, type IpcLike } from "./client.js";

/**
 * Preload bridge (web-dashboard Task 1.2).
 *
 * Exposes a SINGLE allow-listed `window.dashboard` object to the renderer and
 * nothing else (no `ipcRenderer`, no Node). The full typed `DashboardApi`
 * (license/ai/projects/script/review/settings/events) is built by the pure
 * `createDashboardClient` over a thin `IpcLike` wrapper around Electron's
 * `ipcRenderer`; the renderer can only reach the engine through these channels.
 */

const ipc: IpcLike = {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, listener) => {
    // Pass the listener straight through so `off` can match the same reference
    // for clean unsubscription.
    ipcRenderer.on(channel, listener as (event: unknown, ...args: unknown[]) => void);
  },
  off: (channel, listener) => {
    ipcRenderer.removeListener(channel, listener as (event: unknown, ...args: unknown[]) => void);
  },
};

contextBridge.exposeInMainWorld("dashboard", createDashboardClient(ipc));
