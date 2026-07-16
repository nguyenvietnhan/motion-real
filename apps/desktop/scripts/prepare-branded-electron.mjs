/**
 * Build a branded Windows host exe: copy electron.exe → MotionReal.exe and
 * stamp the brand .ico. Taskbar uses the *running executable* name+icon —
 * launching as electron.exe keeps the Atom identity no matter what setIcon does.
 *
 * Usage: node apps/desktop/scripts/prepare-branded-electron.mjs
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "..");
const outDir = resolve(appDir, "dist-electron");
const outExe = resolve(outDir, "MotionReal.exe");
const ico = resolve(appDir, "assets/brand/taskbar-logo.ico");
const png = resolve(appDir, "assets/brand/taskbar-logo.png");

function killElectronFamily() {
  if (process.platform !== "win32") return;
  for (const name of ["electron.exe", "MotionReal.exe"]) {
    try {
      execSync(`taskkill /IM ${name} /F`, { stdio: "ignore" });
    } catch {
      /* not running */
    }
  }
  // Release PE file locks
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
}

async function main() {
  if (process.platform !== "win32") {
    console.log("[prepare-branded-electron] skip (not Windows) — use stock electron");
    process.exit(0);
  }

  const require = createRequire(import.meta.url);
  const electronExe = require("electron");
  if (!existsSync(electronExe)) {
    console.error("[prepare-branded-electron] electron.exe missing:", electronExe);
    process.exit(1);
  }
  const iconPath = existsSync(ico) ? ico : png;
  if (!existsSync(iconPath)) {
    console.error("[prepare-branded-electron] brand icon missing under assets/brand/");
    process.exit(1);
  }

  killElectronFamily();
  mkdirSync(outDir, { recursive: true });

  // Refresh copy when electron package is newer than our branded host.
  let needCopy = !existsSync(outExe);
  if (!needCopy) {
    try {
      needCopy = statSync(electronExe).mtimeMs > statSync(outExe).mtimeMs;
    } catch {
      needCopy = true;
    }
  }
  if (needCopy) {
    console.log("[prepare-branded-electron] copying electron.exe → MotionReal.exe…");
    copyFileSync(electronExe, outExe);
  } else {
    console.log("[prepare-branded-electron] MotionReal.exe up to date vs electron package");
  }

  console.log("[prepare-branded-electron] stamping brand icon…");
  console.log("  exe ", outExe);
  console.log("  icon", iconPath);
  const { rcedit } = await import("rcedit");
  await rcedit(outExe, {
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
  console.log("[prepare-branded-electron] OK — launch will use MotionReal.exe (not electron.exe)");
}

main().catch((e) => {
  console.error("[prepare-branded-electron] FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
