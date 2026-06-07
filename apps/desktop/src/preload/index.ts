import { contextBridge, ipcRenderer } from "electron";

/**
 * Preload bridge (web-dashboard Task 1.1, expanded in 1.2).
 *
 * Exposes a SINGLE allow-listed `window.dashboard` object to the renderer and
 * nothing else (no `ipcRenderer`, no Node). The full typed `DashboardApi`
 * (license/ai/projects/script/review/settings/events) is layered on in Task 1.2;
 * this is the minimal, audited surface that proves the boundary.
 */

const api = {
  /** Liveness check used by the scaffold + the 1.3 bridge test. */
  ping: (): Promise<"pong"> => ipcRenderer.invoke("app:ping") as Promise<"pong">,
};

contextBridge.exposeInMainWorld("dashboard", api);

export type PreloadApi = typeof api;
