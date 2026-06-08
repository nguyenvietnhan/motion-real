import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import electronPath from "electron";

/**
 * One-command dev launcher for the desktop app (web-dashboard):
 *   1. ensure the 9router model gateway is running (reuse if up, else spawn it),
 *   2. bundle main + preload (esbuild),
 *   3. start the Vite renderer dev server (fixed port),
 *   4. launch Electron pointed at the dev server,
 *   5. tear the dev server down when Electron exits.
 *
 * Run:  npm --prefix apps/desktop run app   (or: node apps/desktop/scripts/launch.mjs)
 */
const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "..");
const repoRoot = resolve(appDir, "..", "..");
// Share the SAME project store as the CLI/build-scripts (repo .video-tool),
// so existing projects show up and new ones land alongside them.
const VIDEO_TOOL_HOME = resolve(repoRoot, ".video-tool");
const PORT = 5174;
const DEV_URL = `http://localhost:${PORT}`;
const NINEROUTER_URL = "http://localhost:20128/v1/models";

const run = (cmd, args, opts = {}) =>
  new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: "inherit", ...opts });
    p.on("exit", (code) => (code === 0 ? res() : rej(new Error(`${cmd} exited ${code}`))));
    p.on("error", rej);
  });

async function waitFor(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function isUp(url) {
  try {
    const r = await fetch(url);
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Ensure the 9router model gateway is running. Reuse an already-running instance
 * (don't disturb the user's own), otherwise spawn it headless in tray/background
 * mode (`9router -n -t --skip-update`) and wait until it answers on /v1. 9router
 * is a tray service, so we leave it running after the launcher exits (faster
 * next start, matching the in-app detached spawn). Returns the spawned child (or
 * null when reused / unavailable) so the caller can decide on teardown.
 */
async function ensureNineRouter() {
  if (await isUp(NINEROUTER_URL)) {
    console.log("[launch] 9router already running — reusing it.");
    return null;
  }
  console.log("[launch] starting 9router (9router -n -t --skip-update)…");
  let child = null;
  try {
    child = spawn("9router", ["-n", "-t", "--skip-update"], {
      cwd: appDir,
      detached: true,
      stdio: "ignore",
      shell: process.platform === "win32", // resolve 9router.cmd on Windows
    });
    child.on("error", (e) => {
      console.warn(`[launch] could not start 9router (is it installed / on PATH?): ${e.message}`);
    });
    child.unref();
  } catch (e) {
    console.warn(`[launch] could not start 9router: ${e instanceof Error ? e.message : e}`);
    return null;
  }
  const up = await waitFor(NINEROUTER_URL, 30_000);
  if (up) console.log("[launch] 9router is reachable on :20128.");
  else console.warn("[launch] 9router not reachable yet; the app will keep retrying. Install it or run `9router -n -t` manually if AI stays unavailable.");
  return child;
}

async function main() {
  // Bring the model gateway up first so the app finds it ready on launch.
  await ensureNineRouter();

  console.log("[launch] bundling main + preload…");
  await run(process.execPath, [resolve(appDir, "build-electron.mjs")], { cwd: appDir });

  console.log(`[launch] starting Vite dev server on ${DEV_URL}…`);
  const vite = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
    cwd: appDir,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  const up = await waitFor(DEV_URL);
  if (!up) {
    console.error("[launch] Vite dev server did not start.");
    vite.kill();
    process.exit(1);
  }

  console.log("[launch] launching Electron…");
  const electron = spawn(electronPath, ["."], {
    cwd: appDir,
    stdio: "inherit",
    env: { ...process.env, VITE_DEV_SERVER_URL: DEV_URL, VIDEO_TOOL_HOME },
  });

  const shutdown = () => {
    vite.kill();
    electron.kill();
  };
  electron.on("exit", () => {
    vite.kill();
    process.exit(0);
  });
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error("[launch] failed:", e);
  process.exit(1);
});
