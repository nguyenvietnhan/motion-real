// One-off: screenshot each ui-audit screen to .tmp/audit-shots for visual review.
// Uses the playwright that was just installed in apps/desktop.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const out = "V:/video_tool/news_remotion_tool/.tmp/audit-shots";
mkdirSync(out, { recursive: true });

const screens = ["home", "projects", "settings", "published", "storyboard"];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
for (const s of screens) {
  await page.goto(`http://localhost:5173/ui-audit.html?screen=${s}`);
  // let fonts + the aurora pseudo-elements paint
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/${s}.png`, fullPage: false });
  console.log(`shot ${s}.png`);
}
await browser.close();
console.log("done");
