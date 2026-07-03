import { spawn } from "node:child_process";
import type { GatewayDeps } from "./model-gateway-manager.js";
import { NineRouterClient } from "./ninerouter-client.js";
import { createLogger } from "@motionreal/pipeline";
import { sanitizedChildEnvironment } from "../security/runtime-security.js";

const log = createLogger("gateway");

/**
 * Build the REAL `GatewayDeps` backed by a live 9router (web-dashboard concrete
 * Model_Gateway). `launch` reuses an already-running 9router if reachable, else
 * spawns it headless in tray/background mode and polls until reachable. Login is
 * DELEGATED to 9router's own Web UI (opened in the external browser) — the
 * dashboard never reimplements the provider sign-in screens.
 */

export type NineRouterDepsOptions = {
  client?: NineRouterClient;
  /** Open a URL in the user's external browser (Electron `shell.openExternal`). */
  openExternal: (url: string) => void | Promise<void>;
  /** Override the spawn for tests; defaults to launching the global `9router`. */
  spawnGateway?: () => void;
  /** Poll budget while waiting for the spawned gateway to become reachable. */
  readyTimeoutMs?: number;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function buildNineRouterGatewayDeps(opts: NineRouterDepsOptions): GatewayDeps {
  const client = opts.client ?? new NineRouterClient();
  const readyTimeoutMs = opts.readyTimeoutMs ?? 15_000;

  const spawnGateway =
    opts.spawnGateway ??
    (() => {
      // -n no browser, -t tray/background (no interactive menu), skip update check.
      const child = spawn("9router", ["-n", "-t", "--skip-update"], {
        detached: true,
        stdio: "ignore",
        shell: true, // resolve 9router.cmd on Windows
        env: sanitizedChildEnvironment(),
      });
      // A missing/un-PATHed 9router emits 'error' asynchronously; swallow it so it
      // never becomes an unhandled exception in the main process (launch() will
      // just time out and the gateway reports unavailable, then self-heals).
      child.on("error", (error) => log.warn({ err: error }, "could not spawn 9router; readiness poll will continue"));
      child.unref();
    });

  return {
    launch: async () => {
      if (await client.isReachable()) return true;
      try {
        spawnGateway();
      } catch (error) {
        log.warn({ err: error }, "9router spawn threw; reporting gateway unavailable");
        return false;
      }
      const deadline = Date.now() + readyTimeoutMs;
      while (Date.now() < deadline) {
        await sleep(750);
        if (await client.isReachable()) return true;
      }
      return false;
    },
    listProviders: () => client.listProviders(),
    beginConnect: async (_providerId) => {
      // Delegate the provider-specific login to 9router's own Web UI.
      await opts.openExternal(client.rootUrl);
      return { loginSurface: "external-browser" };
    },
    pollConnections: () => client.connectedAccounts(),
    listModels: () => client.listModels(),
    generateKey: undefined,
    wireKey: async () => {
      // Best-effort: mint an OpenAI-compatible key 9router will accept on /v1.
      await client.createApiKey("news-studio");
    },
  };
}
