/**
 * Stamp MotionReal brand icon onto this workspace's electron.exe (Windows).
 * Taskbar for unpackaged `electron .` uses the EXE resource icon.
 *
 * Usage: node apps/desktop/scripts/stamp-brand-icon.mjs
 * Safe to re-run. Fails if electron.exe is locked — kill Electron first.
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "..");
const ico = resolve(appDir, "assets/brand/taskbar-logo.ico");
const png = resolve(appDir, "assets/brand/taskbar-logo.png");
const logo = resolve(appDir, "assets/brand/logo.png");

function killElectron() {
  if (process.platform !== "win32") return;
  try {
    execSync("taskkill /IM electron.exe /F", { stdio: "ignore" });
    // Wait for file handles to release
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 800);
  } catch {
    /* none running */
  }
}

async function main() {
  if (process.platform !== "win32") {
    console.log("[stamp-brand-icon] skip (not Windows)");
    return;
  }

  const require = createRequire(import.meta.url);
  let electronExe;
  try {
    // Same resolution as `import electron from "electron"`
    electronExe = require("electron");
  } catch (e) {
    console.error("[stamp-brand-icon] cannot resolve electron package:", e);
    process.exit(1);
  }

  const iconPath = [ico, png, logo].find((p) => existsSync(p));
  if (!iconPath) {
    console.error("[stamp-brand-icon] no brand icon under assets/brand/");
    process.exit(1);
  }
  if (!existsSync(electronExe)) {
    console.error("[stamp-brand-icon] electron.exe missing:", electronExe);
    process.exit(1);
  }

  killElectron();

  const { rcedit } = await import("rcedit");
  console.log("[stamp-brand-icon] exe =", electronExe);
  console.log("[stamp-brand-icon] icon =", iconPath);
  await rcedit(electronExe, {
    icon: iconPath,
    "version-string": {
      ProductName: "Motion Real",
      FileDescription: "Motion Real",
      CompanyName: "Motion Real",
      InternalName: "MotionReal",
      OriginalFilename: "MotionReal.exe",
    },
    "product-version": "0.1.0",
    "file-version": "0.1.0",
  });
  console.log("[stamp-brand-icon] OK — electron.exe now carries brand icon + product name");

  try {
    execSync("ie4uinit.exe -show", { stdio: "ignore" });
  } catch {
    /* optional shell refresh */
  }
}

main().catch((e) => {
  console.error("[stamp-brand-icon] FAILED:", e instanceof Error ? e.message : e);
  console.error("Close all Electron windows and retry.");
  process.exit(1);
});
