import { INVOKE_CHANNELS, type InvokeChannel } from "../shared/channels.js";

/**
 * The minimal slice of Electron's `ipcMain` the router needs — an injectable
 * seam so the router is unit-testable with a fake (no real Electron process).
 */
export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
}

/** A single invoke handler; receives the raw args after the IPC event. */
export type InvokeHandler = (...args: unknown[]) => unknown | Promise<unknown>;

/** Partial map of channel -> handler; unregistered channels throw on call. */
export type InvokeHandlers = Partial<Record<InvokeChannel, InvokeHandler>>;

/**
 * Register every allow-listed invoke channel on `ipcMain` (web-dashboard Task
 * 1.2). Each channel dispatches to its handler; a channel with no handler yet
 * throws "No handler registered" so a missing wiring fails loud instead of
 * silently resolving `undefined`. Only `INVOKE_CHANNELS` are ever registered —
 * the router cannot expose anything outside the contract.
 */
export function registerIpcRouter(ipcMain: IpcMainLike, handlers: InvokeHandlers): void {
  for (const channel of INVOKE_CHANNELS) {
    const handler = handlers[channel];
    ipcMain.handle(channel, (_event, ...args) => {
      if (!handler) {
        throw new Error(`No handler registered for IPC channel "${channel}"`);
      }
      return handler(...args);
    });
  }
}
