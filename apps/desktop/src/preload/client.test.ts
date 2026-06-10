import { describe, expect, it, vi } from "vitest";
import { createDashboardClient, type IpcLike } from "./client.js";
import { registerIpcRouter, type IpcMainLike } from "../main/ipc-router.js";
import { INVOKE_CHANNELS, EVENT_CHANNELS, isInvokeChannel } from "../shared/channels.js";

/**
 * Feature: web-dashboard, Task 1.3 — unit tests for the IPC bridge allow-list
 * and event wiring. The preload client may reach ONLY the allow-listed channels
 * and event subscriptions must unsubscribe cleanly. (Req 11.5, 11.6)
 */

type OnCall = { channel: string; listener: (...args: unknown[]) => void };

function fakeIpc(): {
  ipc: IpcLike;
  invokes: { channel: string; args: unknown[] }[];
  ons: OnCall[];
  offs: OnCall[];
  emit: (channel: string, payload: unknown) => void;
} {
  const invokes: { channel: string; args: unknown[] }[] = [];
  const ons: OnCall[] = [];
  const offs: OnCall[] = [];
  const ipc: IpcLike = {
    invoke: (channel, ...args) => {
      invokes.push({ channel, args });
      return Promise.resolve({ channel, args });
    },
    on: (channel, listener) => {
      ons.push({ channel, listener });
    },
    off: (channel, listener) => {
      offs.push({ channel, listener });
    },
  };
  const emit = (channel: string, payload: unknown): void => {
    for (const { channel: c, listener } of ons) {
      if (c === channel) listener({}, payload);
    }
  };
  return { ipc, invokes, ons, offs, emit };
}

describe("createDashboardClient — invoke channel mapping", () => {
  it("maps each method to exactly one allow-listed channel with its args", async () => {
    const { ipc, invokes } = fakeIpc();
    const api = createDashboardClient(ipc);

    await api.license.get();
    await api.license.activate("KEY-123");
    await api.ai.gatewayState();
    await api.ai.listProviders();
    await api.ai.connectedAccounts();
    await api.ai.beginConnect("kiro");
    await api.ai.listModels();
    await api.ai.selectModel("kr/claude-sonnet-4.5");
    await api.ai.selectedModel();
    await api.projects.create({ raw: "topic" });
    await api.projects.list();
    await api.projects.open("p1");
    await api.projects.stage("p1");
    await api.projects.delete("p1");
    await api.projects.reveal("p1");
    await api.projects.save("p1");
    await api.projects.retry("p1");
    await api.projects.fixWithAi("p1");
    await api.script.get("p1");
    await api.script.applyEdits("p1", [{ sceneId: "scene-01", narration: "x" }]);
    await api.script.approve("p1");
    await api.script.setEnabled(true);
    await api.review.submitEdits("p1", { perScene: [], globalNotes: "" });
    await api.review.approveDraft("p1");
    await api.settings.get();
    await api.settings.update({ maxRepairAttempts: 5 });

    // Every invoked channel is on the allow-list.
    for (const { channel } of invokes) {
      expect(isInvokeChannel(channel)).toBe(true);
    }
    // Every allow-listed channel was exercised exactly once (full coverage).
    const used = invokes.map((i) => i.channel).sort();
    expect(used).toEqual([...INVOKE_CHANNELS].sort());
  });

  it("forwards arguments verbatim", async () => {
    const { ipc, invokes } = fakeIpc();
    const api = createDashboardClient(ipc);

    await api.license.activate("ABC");
    expect(invokes.find((i) => i.channel === "license:activate")?.args).toEqual(["ABC"]);

    await api.script.applyEdits("p9", [{ sceneId: "scene-02", headline: "H" }]);
    expect(invokes.find((i) => i.channel === "script:applyEdits")?.args).toEqual([
      "p9",
      [{ sceneId: "scene-02", headline: "H" }],
    ]);
  });
});

describe("createDashboardClient — event subscription", () => {
  it("subscribes onProgress/onScene/onStatus/onFriendlyError to their channels and unsubscribes with the same listener", () => {
    const { ipc, ons, offs } = fakeIpc();
    const api = createDashboardClient(ipc);

    const unsub = [
      api.events.onProgress(() => {}),
      api.events.onScene(() => {}),
      api.events.onStatus(() => {}),
      api.events.onFriendlyError(() => {}),
    ];

    expect(ons.map((o) => o.channel).sort()).toEqual([...EVENT_CHANNELS].sort());

    for (const u of unsub) u();

    // off was called once per subscription, each with the exact same listener
    // reference that on received (clean unsubscribe).
    expect(offs).toHaveLength(ons.length);
    for (const off of offs) {
      const match = ons.find((o) => o.channel === off.channel && o.listener === off.listener);
      expect(match).toBeDefined();
    }
  });

  it("delivers the event payload (without the IPC event arg) to the callback", () => {
    const { ipc, emit } = fakeIpc();
    const api = createDashboardClient(ipc);
    const seen: unknown[] = [];
    api.events.onProgress((e) => seen.push(e));

    emit("events:progress", { projectId: "p1", ratio: 0.5, phase: "draft" });
    expect(seen).toEqual([{ projectId: "p1", ratio: 0.5, phase: "draft" }]);
  });
});

describe("registerIpcRouter", () => {
  function fakeMain(): { ipcMain: IpcMainLike; handlers: Map<string, (event: unknown, ...args: unknown[]) => unknown> } {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const ipcMain: IpcMainLike = { handle: (channel, listener) => handlers.set(channel, listener) };
    return { ipcMain, handlers };
  }

  it("registers exactly the allow-listed invoke channels", () => {
    const { ipcMain, handlers } = fakeMain();
    registerIpcRouter(ipcMain, {});
    expect([...handlers.keys()].sort()).toEqual([...INVOKE_CHANNELS].sort());
  });

  it("dispatches to the registered handler with forwarded args", () => {
    const { ipcMain, handlers } = fakeMain();
    const spy = vi.fn((..._args: unknown[]) => "ok");
    registerIpcRouter(ipcMain, { "license:get": spy });
    const result = handlers.get("license:get")!({}, "a", 1);
    expect(spy).toHaveBeenCalledWith("a", 1);
    expect(result).toBe("ok");
  });

  it("throws for an allow-listed channel with no handler", () => {
    const { ipcMain, handlers } = fakeMain();
    registerIpcRouter(ipcMain, {});
    expect(() => handlers.get("settings:get")!({})).toThrow(/No handler registered/);
  });
});
