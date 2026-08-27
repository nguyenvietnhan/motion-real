import { execSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
// dirname used for MotionReal.exe next to stock electron.exe
import electronPath from "electron";

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
  const devUrl = `http://localhost:${port}`;
  console.log(`[launch] starting Vite on ${devUrl}…`);
  const vite = spawn("npx", ["vite", "--port", String(port), "--strictPort"], {
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
