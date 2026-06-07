import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import electronPath from "electron";

/**
 * One-command dev launcher for the desktop app (web-dashboard):
 *   1. bundle main + preload (esbuild),
 *   2. start the Vite renderer dev server (fixed port),
 *   3. launch Electron pointed at the dev server,
 *   4. tear the dev server down when Electron exits.
 *
 * Run:  npm --prefix apps/desktop run app   (or: node apps/desktop/scripts/launch.mjs)
 */
const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "..");
const PORT = 5174;
const DEV_URL = `http://localhost:${PORT}`;

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

async function main() {
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
    env: { ...process.env, VITE_DEV_SERVER_URL: DEV_URL },
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
