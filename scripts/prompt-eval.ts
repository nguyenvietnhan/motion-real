import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { videoToolHome } from "../packages/pipeline/src/index.js";
import type { AuthorInput } from "../apps/desktop/src/main/agent/agent-worker.js";
import {
  buildAuthorMessages,
  buildImageFilterMessages,
  buildReauthorMessages,
  buildVisualQaMessages,
  type AuthorImageInput,
  type VisionMessage,
} from "../apps/desktop/src/main/authoring/prompt.js";
import { buildContentPlanMessages } from "../apps/desktop/src/main/authoring/content-plan.js";

type EvalCase = {
  id: string;
  category: string;
  input: AuthorInput;
  withImages?: "hero" | "logo" | "pool";
};

const CASES: readonly EvalCase[] = [
  { id: "factual-explainer", category: "factual explainer", input: { text: "Giải thích vì sao chip AI cần băng thông bộ nhớ cao, không bịa số liệu.", urls: [], format: "tiktok", durationTier: 2, videoLanguage: "vi" } },
  { id: "history-timeline", category: "timeline/history", input: { text: "Kể mạch phát triển của máy tính cá nhân qua các bước ngoặt quan trọng.", urls: [], format: "tiktok", durationTier: 2, videoLanguage: "vi" } },
  { id: "product-news", category: "news/product facts", input: { text: "Tóm tắt một thương vụ công nghệ, nêu rõ điều gì đã biết và điều gì chưa chắc chắn.", urls: [], format: "tiktok", durationTier: 1, videoLanguage: "vi" } },
  { id: "tradeoff", category: "comparison/tradeoff", input: { text: "So sánh chạy AI local và cloud theo quyền riêng tư, chi phí và độ trễ.", urls: [], format: "tiktok", durationTier: 2, videoLanguage: "vi" } },
  { id: "technical-process", category: "technical process", input: { text: "Giải thích pipeline từ prompt đến video Remotion bằng một luồng trực quan.", urls: [], format: "tiktok", durationTier: 2, videoLanguage: "vi" } },
  { id: "abstract-metaphor", category: "abstract metaphor", input: { text: "Biến ý tưởng nợ kỹ thuật tích lũy thành một câu chuyện hình ảnh dễ hiểu.", urls: [], format: "tiktok", durationTier: 1, videoLanguage: "vi" } },
  { id: "plain-statement", category: "statement without numbers", input: { text: "Một video ngắn về việc công cụ tốt không thay thế tư duy tốt.", urls: [], format: "tiktok", durationTier: 1, videoLanguage: "vi" } },
  { id: "hero-image", category: "approved hero image", input: { text: "Giải thích cách một trung tâm dữ liệu vận hành, dùng ảnh thật làm bằng chứng hình ảnh.", urls: [], format: "tiktok", durationTier: 2, videoLanguage: "vi" }, withImages: "hero" },
  { id: "brand-logo", category: "relevant logo", input: { text: "Giải thích vai trò của một thương hiệu công nghệ; logo chỉ là điểm nhấn.", urls: [], format: "tiktok", durationTier: 1, videoLanguage: "vi" }, withImages: "logo" },
  { id: "asset-pool", category: "curated asset subset", input: { text: "Kể câu chuyện về tự động hóa, chỉ dùng ảnh thực sự hỗ trợ từng ý.", urls: [], format: "tiktok", durationTier: 2, videoLanguage: "vi" }, withImages: "pool" },
  { id: "long-vietnamese", category: "long Vietnamese", input: { text: "Phân tích tác động của AI agent tới quy trình làm việc, gồm cơ hội, giới hạn và cách áp dụng có trách nhiệm.", urls: [], format: "tiktok", durationTier: 4, videoLanguage: "vi" } },
  { id: "english", category: "English", input: { text: "Explain how small language models trade capability for speed and local control.", urls: [], format: "tiktok", durationTier: 2, videoLanguage: "en" } },
] as const;

const ONE_PIXEL_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function imagesFor(kind: EvalCase["withImages"]): AuthorImageInput[] | undefined {
  if (!kind) return undefined;
  const count = kind === "pool" ? 4 : 1;
  return Array.from({ length: count }, (_, index) => ({
    ref: `assets/eval-${kind}-${index + 1}.png`,
    width: kind === "logo" ? 512 : 1280,
    height: kind === "logo" ? 512 : 720,
    dataUrl: ONE_PIXEL_PNG,
  }));
}

function textOf(messages: VisionMessage[]): string {
  return messages.map((message) => typeof message.content === "string"
    ? message.content
    : message.content.map((part) => part.type === "text" ? part.text : "[image]").join("\n")).join("\n");
}

function promptStats(messages: VisionMessage[]) {
  const text = textOf(messages);
  return {
    chars: text.length,
    systemChars: typeof messages[0]?.content === "string" ? messages[0].content.length : 0,
    negativeRules: (text.match(/\bKHÔNG\b/giu) ?? []).length,
    mandatoryRules: (text.match(/\b(?:BẮT BUỘC|TUYỆT ĐỐI)\b/giu) ?? []).length,
  };
}

function args(): { mode: "offline" | "live"; label: string } {
  const raw = process.argv.slice(2);
  const modeValue = raw.find((value) => value.startsWith("--mode="))?.slice(7) ?? "offline";
  if (modeValue !== "offline" && modeValue !== "live") throw new Error("--mode phải là offline hoặc live");
  const label = raw.find((value) => value.startsWith("--label="))?.slice(8)?.trim()
    || `${modeValue}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  if (!/^[A-Za-z0-9._-]+$/.test(label)) throw new Error("--label chỉ được chứa chữ, số, dấu chấm, gạch ngang hoặc gạch dưới");
  return { mode: modeValue, label };
}

async function main(): Promise<void> {
  const options = args();
  if (options.mode === "live") {
    throw new Error("Live prompt eval cần 9router/runtime thật và được chạy qua desktop acceptance; offline report đã sẵn sàng, không giả lập live pass.");
  }
  const cases = CASES.map((entry) => {
    const images = imagesFor(entry.withImages);
    const planner = buildContentPlanMessages(entry.input, undefined, images);
    const author = buildAuthorMessages(entry.input, undefined, images);
    return {
      id: entry.id,
      category: entry.category,
      language: entry.input.videoLanguage ?? "vi",
      durationTier: entry.input.durationTier ?? 1,
      imageCount: images?.length ?? 0,
      planner: promptStats(planner),
      author: promptStats(author),
    };
  });
  const repair = promptStats(buildReauthorMessages({
    sceneId: "scene-01",
    componentId: "eval-scene",
    currentCode: "export default null;",
    intent: "Giữ ý tưởng và sửa bố cục bị lệch.",
  }));
  const imageFilter = promptStats(buildImageFilterMessages("Nguồn nói về một sản phẩm công nghệ.", imagesFor("pool")!));
  const visualQa = promptStats(buildVisualQaMessages([{ sceneId: "scene-01", stillDataUrl: ONE_PIXEL_PNG }]));
  const report = {
    version: 1,
    mode: options.mode,
    label: options.label,
    createdAt: new Date().toISOString(),
    runtimeAcceptance: "not-run",
    cases,
    focused: { repair, imageFilter, visualQa },
  };
  const root = join(videoToolHome(), "prompt-evals");
  await mkdir(root, { recursive: true });
  const output = join(root, `${options.label}.json`);
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`[prompt-eval] offline report: ${output}`);
  console.log(`[prompt-eval] ${cases.length} cases; live/runtime acceptance not run`);
}

main().catch((error: unknown) => {
  console.error(`[prompt-eval] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
