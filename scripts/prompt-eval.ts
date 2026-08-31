import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  createTools,
  loadManifest,
  projectPaths,
  scaffoldVideoProject,
  videoToolHome,
  type AuthoringReviewRequest,
  type ReviewArtifact,
} from "../packages/pipeline/src/index.js";
import type { AuthorInput } from "../apps/desktop/src/main/agent/agent-worker.js";
import { NineRouterAuthoringBackend } from "../apps/desktop/src/main/authoring/ninerouter-backend.js";
import { NineRouterClient, type ChatMessage } from "../apps/desktop/src/main/gateway/ninerouter-client.js";
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
  expectedReview?: { temporalMode: "static" | "stepped" | "continuous"; detailMode: "normal" | "fine" };
};

const CASES: readonly EvalCase[] = [
  { id: "factual-explainer", category: "factual explainer", input: { text: "Giải thích vì sao chip AI cần băng thông bộ nhớ cao, không bịa số liệu.", urls: [], format: "tiktok", durationTier: 2, videoLanguage: "vi" } },
  { id: "history-timeline", category: "timeline/history", input: { text: "Kể mạch phát triển của máy tính cá nhân qua các bước ngoặt quan trọng.", urls: [], format: "tiktok", durationTier: 2, videoLanguage: "vi" } },
  { id: "product-news", category: "news/product facts", input: { text: "Tóm tắt một thương vụ công nghệ, nêu rõ điều gì đã biết và điều gì chưa chắc chắn.", urls: [], format: "tiktok", durationTier: 1, videoLanguage: "vi" } },
  { id: "tradeoff", category: "comparison/tradeoff", input: { text: "So sánh chạy AI local và cloud theo quyền riêng tư, chi phí và độ trễ.", urls: [], format: "tiktok", durationTier: 2, videoLanguage: "vi" } },
  { id: "technical-process", category: "technical process", input: { text: "Giải thích pipeline từ prompt đến video Remotion bằng một luồng trực quan.", urls: [], format: "tiktok", durationTier: 2, videoLanguage: "vi" } },
  { id: "abstract-metaphor", category: "abstract metaphor", input: { text: "Biến ý tưởng nợ kỹ thuật tích lũy thành một câu chuyện hình ảnh dễ hiểu.", urls: [], format: "tiktok", durationTier: 1, videoLanguage: "vi" } },
  { id: "plain-statement", category: "statement without numbers", input: { text: "Một video ngắn về việc công cụ tốt không thay thế tư duy tốt.", urls: [], format: "tiktok", durationTier: 1, videoLanguage: "vi" }, expectedReview: { temporalMode: "static", detailMode: "normal" } },
  { id: "hero-image", category: "approved hero image", input: { text: "Giải thích cách một trung tâm dữ liệu vận hành, dùng ảnh thật làm bằng chứng hình ảnh.", urls: [], format: "tiktok", durationTier: 2, videoLanguage: "vi" }, withImages: "hero" },
  { id: "brand-logo", category: "relevant logo", input: { text: "Giải thích vai trò của một thương hiệu công nghệ; logo chỉ là điểm nhấn.", urls: [], format: "tiktok", durationTier: 1, videoLanguage: "vi" }, withImages: "logo" },
  { id: "asset-pool", category: "curated asset subset", input: { text: "Kể câu chuyện về tự động hóa, chỉ dùng ảnh thực sự hỗ trợ từng ý.", urls: [], format: "tiktok", durationTier: 2, videoLanguage: "vi" }, withImages: "pool" },
  { id: "long-vietnamese", category: "long Vietnamese", input: { text: "Phân tích tác động của AI agent tới quy trình làm việc, gồm cơ hội, giới hạn và cách áp dụng có trách nhiệm.", urls: [], format: "tiktok", durationTier: 4, videoLanguage: "vi" } },
  { id: "english", category: "English", input: { text: "Explain how small language models trade capability for speed and local control.", urls: [], format: "tiktok", durationTier: 2, videoLanguage: "en" } },
  { id: "motion-process", category: "semantic motion/process", input: { text: "Giải thích quy trình ba bước: nhận yêu cầu, xử lý dữ liệu rồi trả kết quả; từng bước phải xuất hiện theo lời đọc.", urls: [], format: "tiktok", durationTier: 1, videoLanguage: "vi" }, expectedReview: { temporalMode: "stepped", detailMode: "normal" } },
  { id: "motion-terminal", category: "semantic motion/terminal", input: { text: "Minh hoạ một lệnh terminal được gõ, kết quả trả về, rồi trạng thái hệ thống thay đổi.", urls: [], format: "tiktok", durationTier: 1, videoLanguage: "vi" }, expectedReview: { temporalMode: "continuous", detailMode: "fine" } },
  { id: "motion-list", category: "semantic motion/sequential list", input: { text: "Trình bày ba nguyên tắc bảo mật theo thứ tự; ý tiếp theo chỉ hiện khi lời đọc chuyển sang ý đó.", urls: [], format: "tiktok", durationTier: 1, videoLanguage: "vi" }, expectedReview: { temporalMode: "stepped", detailMode: "normal" } },
  { id: "motion-before-after", category: "semantic motion/before-after", input: { text: "So sánh quy trình thủ công trước đây với quy trình tự động sau cải tiến theo diễn tiến lời đọc.", urls: [], format: "tiktok", durationTier: 1, videoLanguage: "vi" }, expectedReview: { temporalMode: "stepped", detailMode: "normal" } },
  { id: "motion-counter-chart", category: "semantic motion/counter-chart", input: { text: "Giải thích một chỉ số tăng qua ba mốc và ý nghĩa của thay đổi cuối cùng, không hiện kết quả trước lời đọc.", urls: [], format: "tiktok", durationTier: 1, videoLanguage: "vi" }, expectedReview: { temporalMode: "continuous", detailMode: "fine" } },
  { id: "motion-evidence-image", category: "semantic motion/evidence image", input: { text: "Dùng ảnh bằng chứng để lần lượt chỉ ra tổng thể, vùng chi tiết và kết luận quan trọng.", urls: [], format: "tiktok", durationTier: 1, videoLanguage: "vi" }, withImages: "hero", expectedReview: { temporalMode: "continuous", detailMode: "fine" } },
  { id: "review-logo-reveal", category: "review/static logo reveal", input: { text: "Giới thiệu ngắn một thương hiệu bằng logo rồi giữ trạng thái kết rõ ràng.", urls: [], format: "tiktok", durationTier: 1, videoLanguage: "vi" }, withImages: "logo", expectedReview: { temporalMode: "static", detailMode: "normal" } },
  { id: "review-two-step", category: "review/two-step comparison", input: { text: "So sánh hai lựa chọn theo hai bước rõ ràng và chỉ mở kết luận sau khi đã trình bày cả hai.", urls: [], format: "tiktok", durationTier: 1, videoLanguage: "vi" }, expectedReview: { temporalMode: "stepped", detailMode: "normal" } },
  { id: "review-five-item-list", category: "review/five-item list", input: { text: "Trình bày năm dấu hiệu rủi ro theo lời đọc, giữ ngữ cảnh của các ý đã xuất hiện.", urls: [], format: "tiktok", durationTier: 2, videoLanguage: "vi" }, expectedReview: { temporalMode: "stepped", detailMode: "normal" } },
  { id: "review-fine-table", category: "review/fine detail table", input: { text: "Giải thích một bảng so sánh nhỏ, lần lượt làm rõ cột chi phí, độ trễ và quyền riêng tư.", urls: [], format: "tiktok", durationTier: 1, videoLanguage: "vi" }, expectedReview: { temporalMode: "stepped", detailMode: "fine" } },
  { id: "review-critical-transition", category: "review/critical zoom transition", input: { text: "Chuyển từ toàn cảnh hệ thống vào một chi tiết quan trọng bằng zoom có chủ đích.", urls: [], format: "tiktok", durationTier: 1, videoLanguage: "vi" }, expectedReview: { temporalMode: "continuous", detailMode: "normal" } },
  { id: "review-user-edit", category: "review/single-scene user edit", input: { text: "Chỉnh một cảnh danh sách để ý thứ hai dễ đọc hơn mà không thiết kế lại các cảnh khác.", urls: [], format: "tiktok", durationTier: 1, videoLanguage: "vi" }, expectedReview: { temporalMode: "stepped", detailMode: "normal" } },
  { id: "review-legacy-semantic", category: "review/legacy semantic fallback", input: { text: "Mô phỏng project cũ có semantic progression nhưng chưa có cue có cấu trúc.", urls: [], format: "tiktok", durationTier: 1, videoLanguage: "vi" }, expectedReview: { temporalMode: "stepped", detailMode: "normal" } },
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

function args(): { mode: "offline" | "live"; label: string; caseId?: string } {
  const raw = process.argv.slice(2);
  const modeValue = raw.find((value) => value.startsWith("--mode="))?.slice(7) ?? "offline";
  if (modeValue !== "offline" && modeValue !== "live") throw new Error("--mode phải là offline hoặc live");
  const label = raw.find((value) => value.startsWith("--label="))?.slice(8)?.trim()
    || `${modeValue}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  if (!/^[A-Za-z0-9._-]+$/.test(label)) throw new Error("--label chỉ được chứa chữ, số, dấu chấm, gạch ngang hoặc gạch dưới");
  const caseId = raw.find((value) => value.startsWith("--case="))?.slice(7)?.trim();
  if (caseId && !CASES.some((entry) => entry.id === caseId)) throw new Error(`Không có eval case "${caseId}"`);
  return { mode: modeValue, label, ...(caseId ? { caseId } : {}) };
}

async function main(): Promise<void> {
  const options = args();
  const selectedCases = options.caseId ? CASES.filter((entry) => entry.id === options.caseId) : CASES;
  const cases = selectedCases.map((entry) => {
    const images = imagesFor(entry.withImages);
    const planner = buildContentPlanMessages(entry.input, undefined, images);
    const author = buildAuthorMessages(entry.input, undefined, images);
    return {
      id: entry.id,
      category: entry.category,
      language: entry.input.videoLanguage ?? "vi",
      durationTier: entry.input.durationTier ?? 1,
      imageCount: images?.length ?? 0,
      ...(entry.expectedReview ? { expectedReview: entry.expectedReview } : {}),
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
  if (options.mode === "live") {
    const live = await runLiveEval(root, options.label, selectedCases);
    await writeFile(output, `${JSON.stringify({ ...report, runtimeAcceptance: live.ok ? "completed" : "failed", live: live.results }, null, 2)}\n`, "utf8");
    await writeContactSheet(root, options.label, live.results);
    console.log(`[prompt-eval] live report: ${output}`);
    console.log(`[prompt-eval] ${live.results.filter((result) => result.ok).length}/${selectedCases.length} cases authored and rendered to stills`);
    if (!live.ok) process.exitCode = 1;
    return;
  }
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`[prompt-eval] offline report: ${output}`);
  console.log(`[prompt-eval] ${cases.length} cases; live/runtime acceptance not run`);
}

type LiveCaseResult = {
  id: string;
  ok: boolean;
  modelId: string;
  startedAt: string;
  elapsedMs: number;
  modelCalls: number;
  modelCallMs: number;
  repairCount: number;
  sceneCount: number;
  semanticSceneCount: number;
  stillCount: number;
  reviewArtifactCount: number;
  reviewArtifactBytes: number;
  reviewArtifactKinds: Record<ReviewArtifact["kind"], number>;
  overviewSceneCount: number;
  cuePanelCount: number;
  admission: "passed" | "failed" | "not-run";
  renderStills: "passed" | "failed" | "not-run";
  stills: string[];
  error?: string;
  diagnostics?: string[];
};

async function runLiveEval(
  root: string,
  label: string,
  selectedCases: readonly EvalCase[],
): Promise<{ ok: boolean; results: LiveCaseResult[] }> {
  const rawClient = new NineRouterClient();
  if (!(await rawClient.isReachable())) throw new Error("9router không phản hồi tại http://127.0.0.1:20128");
  const apiKey = await rawClient.createApiKey(`motionreal-prompt-eval-${label}`);
  if (!apiKey) throw new Error("9router không cấp được API key nội bộ cho prompt eval");
  const modelId = await selectedModel(rawClient);
  const outputDir = join(root, `${label}-stills`);
  await mkdir(outputDir, { recursive: true });
  const results: LiveCaseResult[] = [];

  for (const entry of selectedCases) {
    const startedAt = new Date().toISOString();
    const started = performance.now();
    let modelCalls = 0;
    let modelCallMs = 0;
    let repairCount = 0;
    const diagnostics: string[] = [];
    let projectId = "";
    const measuredClient = {
      chat: async (model: string, messages: ChatMessage[], opts?: { apiKey?: string; signal?: AbortSignal }) => {
        modelCalls++;
        const callStarted = performance.now();
        try {
          return await rawClient.chat(model, messages, opts);
        } finally {
          modelCallMs += performance.now() - callStarted;
        }
      },
      chatStructured: async (
        model: string,
        messages: ChatMessage[],
        format: Parameters<NineRouterClient["chatStructured"]>[2],
        opts?: { apiKey?: string; signal?: AbortSignal },
      ) => {
        modelCalls++;
        const callStarted = performance.now();
        try {
          return await rawClient.chatStructured(model, messages, format, opts);
        } finally {
          modelCallMs += performance.now() - callStarted;
        }
      },
    } as unknown as NineRouterClient;
    const captureAdmissionDiagnostics = (meta: unknown, message: string): void => {
      if (!/admission failed/i.test(message) || !meta || typeof meta !== "object") return;
      const violations = (meta as { violations?: unknown }).violations;
      if (Array.isArray(violations)) diagnostics.push(...violations.filter((value): value is string => typeof value === "string"));
    };
    const logger = {
      debug: () => undefined,
      info: (_meta: unknown, message = "") => {
        if (/repair requested|recovery attempted/i.test(message)) repairCount++;
      },
      warn: (meta: unknown, message = "") => {
        if (/repair requested|recovery attempted/i.test(message)) repairCount++;
        captureAdmissionDiagnostics(meta, message);
      },
      error: (meta: unknown, message = "") => captureAdmissionDiagnostics(meta, message),
    };
    let admission: LiveCaseResult["admission"] = "not-run";
    let renderStills: LiveCaseResult["renderStills"] = "not-run";
    let sceneCount = 0;
    let semanticSceneCount = 0;
    let copiedStills: string[] = [];
    let reviewArtifacts: ReviewArtifact[] = [];
    let reviewArtifactBytes = 0;
    let error: string | undefined;
    try {
      const scaffold = await scaffoldVideoProject({
        prompt: `[prompt-eval:${entry.id}] ${entry.input.text}`,
        format: entry.input.format,
        durationTier: entry.input.durationTier,
        language: entry.input.videoLanguage,
        creationMode: "classic",
        tts: { provider: "none" },
      });
      projectId = scaffold.projectId;
      const images = await stageEvalImages(projectId, entry.withImages);
      const backend = new NineRouterAuthoringBackend({
        client: measuredClient,
        tools: createTools(),
        model: () => modelId,
        apiKey: () => apiKey,
        logger,
      });
      const authored = await backend.authorScenes({
        projectId,
        input: { ...entry.input, ...(images ? { images } : {}) },
        scriptGate: false,
      });
      sceneCount = authored.scenes.length;
      if (sceneCount === 0) throw new Error(authored.message ?? "authoring không tạo được scene");
      admission = "passed";
      const manifest = await loadManifest(projectId);
      semanticSceneCount = manifest.scenes.filter((scene) => Array.isArray((scene as { motionBeats?: unknown }).motionBeats)
        || /semantic\s*:/iu.test(String((scene as { motionProgression?: unknown }).motionProgression ?? ""))).length;
      const reviewRequest = reviewRequestForEval(entry, manifest.scenes);
      const rendered = await backend.renderStills(
        projectId,
        undefined,
        undefined,
        { reviewRequest },
      );
      if (rendered.error || rendered.stills.length === 0) {
        throw new Error(rendered.error?.cause ?? "render still không tạo được ảnh");
      }
      renderStills = "passed";
      const caseDir = join(outputDir, entry.id);
      await mkdir(caseDir, { recursive: true });
      reviewArtifacts = rendered.reviewArtifacts ?? [];
      const modelFacing = reviewArtifacts.length > 0 ? reviewArtifacts.map((artifact) => artifact.path) : rendered.stills;
      copiedStills = await Promise.all(modelFacing.map(async (source) => {
        const destination = join(caseDir, basename(source));
        await copyFile(source, destination);
        return destination;
      }));
      reviewArtifactBytes = (await Promise.all(modelFacing.map(async (path) => (await stat(path)).size)))
        .reduce((sum, size) => sum + size, 0);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
      if (admission === "not-run" && sceneCount === 0) admission = "failed";
      else if (renderStills === "not-run") renderStills = "failed";
    } finally {
      if (projectId) await rm(projectPaths(projectId).root, { recursive: true, force: true });
    }
    results.push({
      id: entry.id,
      ok: !error,
      modelId,
      startedAt,
      elapsedMs: Math.round(performance.now() - started),
      modelCalls,
      modelCallMs: Math.round(modelCallMs),
      repairCount,
      sceneCount,
      semanticSceneCount,
      stillCount: copiedStills.length,
      reviewArtifactCount: reviewArtifacts.length,
      reviewArtifactBytes,
      reviewArtifactKinds: countArtifactKinds(reviewArtifacts),
      overviewSceneCount: new Set(reviewArtifacts
        .filter((artifact) => artifact.kind === "overview")
        .flatMap((artifact) => artifact.panels.map((panel) => panel.sceneId))).size,
      cuePanelCount: reviewArtifacts.flatMap((artifact) => artifact.panels)
        .filter((panel) => panel.cueId !== undefined).length,
      admission,
      renderStills,
      stills: copiedStills,
      ...(error ? { error } : {}),
      ...(diagnostics.length > 0 ? { diagnostics } : {}),
    });
  }
  return { ok: results.every((result) => result.ok), results };
}

function reviewRequestForEval(
  entry: EvalCase,
  scenes: readonly { id: string; motionBeats?: readonly unknown[]; motionProgression?: string }[],
): AuthoringReviewRequest {
  return {
    reviewSceneIds: scenes.map((scene) => scene.id),
    contextSceneIds: [],
    scenes: scenes.map((scene) => {
      const legacySemantic = (scene.motionBeats?.length ?? 0) >= 2 || /\bsemantic\s*:/iu.test(scene.motionProgression ?? "");
      return {
        sceneId: scene.id,
        temporalMode: legacySemantic ? (entry.expectedReview?.temporalMode ?? "stepped") : "static",
        detailMode: entry.expectedReview?.detailMode ?? "normal",
      };
    }),
  };
}

function countArtifactKinds(artifacts: readonly ReviewArtifact[]): Record<ReviewArtifact["kind"], number> {
  const counts: Record<ReviewArtifact["kind"], number> = {
    overview: 0,
    "cue-filmstrip": 0,
    "dense-filmstrip": 0,
    detail: 0,
    transition: 0,
  };
  for (const artifact of artifacts) counts[artifact.kind]++;
  return counts;
}

async function selectedModel(client: NineRouterClient): Promise<string> {
  let preferred = "";
  try {
    const settings = JSON.parse(await readFile(join(videoToolHome(), "motionreal-settings.json"), "utf8")) as { preferredAiModelId?: unknown };
    if (typeof settings.preferredAiModelId === "string") preferred = settings.preferredAiModelId.trim();
  } catch {
    // Fresh installs may not have settings yet; use the live gateway catalog.
  }
  const models = await client.listModels();
  if (preferred && models.some((model) => model.id === preferred)) return preferred;
  const first = models[0]?.id;
  if (!first) throw new Error("9router không trả model nào cho prompt eval");
  return first;
}

async function stageEvalImages(projectId: string, kind: EvalCase["withImages"]): Promise<AuthorInput["images"] | undefined> {
  const images = imagesFor(kind);
  if (!images) return undefined;
  const assetsDir = projectPaths(projectId).assetsDir;
  await mkdir(assetsDir, { recursive: true });
  const bytes = Buffer.from(ONE_PIXEL_PNG.slice(ONE_PIXEL_PNG.indexOf(",") + 1), "base64");
  await Promise.all(images.map((image) => writeFile(join(projectPaths(projectId).root, image.ref), bytes)));
  return images.map(({ ref, width, height }) => ({ ref, width, height }));
}

async function writeContactSheet(root: string, label: string, results: readonly LiveCaseResult[]): Promise<void> {
  const cards = results.map((result) => {
    const images = result.stills.map((still) => {
      const relative = still.slice(root.length + 1).replaceAll("\\", "/");
      return `<img src="${escapeHtml(relative)}" alt="${escapeHtml(result.id)} still">`;
    }).join("");
    return `<section><h2>${escapeHtml(result.id)} — ${result.ok ? "PASS" : "FAIL"}</h2><p>${result.sceneCount} scenes · ${result.modelCalls} calls · ${result.elapsedMs} ms</p><div class="stills">${images}</div><p>Hierarchy __/5 · Focal balance __/5 · Scene variety __/5 · Clarity __/5 · Asset relevance __/5 · Visual originality __/5</p></section>`;
  }).join("\n");
  const html = `<!doctype html><meta charset="utf-8"><title>MotionReal prompt eval — ${escapeHtml(label)}</title><style>body{font:14px system-ui;background:#111;color:#eee;margin:24px}section{border:1px solid #444;border-radius:12px;padding:16px;margin:0 0 24px}.stills{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}.stills img{width:100%;aspect-ratio:9/16;object-fit:contain;background:#000;border-radius:8px}p{color:#bbb}</style><h1>${escapeHtml(label)}</h1>${cards}`;
  await writeFile(join(root, `${label}-contact-sheet.html`), html, "utf8");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

main().catch((error: unknown) => {
  console.error(`[prompt-eval] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
