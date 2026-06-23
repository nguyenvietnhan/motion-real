import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { admitHyperframesScene } from "./hyperframes.js";

let root: string;
let scenePath: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "news-hf-admission-"));
  await mkdir(join(root, "hyperframes", "scenes"), { recursive: true });
  await mkdir(join(root, "hyperframes", "vendor"), { recursive: true });
  scenePath = join(root, "hyperframes", "scenes", "scene-01.html");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function cleanHtml(script = ""): string {
  return `<!doctype html>
<html>
  <head><script src="../vendor/gsap.min.js"></script></head>
  <body>
    <div data-composition-id="scene-01" data-start="0" data-duration="1" data-width="1920" data-height="1080">
      <style>.box { color: #fff; }</style>
      <div class="box">Hello</div>
      <script>
        window.__timelines = window.__timelines || {};
        const tl = gsap.timeline({ paused: true });
        tl.from(".box", { opacity: 0, y: 20, duration: 0.4, ease: "power2.out" }, 0.1);
        ${script}
        window.__timelines["scene-01"] = tl;
      </script>
    </div>
  </body>
</html>`;
}

async function admit(html: string, imageRef?: string) {
  await writeFile(scenePath, html, "utf8");
  return admitHyperframesScene(scenePath, {
    projectRoot: root,
    sceneId: "scene-01",
    width: 1920,
    height: 1080,
    imageRef,
  });
}

describe("admitHyperframesScene", () => {
  it("accepts a clean deterministic scene", async () => {
    const result = await admit(cleanHtml());
    expect(result).toEqual({ admitted: true, sceneId: "scene-01", compositionId: "scene-01", htmlPath: scenePath });
  });

  it("rewrites known GSAP CDN scripts to the local vendor path", async () => {
    const html = cleanHtml().replace(
      "../vendor/gsap.min.js",
      "https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js",
    );
    const result = await admit(html);
    expect(result.admitted).toBe(true);
    await expect(readFile(scenePath, "utf8")).resolves.toContain('src="../vendor/gsap.min.js"');
  });

  it.each([
    ["external image", cleanHtml().replace("<div class=\"box\">Hello</div>", '<img src="https://example.com/x.png">')],
    ["external script", cleanHtml().replace("../vendor/gsap.min.js", "https://example.com/x.js")],
    ["missing timeline registration", cleanHtml().replace('window.__timelines["scene-01"] = tl;', "")],
    ["async timeline construction", cleanHtml("async function later() { return 1; }")],
    ["Math.random", cleanHtml("const x = Math.random();")],
    ["raw audio", cleanHtml().replace("<div class=\"box\">Hello</div>", '<audio src="x.mp3"></audio>')],
    ["repeat -1", cleanHtml('tl.to(".box", { opacity: 1, repeat: -1, duration: 1 }, 0);')],
  ])("rejects %s", async (_name, html) => {
    const result = await admit(html);
    expect(result.admitted).toBe(false);
  });

  it("allows exactly one approved local image ref", async () => {
    const html = cleanHtml().replace("<div class=\"box\">Hello</div>", '<img src="assets/ok.png" alt="">');
    const result = await admit(html, "assets/ok.png");
    expect(result.admitted).toBe(true);
  });

  it("rejects an invalid image ref", async () => {
    const html = cleanHtml().replace("<div class=\"box\">Hello</div>", '<img src="assets/wrong.png" alt="">');
    const result = await admit(html, "assets/ok.png");
    expect(result.admitted).toBe(false);
  });
});

