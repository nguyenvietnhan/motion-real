// Drive headless Chromium (CDP) — single page, navigate between audit screens.
// Dumps computed backdrop-filter of the glass surfaces + captures a PNG each,
// so we can confirm the frosted effect actually renders (not just CSS is served).
import { spawn } from "node:child_process";
import { WebSocket } from "undici";
import { mkdirSync, createWriteStream } from "node:fs";

const CHROME = "C:/Users/nhann/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe";
const OUT = "V:/video_tool/news_remotion_tool/.tmp/audit-shots";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  "--headless=new", "--no-sandbox", "--no-first-run",
  "--hide-scrollbars", "--window-size=1440,900",
  "--remote-debugging-port=9222", "--remote-allow-origins=*",
  "about:blank",
], { stdio: ["ignore", "inherit", "inherit"] });

const cdp = (() => {
  let _id = 0;
  let _sock;
  const pending = new Map();
  const init = (sock) => {
    _sock = sock;
    _sock.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    });
  };
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++_id;
    pending.set(id, resolve);
    _sock.send(JSON.stringify({ id, method, params }));
  });
  return { init, send };
})();

try {
  let v = null;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    try { const r = await fetch("http://127.0.0.1:9222/json"); const tabs = await r.json();
      if (tabs.length) { v = tabs[0]; break; } } catch {}
  }
  if (!v) throw new Error("no tab");
  const ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((r, rj) => { ws.onopen = r; ws.onerror = rj; });
  cdp.init(ws);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  for (const screen of ["home", "settings", "published", "storyboard"]) {
    await cdp.send("Page.navigate", { url: `http://localhost:5173/ui-audit.html?screen=${screen}` });
    await sleep(1500);

    const expr = `(() => {
      const pick = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return sel + ": (missing)";
        const s = getComputedStyle(el);
        return sel + " | backdrop: " + (s.backdropFilter || s.webkitBackdropFilter || "none")
          + " | bg: " + s.backgroundColor;
      };
      return [pick(".ns-sidebar"), pick(".ns-card"), pick(".ns-create-card"),
              pick(".ns-story-header"), pick(".body")].join("\\n");
    })()`;
    const ev = await cdp.send("Runtime.evaluate", { expression: expr, returnByValue: true });
    console.log(`\n=== ${screen} ===`);
    console.log(ev.result?.result?.value ?? JSON.stringify(ev.result));

    const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
    if (shot.result?.data) {
      const buf = Buffer.from(shot.result.data, "base64");
      createWriteStream(`${OUT}/${screen}.png`).end(buf);
      console.log(`shot ${screen}.png (${buf.length} bytes)`);
    }
  }
  ws.close();
} finally {
  chrome.kill();
  console.log("\ndone");
}
