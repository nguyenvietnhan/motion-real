import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
// dirname used for MotionReal.exe next to stock electron.exe
import electronPath from "electron";
import { DEV_SERVER_HOST, devServerUrl, findFreePort } from "./launch-utils.mjs";

/**
 * Dev launcher:
 *   1. prepare branded MotionReal.exe (Windows taskbar/title identity)
 *   2. ensure 9router
 *   3. bundle main + preload
 *   4. Vite on free port
 *   5. launch MotionReal.exe (Windows) or electron (other OS)
 */
const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "..");
const repoRoot = resolve(appDir, "..", "..");
const VIDEO_TOOL_HOME = resolve(repoRoot, ".video-tool");
const VIENEU_WORKER = resolve(repoRoot, "packages", "tts", "runtime", "vieneu_worker.py");
const siblingVieneuPython = resolve(repoRoot, "..", "motion-china", ".venv", "Scripts", "python.exe");
const PREFERRED_PORT = 5174;
const NINEROUTER_URL = "http://localhost:20128/v1/models";
// Resolved after prepare — lives next to electron resources, NOT dist-electron alone.

const run = (cmd, args, opts = {}) =>
  new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: "inherit", ...opts });
    p.on("exit", (code) => (code === 0 ? res() : rej(new Error(`${cmd} exited ${code}`))));
    p.on("error", rej);
  });

async function resolveDevPort() {
  const port = await findFreePort(PREFERRED_PORT);
  if (port !== PREFERRED_PORT) console.warn(`[launch] port ${PREFERRED_PORT} busy — using ${port}`);
  return port;
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

async function ensureNineRouter() {
  if (await isUp(NINEROUTER_URL)) {
    console.log("[launch] 9router already running — reusing it.");
    return null;
  }
  console.log("[launch] starting 9router (9router -n -t --skip-update)…");
  try {
    const child = spawn("9router", ["-n", "-t", "--skip-update"], {
      cwd: appDir,
      detached: true,
      stdio: "ignore",
      shell: process.platform === "win32",
    });
    child.on("error", (e) => {
      console.warn(`[launch] could not start 9router: ${e.message}`);
    });
    child.unref();
  } catch (e) {
    console.warn(`[launch] could not start 9router: ${e instanceof Error ? e.message : e}`);
    return null;
  }
  const up = await waitFor(NINEROUTER_URL, 30_000);
  if (up) console.log("[launch] 9router is reachable on :20128.");
  else console.warn("[launch] 9router not reachable yet; app will keep retrying.");
  return null;
}

/** Windows: branded host next to Electron resources (avoids ICU crash). */
async function resolveHostExe() {
  if (process.platform !== "win32") return String(electronPath);
  await run(process.execPath, [resolve(here, "prepare-branded-electron.mjs")], { cwd: appDir });
  const brandedExe = resolve(dirname(String(electronPath)), "MotionReal.exe");
  if (!existsSync(brandedExe)) {
    throw new Error(`MotionReal.exe missing after prepare: ${brandedExe}`);
  }
  return brandedExe;
}

async function main() {
  const hostExe = await resolveHostExe();

  await ensureNineRouter();

  console.log("[launch] bundling main + preload…");
  await run(process.execPath, [resolve(appDir, "build-electron.mjs")], { cwd: appDir });

  const port = await resolveDevPort();
  const devUrl = devServerUrl(port);
  console.log(`[launch] starting Vite on ${devUrl}…`);
  const vite = spawn("npx", ["vite", "--host", DEV_SERVER_HOST, "--port", String(port), "--strictPort"], {
    cwd: appDir,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (!(await waitFor(devUrl))) {
    console.error("[launch] Vite did not start.");
    vite.kill();
    process.exit(1);
  }

  console.log("[launch] starting app…");
  const electron = spawn(hostExe, [appDir], {
    cwd: appDir,
    stdio: "inherit",
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: devUrl,
      VIDEO_TOOL_HOME,
      // The embedded Electron Node runtime is not a compatible host for the
      // linked DeepSeek Harness source checkout. Pass the exact Node binary
      // that launched this development app instead of guessing from PATH.
      MOTIONREAL_NODE_BIN: process.execPath,
      MOTIONREAL_VIENEU_WORKER: process.env.MOTIONREAL_VIENEU_WORKER || VIENEU_WORKER,
      MOTIONREAL_VIENEU_PYTHON:
        process.env.MOTIONREAL_VIENEU_PYTHON || (existsSync(siblingVieneuPython) ? siblingVieneuPython : "python.exe"),
      MOTIONREAL_VIENEU_CACHE:
        process.env.MOTIONREAL_VIENEU_CACHE || resolve(VIDEO_TOOL_HOME, "vieneu", "huggingface"),
    },
  });

  let interrupted = false;
  const shutdown = () => {
    interrupted = true;
    vite.kill();
    electron.kill();
  };
  electron.on("exit", (code, signal) => {
    vite.kill();
    process.exitCode = interrupted ? 0 : code ?? (signal ? 1 : 0);
  });
  electron.on("error", (error) => {
    console.error("[launch] app failed to start:", error);
    vite.kill();
    process.exitCode = 1;
  });
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error("[launch] failed:", e);
  process.exit(1);
});
