/**
 * Windows branded host: copy electron.exe → MotionReal.exe *in the same folder*
 * as Electron's resources (icudtl.dat, locales, *.pak). Copying only the exe to
 * dist-electron/ makes Chromium die with:
 *   Invalid file descriptor to ICU data received
 *
 * Usage: node apps/desktop/scripts/prepare-branded-electron.mjs
 */
import { copyFileSync, existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "..");
const ico = resolve(appDir, "assets/brand/taskbar-logo.ico");
const png = resolve(appDir, "assets/brand/taskbar-logo.png");

function killBrandedHosts() {
  if (process.platform !== "win32") return;
  for (const name of ["MotionReal.exe", "electron.exe"]) {
    try {
      execSync(`taskkill /IM ${name} /F`, { stdio: "ignore" });
    } catch {
      /* not running */
    }
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
}

async function main() {
  if (process.platform !== "win32") {
    console.log("[prepare-branded-electron] skip (not Windows)");
    process.exit(0);
  }

  const require = createRequire(import.meta.url);
  const electronExe = require("electron");
  if (typeof electronExe !== "string" || !existsSync(electronExe)) {
    console.error("[prepare-branded-electron] electron.exe missing:", electronExe);
    process.exit(1);
  }

  // MUST live next to icudtl.dat / resources — same dir as stock electron.exe
  const electronDir = dirname(electronExe);
  const outExe = resolve(electronDir, "MotionReal.exe");
  const iconPath = existsSync(ico) ? ico : png;
  if (!existsSync(iconPath)) {
    console.error("[prepare-branded-electron] brand icon missing under assets/brand/");
    process.exit(1);
  }

  killBrandedHosts();

  let needCopy = !existsSync(outExe);
  if (!needCopy) {
    try {
      needCopy = statSync(electronExe).mtimeMs > statSync(outExe).mtimeMs;
    } catch {
      needCopy = true;
    }
  }
  if (needCopy) {
    console.log("[prepare-branded-electron] copying electron.exe → MotionReal.exe (same dist folder)…");
    copyFileSync(electronExe, outExe);
  } else {
    console.log("[prepare-branded-electron] MotionReal.exe present next to electron resources");
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

  console.log("  stamping stock electron.exe…");
  try {
    await rcedit(electronExe, {
      icon: iconPath,
      "version-string": {
        ProductName: "Motion Real",
        FileDescription: "Motion Real",
        CompanyName: "Motion Real",
        InternalName: "electron",
        OriginalFilename: "electron.exe",
      },
      "product-version": "0.1.0",
      "file-version": "0.1.0",
    });
  } catch (err) {
    console.warn("[prepare-branded-electron] failed to stamp stock electron.exe (non-fatal):", (err && err.message) || err);
  }

  // Official Electron Forge guidance: Windows caches icons; refresh after change.
  // https://www.electronforge.io/guides/create-and-add-icons
  try {
    execSync("ie4uinit.exe -show", { stdio: "ignore" });
    console.log("[prepare-branded-electron] ie4uinit -show (icon cache nudge)");
  } catch {
    /* optional */
  }

  console.log("[prepare-branded-electron] OK");
  console.log(outExe);
  console.log(
    "[prepare-branded-electron] If taskbar still shows Atom: unpin the app, run scripts/clear-windows-icon-cache.ps1 as Admin, relaunch.",
  );
}

main().catch((e) => {
  console.error("[prepare-branded-electron] FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
