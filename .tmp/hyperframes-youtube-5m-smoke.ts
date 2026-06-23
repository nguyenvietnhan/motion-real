import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  appendEvent,
  ensureProject,
  projectPaths,
  renderProject,
  writeBrief,
  writeHyperframesScene,
  writeJson,
  type ProjectBrief,
} from "../packages/pipeline/src/index.js";

const require = createRequire(import.meta.url);

function loadDotEnv(path = ".env"): void {
  if (!existsSync(path)) return;
  const text = require("node:fs").readFileSync(path, "utf8") as string;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

const palette = {
  ivory: "#F6F1E7",
  ink: "#17202A",
  teal: "#1E9CB0",
  coral: "#C64F3C",
  moss: "#647A4F",
  gold: "#D7A95B",
};

const sceneTitles = [
  "Khi AI được thả tự do",
  "Từ prompt đến kịch bản",
  "Tại sao phải chia scene",
  "Manifest là hợp đồng",
  "HTML là lớp biểu diễn",
  "TTS khóa thời gian thật",
  "Render từng chunk",
  "FFmpeg nối nhịp",
  "Review không bỏ qua",
  "Kết luận cho pipeline",
];

const sceneCount = 16;

const narrations = [
  "Đây là bản thử nghiệm năm phút cho chế độ YouTube dùng HyperFrames. Mục tiêu không phải khoe một template có sẵn, mà kiểm tra xem hệ thống có để AI tự do dựng hình bằng HTML, CSS và GSAP hay không. Khi đi theo hướng này, manifest vẫn giữ vai trò hợp đồng nội dung, còn từng scene là phần trình diễn độc lập. Cách tách này giúp video dài không dồn toàn bộ DOM vào một phiên trình duyệt.",
  "Trong một quy trình thật, AI sẽ đọc brief, viết outline, rồi phát triển từng đoạn thành scene. Ở bài kiểm thử này, phần gọi model được giả lập bằng dữ liệu cục bộ vì API authoring đang lỗi. Tuy vậy, các bước quan trọng vẫn giữ nguyên: manifest tiếng Việt, scene HTML riêng, admission gate, Vivibe TTS, khóa timing theo audio đo thật, render chunk, nối video, rồi tạo review stills.",
  "Lý do phải chia scene rất thực tế. Một video năm phút có thể chứa hàng trăm node, ảnh, hiệu ứng, caption và các đoạn motion dài. Nếu dồn tất cả vào một file HTML duy nhất, trình duyệt sẽ giữ quá nhiều trạng thái cùng lúc. Khi render theo chunk, mỗi scene chỉ tồn tại trong vùng nhớ của nó, render xong là chuyển sang scene khác. Đây là cách kiểm soát rủi ro OOM.",
  "Manifest không biến mất khi chuyển sang HyperFrames. Nó vẫn là nguồn sự thật cho tiêu đề, ngôn ngữ, format, duration tier, thứ tự scene, headline và narration. HTML không được trở thành manifest thứ hai. Điều này rất quan trọng, vì mọi lớp phía sau như TTS, lock timing, review, thumbnail và cache đều cần một hợp đồng thống nhất để kiểm tra và tái lập kết quả.",
  "HTML trong HyperFrames đóng vai trò giống sân khấu của từng scene. AI có thể vẽ khối kính, bảng dữ liệu, chữ lớn, đường kẻ, nhịp màu và motion bespoke mà không phải đi qua vòng đời React. Gate chỉ kiểm tra những thứ nguy hiểm: URL ngoài, script lạ, API bất định, async timeline, media thô, ảnh không được duyệt và timeline không đăng ký. Phần sáng tạo vẫn rộng.",
  "Vivibe TTS là chốt khóa thời gian cho video tiếng Việt. Thay vì đoán mỗi cảnh dài bao lâu, hệ thống tổng hợp giọng nói, đo audio thật, rồi lock số frame cho từng scene. Nhờ vậy caption và nhịp chuyển cảnh bám theo âm thanh, không bám theo ước lượng. Với video dài, bước này quan trọng hơn cảm giác ban đầu, vì chỉ cần lệch vài giây mỗi scene là cuối video sẽ trôi rõ rệt.",
  "Render từng chunk giúp biến video dài thành nhiều việc nhỏ. Mỗi scene có một project HyperFrames độc lập dưới thư mục chunks, có vendor GSAP cục bộ và thời lượng đã lock. Producer dùng Chrome để chụp frame, rồi FFmpeg mã hóa MP4 im lặng. Nếu một scene lỗi, ta có thể khoanh vùng chính xác scene đó thay vì phải nghi ngờ toàn bộ composition dài năm phút.",
  "Sau khi các chunk hoàn tất, FFmpeg nối chúng bằng xfade. Điểm quan trọng là chunk trước được pad thêm đúng thời lượng transition, để phần overlap không làm video cuối ngắn hơn lock. Nhờ vậy tổng thời lượng sau khi assemble vẫn khớp locked duration trong sai số một frame. Audio narration toàn cục được mux sau cùng, tránh cắt tiếng ở biên cảnh.",
  "Review vẫn phải tồn tại, kể cả khi render thành công. Hệ thống trích still giữa cảnh, still cuối cảnh, chạy oracle cho safe area, màu, duration, caption và các lỗi layout thô. Trong smoke test này checklist được đánh dấu pass để kiểm tra đường kỹ thuật, nhưng khi làm video thật, draft đầu tiên vẫn cần nhìn bằng mắt người hoặc vòng vision repair trước khi full render.",
  "Kết luận của bài test này rất rõ: HyperFrames không thay đổi mục tiêu AI tự do, mà đổi vật liệu biểu diễn để giảm token, giảm lỗi cú pháp và giảm rủi ro bộ nhớ cho long form. Remotion vẫn là fallback cho TikTok, còn YouTube dài nên đi theo scene chunking. Nếu bài render năm phút này chạy ổn, bước kế tiếp là tối ưu chất lượng hình và repair loop cho HTML scene.",
];

function sceneHtml(sceneId: string, index: number, headline: string): string {
  const accents = [palette.teal, palette.coral, palette.moss, palette.gold];
  const accent = accents[index % accents.length]!;
  const side = index % 2 === 0 ? "left" : "right";
  const align = side === "left" ? "flex-start" : "flex-end";
  const textAlign = side === "left" ? "left" : "right";
  const label = String(index + 1).padStart(2, "0");
  return `<!doctype html>
<html>
  <head><script src="../vendor/gsap.min.js"></script></head>
  <body>
    <div data-composition-id="${sceneId}" data-start="0" data-duration="1" data-width="1920" data-height="1080">
      <style>
        [data-composition-id="${sceneId}"] {
          width: 1920px;
          height: 1080px;
          overflow: hidden;
          position: relative;
          box-sizing: border-box;
          background: ${palette.ivory};
          color: ${palette.ink};
          font-family: "Fraunces", Georgia, serif;
        }
        .grain {
          position: absolute;
          inset: 0;
          opacity: 0.35;
          background:
            radial-gradient(circle at 20% 20%, ${accent}33 0, ${accent}00 360px),
            radial-gradient(circle at 82% 72%, #17202A18 0, #17202A00 420px),
            linear-gradient(115deg, #ffffff66, #00000008);
        }
        .rail {
          position: absolute;
          ${side}: 92px;
          top: 88px;
          bottom: 88px;
          width: 10px;
          background: ${accent};
          transform-origin: top;
        }
        .number {
          position: absolute;
          ${side}: 132px;
          top: 82px;
          font-family: "IBM Plex Mono", "Courier New", monospace;
          font-size: 34px;
          font-weight: 700;
          color: ${accent};
          font-variant-numeric: tabular-nums;
        }
        .ghost {
          position: absolute;
          ${side}: 90px;
          bottom: -72px;
          font-family: "Arial Black", Arial, sans-serif;
          font-size: 320px;
          line-height: 0.8;
          font-weight: 900;
          color: ${accent};
          opacity: 0.11;
          letter-spacing: 0;
        }
        .content {
          position: relative;
          z-index: 2;
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          padding: 170px 180px 150px;
          display: flex;
          flex-direction: column;
          align-items: ${align};
          justify-content: center;
          gap: 34px;
          text-align: ${textAlign};
        }
        .eyebrow {
          font-family: "IBM Plex Mono", "Courier New", monospace;
          font-size: 24px;
          font-weight: 700;
          color: ${accent};
          letter-spacing: 0;
          text-transform: uppercase;
        }
        .headline {
          max-width: 1180px;
          font-size: 104px;
          line-height: 0.98;
          font-weight: 900;
          letter-spacing: 0;
        }
        .body {
          max-width: 980px;
          font-family: "Trebuchet MS", Arial, sans-serif;
          font-size: 34px;
          line-height: 1.36;
          font-weight: 400;
          color: #33404A;
        }
        .chips {
          display: flex;
          gap: 18px;
          justify-content: ${align};
          flex-wrap: wrap;
          max-width: 980px;
        }
        .chip {
          border: 2px solid #17202A22;
          background: #ffffff9a;
          padding: 15px 24px;
          border-radius: 8px;
          font-family: "IBM Plex Mono", "Courier New", monospace;
          font-size: 20px;
          color: #17202A;
        }
      </style>
      <div class="grain" data-layout-ignore></div>
      <div class="rail"></div>
      <div class="number">${label}</div>
      <div class="ghost">${label}</div>
      <section class="content">
        <div class="eyebrow">HyperFrames long-form smoke</div>
        <div class="headline">${headline}</div>
        <div class="body">${bodyLine(index)}</div>
        <div class="chips">
          <span class="chip">youtube 16:9</span>
          <span class="chip">vivibe vi</span>
          <span class="chip">scene chunk</span>
        </div>
      </section>
      <script>
        window.__timelines = window.__timelines || {};
        const tl = gsap.timeline({ paused: true });
        tl.from(".rail", { scaleY: 0, duration: 0.65, ease: "expo.out" }, 0.18);
        tl.from(".number", { x: ${side === "left" ? -70 : 70}, opacity: 0, duration: 0.42, ease: "power3.out" }, 0.26);
        tl.from(".eyebrow", { y: 34, opacity: 0, duration: 0.5, ease: "back.out(1.4)" }, 0.34);
        tl.from(".headline", { y: 56, opacity: 0, duration: 0.72, ease: "power4.out" }, 0.48);
        tl.from(".body", { x: ${side === "left" ? -44 : 44}, opacity: 0, duration: 0.58, ease: "sine.out" }, 0.72);
        tl.from(".chip", { y: 26, opacity: 0, duration: 0.38, stagger: 0.09, ease: "power2.out" }, 0.92);
        tl.to(".grain", { scale: 1.04, duration: 24, ease: "sine.inOut" }, 1.0);
        tl.to(".ghost", { y: -18, opacity: 0.15, duration: 24, ease: "sine.inOut" }, 1.0);
        window.__timelines["${sceneId}"] = tl;
      </script>
    </div>
  </body>
</html>`;
}

function bodyLine(index: number): string {
  const lines = [
    "Mục tiêu là kiểm chứng đường ống thật, không phụ thuộc vào template hay catalog.",
    "Authoring API được giả lập, nhưng renderer, TTS, lock và review vẫn chạy thật.",
    "Mỗi scene là một vùng nhớ riêng để video dài không ép Chrome giữ toàn bộ DOM.",
    "Manifest giữ nội dung, HTML giữ biểu diễn, hai lớp không giẫm lên nhau.",
    "Gate chặn rủi ro nhưng vẫn để AI tự do dựng hình bằng CSS và GSAP.",
    "Audio thật quyết định frame thật, không dùng ước lượng chủ quan.",
    "Chunk render biến một việc lớn thành nhiều việc nhỏ có thể quan sát.",
    "Xfade nằm ở FFmpeg để chuyển cảnh mượt mà và kiểm soát thời lượng.",
    "Review vẫn là hàng rào sau render, nhất là với long-form.",
    "Nếu smoke qua được, ta có cơ sở tiếp tục tối ưu chất lượng.",
  ];
  return lines[index % lines.length]!;
}

async function main(): Promise<void> {
  loadDotEnv();
  process.env.NEWS_RENDER_ENGINE = "hyperframes";

  const missing = [];
  if (!process.env.VIVIBE_API_KEY && !process.env.VIETNAMESE_API_KEY) missing.push("VIVIBE_API_KEY/VIETNAMESE_API_KEY");
  if (!process.env.VIVIBE_VOICE_ID && !process.env.VIETNAMESE_VOICEID) missing.push("VIVIBE_VOICE_ID/VIETNAMESE_VOICEID");
  if (missing.length > 0) throw new Error(`Missing Vivibe config: ${missing.join(", ")}`);

  const projectId = `hf-youtube-5m-vivibe-${randomUUID().slice(0, 8)}`;
  await ensureProject(projectId);
  const paths = projectPaths(projectId);
  await rm(paths.rendersDir, { recursive: true, force: true });
  await mkdir(paths.rendersDir, { recursive: true });

  const now = new Date().toISOString();
  const brief: ProjectBrief = {
    projectId,
    prompt: "Smoke test YouTube 5 phút bằng HyperFrames, Vivibe, tiếng Việt.",
    duration: 300 as ProjectBrief["duration"],
    styleId: "clean-luxury-tech",
    ratio: "9:16",
    language: "vi",
    aiProvider: "mock",
    tts: {
      provider: "vivibe",
      voiceId: process.env.VIVIBE_VOICE_ID || process.env.VIETNAMESE_VOICEID,
      speed: 1.0,
    },
    state: "scaffolded",
    currentStep: "scaffolded",
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  await writeBrief(brief);

  const manifest = {
    title: "Kiểm thử HyperFrames long-form bằng Vivibe",
    format: "youtube",
    durationTier: 1,
    videoLanguage: "vi",
    theme: { dominant: palette.teal, mood: "editorial liquid glass" },
    scenes: Array.from({ length: sceneCount }, (_, index) => ({
      id: `scene-${String(index + 1).padStart(2, "0")}`,
      component: "hyperframes-html-scene",
      eyebrow: "KIỂM THỬ",
      headline: `${sceneTitles[index % sceneTitles.length]!}`,
      body: bodyLine(index),
      narration: narrations[0]!,
      durationInSeconds: 30,
      transitionToNext: index < sceneCount - 1 ? "fade" : undefined,
      props: {},
    })),
  };
  await writeJson(paths.manifest, manifest);

  const design = [
    "# DESIGN.md",
    "",
    "Creative guidance for the 5-minute HyperFrames smoke test.",
    "",
    "## Colors",
    `- Ivory canvas: ${palette.ivory}`,
    `- Ink text: ${palette.ink}`,
    `- Primary teal: ${palette.teal}`,
    `- Coral accent: ${palette.coral}`,
    `- Moss accent: ${palette.moss}`,
    `- Gold accent: ${palette.gold}`,
    "",
    "## Typography",
    "- Display: Fraunces / Georgia fallback.",
    "- Data labels: IBM Plex Mono / Courier fallback.",
    "- Body: Trebuchet MS / Arial fallback.",
    "",
    "## Motion",
    "- Editorial, calm, scene-specific entrances.",
    "- No decorative infinite loops; all motion is deterministic GSAP timeline motion.",
    "",
    "## What NOT to Do",
    "- No catalog/template primitives.",
    "- No remote URLs, raw media, data URLs, or async timeline construction.",
    "- No full-video single HTML composition.",
    "",
  ].join("\n");
  await writeFile(paths.hyperframesDesign, design, "utf8");
  await appendEvent(projectId, { type: "hyperframes.design", phase: "done", path: paths.hyperframesDesign });

  for (let i = 0; i < sceneCount; i += 1) {
    const sceneId = `scene-${String(i + 1).padStart(2, "0")}`;
    await writeHyperframesScene(projectId, sceneId, sceneHtml(sceneId, i, sceneTitles[i % sceneTitles.length]!));
  }

  const result = await renderProject(projectId, {
    quality: "draft",
    ttsProvider: "vivibe",
    voiceId: process.env.VIVIBE_VOICE_ID || process.env.VIETNAMESE_VOICEID,
    bgmPath: null,
    concurrency: 2,
    noCache: true,
    checklist: {
      safeArea: true,
      alignment: true,
      transitions: true,
      clutter: true,
      hook: true,
      cta: true,
      audio: true,
      richness: true,
    },
  });

  const eventsText = await readFile(paths.events, "utf8");
  const eventTypes = eventsText
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line).type as string);
  const summary = {
    projectId,
    root: resolve(paths.root),
    mp4Path: result.mp4Path,
    durationSeconds: result.locked.durationInFrames / result.locked.fps,
    fps: result.locked.fps,
    scenes: result.locked.scenes.length,
    reportOk: result.report.ok,
    issueCount: result.report.issues.length,
    eventCounts: eventTypes.reduce<Record<string, number>>((acc, type) => {
      acc[type] = (acc[type] ?? 0) + 1;
      return acc;
    }, {}),
  };
  await writeFile(join(paths.root, "hyperframes-smoke-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
