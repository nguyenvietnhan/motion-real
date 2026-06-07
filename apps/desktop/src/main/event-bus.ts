import type { WebContents } from "electron";
import type { EventChannel } from "../shared/channels.js";
import type { FriendlyError, ProgressEvent, SceneEvent, StatusEvent } from "../shared/types.js";

/**
 * Streaming event bus (web-dashboard B6). The main process pushes already-
 * translated view-models to the renderer over the allow-listed EVENT_CHANNELS;
 * the preload bridge re-exposes them as `window.dashboard.events.*`. Authoring
 * and render flows call these so the UI shows live progress, growing storyboard,
 * status badges, and friendly errors.
 */

let target: WebContents | null = null;

export function setEventTarget(wc: WebContents | null): void {
  target = wc;
}

function send(channel: EventChannel, payload: unknown): void {
  if (target && !target.isDestroyed()) target.send(channel, payload);
}

export const events = {
  progress(e: ProgressEvent): void {
    send("events:progress", e);
  },
  scene(e: SceneEvent): void {
    send("events:scene", e);
  },
  status(e: StatusEvent): void {
    send("events:status", e);
  },
  friendlyError(e: FriendlyError): void {
    send("events:friendlyError", e);
  },
};
