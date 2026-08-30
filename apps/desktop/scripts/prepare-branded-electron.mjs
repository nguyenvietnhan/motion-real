/**
 * Windows branded host: copy electron.exe → MotionReal.exe in the same folder
 * as Electron resources (icudtl.dat, locales, *.pak). A lone exe copy under
 * dist-electron breaks Chromium (ICU data missing).
 */
import { copyFileSync, existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "..");
const ico = resolve(appDir, "assets/brand/taskbar-logo.ico");
const png = resolve(appDir, "assets/brand/taskbar-logo.png");

async function main() {
  if (process.platform !== "win32") process.exit(0);

  const require = createRequire(import.meta.url);
  const electronExe = require("electron");
  if (typeof electronExe !== "string" || !existsSync(electronExe)) {
    console.error("[prepare-branded-electron] electron.exe missing:", electronExe);
    process.exit(1);
  }

  const electronDir = dirname(electronExe);
  const outExe = resolve(electronDir, "MotionReal.exe");
  const iconPath = existsSync(ico) ? ico : png;
  if (!existsSync(iconPath)) {
    console.error("[prepare-branded-electron] brand icon missing under assets/brand/");
    process.exit(1);
  }

  let needCopy = !existsSync(outExe);
  if (!needCopy) {
    try {
      needCopy = statSync(electronExe).mtimeMs > statSync(outExe).mtimeMs;
    } catch {
      needCopy = true;
    }
  }
  if (needCopy) copyFileSync(electronExe, outExe);

  const { rcedit } = await import("rcedit");
  const brandMeta = {
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
  };
  await rcedit(outExe, brandMeta);

}

main().catch((e) => {
  console.error("[prepare-branded-electron] FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
