import { execSync, spawn } from "node:child_process";
import { createServer } from "node:net";
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
const PREFERRED_PORT = 5174;
const NINEROUTER_URL = "http://localhost:20128/v1/models";

const run = (cmd, args, opts = {}) =>
  new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: "inherit", ...opts });
    p.on("exit", (code) => (code === 0 ? res() : rej(new Error(`${cmd} exited ${code}`))));
    p.on("error", rej);
  });

/** Try free preferred port; on Windows kill LISTENING owner of that port, else pick next free. */
function portFree(port) {
  return new Promise((resolvePort) => {
    const s = createServer();
    s.once("error", () => resolvePort(false));
    s.listen(port, "127.0.0.1", () => {
      s.close(() => resolvePort(true));
    });
  });
}

function freePortWindows(port) {
  try {
    const out = execSync(`netstat -ano`, { encoding: "utf8" });
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      if (!line.includes(`:${port}`) || !line.includes("LISTENING")) continue;
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && /^\d+$/.test(pid) && pid !== "0") pids.add(pid);
    }
    for (const pid of pids) {
      try {
        execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
        console.log(`[launch] freed port ${port} (killed pid ${pid})`);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

async function resolveDevPort() {
  if (await portFree(PREFERRED_PORT)) return PREFERRED_PORT;
  if (process.platform === "win32") {
    freePortWindows(PREFERRED_PORT);
    await new Promise((r) => setTimeout(r, 400));
    if (await portFree(PREFERRED_PORT)) return PREFERRED_PORT;
  }
  for (let p = PREFERRED_PORT + 1; p < PREFERRED_PORT + 20; p += 1) {
    if (await portFree(p)) {
      console.warn(`[launch] port ${PREFERRED_PORT} busy — using ${p}`);
      return p;
    }
  }
  throw new Error(`No free port near ${PREFERRED_PORT}`);
}

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

/** Kill leftover Electron processes so rcedit can rewrite electron.exe. */
function killStrayElectron() {
  if (process.platform !== "win32") return;
  try {
    execSync("taskkill /IM electron.exe /F", { stdio: "ignore" });
    console.log("[launch] stopped leftover electron.exe");
  } catch {
    /* none running */
  }
}

/**
 * Windows: stamp brand .ico into this workspace's electron.exe.
 * Taskbar uses the EXE icon for unpackaged `electron .` — setIcon alone is not enough.
 * Must run while no electron.exe is running (rcedit: "Unable to commit changes").
 */
async function ensureElectronBrandIcon(electronExe, icoPath) {
  if (process.platform !== "win32") return;
  try {
    const { existsSync } = await import("node:fs");
    if (!existsSync(electronExe) || !existsSync(icoPath)) {
      console.warn("[launch] skip electron icon stamp: missing exe or ico");
      return;
    }
    killStrayElectron();
    await new Promise((r) => setTimeout(r, 500));
    console.log("[launch] stamping brand icon onto electron.exe (Windows taskbar)…");
    const { rcedit } = await import("rcedit");
    await rcedit(electronExe, { icon: icoPath });
    console.log("[launch] electron.exe icon stamped OK.");
  } catch (e) {
    console.warn(
      `[launch] could not stamp electron.exe icon: ${e instanceof Error ? e.message : e}`,
    );
  }
}

async function main() {
  // Bring the model gateway up first so the app finds it ready on launch.
  await ensureNineRouter();

  // Stamp BEFORE vite/electron so electron.exe is not locked.
  const brandIco = resolve(appDir, "assets/brand/taskbar-logo.ico");
  const brandPng = resolve(appDir, "assets/brand/logo.png");
  await ensureElectronBrandIcon(String(electronPath), brandIco);

  console.log("[launch] bundling main + preload…");
  await run(process.execPath, [resolve(appDir, "build-electron.mjs")], { cwd: appDir });

  const port = await resolveDevPort();
  const devUrl = `http://localhost:${port}`;
  console.log(`[launch] starting Vite dev server on ${devUrl}…`);
  const vite = spawn("npx", ["vite", "--port", String(port), "--strictPort"], {
    cwd: appDir,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  const up = await waitFor(devUrl);
  if (!up) {
    console.error("[launch] Vite dev server did not start.");
    vite.kill();
    process.exit(1);
  }

  console.log("[launch] launching Electron…");
  const electron = spawn(electronPath, ["."], {
    cwd: appDir,
    stdio: "inherit",
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: devUrl,
      VIDEO_TOOL_HOME,
      MOTIONREAL_BRAND_ICON: brandIco,
      MOTIONREAL_BRAND_ICON_PNG: brandPng,
    },
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
