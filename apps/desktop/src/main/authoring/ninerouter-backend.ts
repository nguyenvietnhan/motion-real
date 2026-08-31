import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import {
  createLogger,
  admitAuthoredSceneFile,
  loadManifest,
  projectPaths,
  normalizeAuthoredSource,
  unregisterComponent,
  makeSafeFetch,
  crawlArticleImagesWithStats,
  extractUrlContent,
  DEFAULT_PAGE_FETCH_TIMEOUT_MS,
  type CrawledImage,
  type AdmitProjectResult,
  type AuthoredRegistration,
  type SerializedPipelineError,
} from "@motionreal/pipeline";
import {
  applyAuthoringCandidate,
  reconcileAuthoringCandidateTransaction,
} from "./author-candidate-transaction.js";
import { isCancelled } from "../util/abort.js";
import {
  collectResearchContext,
  formatUntrustedResearchBlock,
  researchLinkWarningOf,
  toResearchSources,
} from "./research-context.js";
import type { createTools } from "@motionreal/pipeline";
import type { AuthoringBackend, AuthoredScene, ReauthorTarget } from "../agent/custom-loop-worker.js";
import type { SafetyReportView } from "../agent/repair-loop.js";
import type { AuthorInput, AuthorJob, VisualQaResult, SceneSnapshot, AuthorImageRef } from "../agent/agent-worker.js";
import { GatewayChatError, type NineRouterClient } from "../gateway/ninerouter-client.js";
import { logAuthoringFailure } from "./authoring-failure.js";
import { countSafetyChecks, toEngineManifest } from "./author-manifest-convert.js";
import {
  getSafetyReportWithTools,
  renderDraftWithTools,
  renderFullWithTools,
  renderStillsWithTools,
  type AuthoringRenderToolsDeps,
} from "./authoring-render-tools.js";
import { VisionChatSession } from "./authoring-vision-chat.js";
import { type AuthorImageInput } from "./prompt.js";
import { runContentPlan } from "./content-plan-runner.js";
import type { ContentPlan } from "./content-plan.js";
import { ContentPlanSchema } from "./content-plan-schema.js";
import { buildProjectEvidence } from "./content-evidence.js";
import { runBatchedAuthorReply, runSingleAuthorReply, type SuccessfulAuthorReply } from "./author-reply-runner.js";
import { runReauthor } from "./reauthor-runner.js";
import { ImageFilterResponseSchema, runImageFilter } from "./image-filter-runner.js";
import { runArticleImageCrawler } from "./article-image-crawler-runner.js";
import {
  AUTHOR_BATCH_BUDGET_FAILURE,
  AUTHOR_BATCH_SIZE,
  MAX_AUTHOR_BATCHES,
  MAX_BATCHED_COMPONENTS,
  planAuthorBatching,
} from "./author-batch-policy.js";
import { sceneFileName, resolveSceneFile } from "./scene-files.js";
import { normalizeAuthoredImports } from "./normalize-imports.js";
import { normalizeAuthoredFontSizes } from "./normalize-fontsize.js";
import {
  restoreAuthoredScenes,
  runVisualQa,
  snapshotAuthoredScenes,
  VisualQaResponseSchema,
} from "./visual-qa-runner.js";

export { isLogicChanged } from "./reauthor-runner.js";

/**
 * Pure-AUTHOR authoring backend. The AI writes FRESH `.tsx`
 * scene modules per topic (no fixed kit): it returns a manifest + one `.tsx` code
 * block per scene id; we write each module, admit them through the gate, and
 * render. Drives the SAME pipeline tools / single registry.
 */

type Tools = ReturnType<typeof createTools>;
type AuthoringLogger = Pick<typeof log, "debug" | "info" | "warn" | "error">;

/** Scope-tagged structured logger for the authoring backend (library-adoption pilot). */
const log = createLogger("authoring");

const CONTENT_PLAN_OUTPUT = {
  name: "motionreal_content_plan",
  schema: z.toJSONSchema(ContentPlanSchema) as Record<string, unknown>,
};
const IMAGE_FILTER_OUTPUT = {
  name: "motionreal_image_filter",
  schema: z.toJSONSchema(ImageFilterResponseSchema) as Record<string, unknown>,
};
const VISUAL_QA_OUTPUT = {
  name: "motionreal_visual_qa",
  schema: z.toJSONSchema(VisualQaResponseSchema) as Record<string, unknown>,
};

/**
 * Phrase an AI-call failure in plain Vietnamese, by KIND, so the user knows which
 * layer hiccuped and whether retrying helps — instead of one generic "timeout or
 * lost connection" line for every failure. Mirrors the gateway's `chat` retry:
 * a "transient" error is only thrown AFTER auto-retries are exhausted, so its
 * message says "still failing after several tries".
 */
export function authorCallErrorMessage(e: unknown): string {
  if (e instanceof GatewayChatError) {
    if (e.kind === "timeout") {
      return "Model phản hồi quá lâu (quá thời gian chờ). Vui lòng thử lại hoặc chọn model khác.";
    }
    if (e.kind === "transient") {
      return "Model tạm thời không phản hồi (đang khởi động). Vui lòng thử lại sau ít phút hoặc đổi model.";
    }
    // Upstream quota failures may arrive as 401/403 with a reset window, while a
    // bare 401 from local 9router means our internal Bearer key is missing.
    const quotaLimited = e.status === 429
      || ((e.status === 401 || e.status === 403) && /reset after|quota|rate.?limit|usage.?limit/i.test(e.message));
    if (quotaLimited) {
      const reset = /reset after ([^)"]+)/i.exec(e.message)?.[1]?.trim();
      const when = reset ? `Hạn mức sẽ mở lại sau ~${reset}.` : "Hạn mức sẽ tự mở lại sau một lúc.";
      return `Tài khoản của model đang bị giới hạn tạm thời (hết hạn mức / quá tải từ nhà cung cấp). ${when} Hãy chờ rồi thử lại, hoặc đổi sang model/tài khoản khác trong Cài đặt.`;
    }
    if (e.status === 401 || e.status === 403) {
      return "9router từ chối khóa nội bộ của MotionReal. Hãy khởi động lại ứng dụng để tạo lại kết nối rồi thử lại.";
    }
    return "Model từ chối yêu cầu hoặc chưa sẵn sàng. Hãy kiểm tra lại model đã chọn trong Cài đặt rồi thử lại.";
  }
  return "Không nhận được phản hồi từ AI (quá thời gian chờ hoặc mất kết nối). Hãy kiểm tra 9Router/model rồi thử lại.";
}

export type NineRouterBackendDeps = {
  client: NineRouterClient;
  tools: Tools;
  /** The selected model id (e.g. "kr/claude-sonnet-4.5"); undefined ⇒ not ready. */
  model: () => string | undefined;
  /** The internal gateway key for /v1 auth, if minted. */
  apiKey: () => string | undefined;
  /** Forward fine-grained render progress to the UI (per project). */
  onRenderProgress?: (ratio: number, projectId: string) => void;
  /**
   * The narration rate (words/second) the author prompt's word-budget math uses.
   * Read live from settings for calibrated Vietnamese voices so recalibration
   * takes effect on the next author call. English currently uses its
   * language-specific prompt default.
   */
  wordsPerSecond?: (projectId: string) => number | undefined | Promise<number | undefined>;
  /**
   * Admit staged candidate module paths (injectable for tests).
   * Must receive the staged file list — never the canonical project id.
   * Default: pipeline admitAuthoredSceneFiles on those paths.
   */
  admitFiles?: (files: readonly string[]) => Promise<AdmitProjectResult>;
  /** Admit ONE authored module (injectable for tests; reauthor path). */
  admitOne?: (tsxPath: string) => Promise<AuthoredRegistration>;
  /** Optional structured logger override for focused backend observability tests. */
  logger?: AuthoringLogger;
  /** Optional URL extract inject (tests); default is pipeline extractUrlContent. */
  extractUrl?: (
    url: string,
    options?: { signal?: AbortSignal },
  ) => Promise<{
    metadata: { sourceUrl: string; title?: string; site?: string; author?: string; publishedDate?: string; fetchedAt?: string };
    body: string;
    wordCount: number;
  }>;
};

/** Read a rendered still into a PNG data URL, or undefined if missing/unreadable. */
function readStillDataUrl(path: string): string | undefined {
  try {
    if (!existsSync(path)) return undefined;
    return `data:image/png;base64,${readFileSync(path).toString("base64")}`;
  } catch (e) {
    log.debug({ err: e, path }, "still read failed; treating as missing");
    return undefined;
  }
}

export class NineRouterAuthoringBackend implements AuthoringBackend {
  private readonly vision: VisionChatSession;

  constructor(private readonly deps: NineRouterBackendDeps) {
    this.vision = new VisionChatSession({
      client: deps.client,
      apiKey: deps.apiKey,
      logger: deps.logger ?? log,
    });
  }

  private logger(): AuthoringLogger {
    return this.deps.logger ?? log;
  }

  private renderTools(): AuthoringRenderToolsDeps {
    return {
      tools: this.deps.tools,
      ...(this.deps.onRenderProgress ? { onRenderProgress: this.deps.onRenderProgress } : {}),
      loadManifest: (id) => loadManifest(id),
      unregisterComponent,
      logger: this.logger(),
    };
  }

  /** Reuse the production planner for Agent-owned authoring before Harness writes TSX. */
  async planContent(projectId: string, input: AuthorInput, signal?: AbortSignal): Promise<ContentPlan> {
    const model = this.deps.model();
    if (!model) throw new Error("Chưa chọn model AI.");
    signal?.throwIfAborted();
    const wordsPerSecond = await this.deps.wordsPerSecond?.(projectId);
    const result = await runContentPlan({
      model,
      projectId,
      input,
      wordsPerSecond,
      chat: (selectedModel, messages) =>
        this.vision.chatWithVisionFallback(selectedModel, messages, signal, CONTENT_PLAN_OUTPUT),
      callErrorMessage: authorCallErrorMessage,
      logger: this.logger(),
    });
    signal?.throwIfAborted();
    if (!result.ok) throw new Error(result.message);
    return result.contentPlan;
  }

  async authorScenes(
    job: AuthorJob,
    signal?: AbortSignal,
  ): Promise<{ scenes: AuthoredScene[]; message?: string; unreadableUrls?: string[]; cancelled?: boolean }> {
    const model = this.deps.model();
    if (!model) return { scenes: [], message: "Chưa chọn model AI." };
    if (isCancelled(signal)) return { scenes: [], cancelled: true };
    // Drop any half-finished candidate transaction left by a prior crash.
    await reconcileAuthoringCandidateTransaction(job.projectId).catch((_error) => undefined);

    // Bounded, concurrent URL grounding. Planner sees labeled untrusted text
    // only; code authoring never receives raw article bodies.
    const researchReport = await collectResearchContext({
      urls: job.input.urls,
      ...(signal ? { signal } : {}),
      extract: this.deps.extractUrl ?? ((url, options) => extractUrlContent(url, options)),
    });
    if (isCancelled(signal)) return { scenes: [], cancelled: true };
    const unreadableUrls = [...researchReport.unreadableUrls, ...researchReport.skippedUrls];
    const researchSources = toResearchSources(researchReport.readableSources);
    const research =
      researchReport.readableSources.length > 0
        ? formatUntrustedResearchBlock(researchReport.readableSources)
        : undefined;
    const researchWarning = researchLinkWarningOf(researchReport);

    // Provided images (create-time image staging): read each already-imported asset into a
    // data URL so the model can SEE it and decide placement. A ref we can't read
    // is skipped from the VISION parts (never blocks authoring) — but it stays
    // authorized (see allowedRefs below).
    const images = this.buildAuthorImages(job.projectId, job.input.images ?? []);
    // The authorized ref set is what the USER provided/approved (job.input.images),
    // NOT the subset buildAuthorImages could read into a vision data URL. A
    // transient FS error reading an approved asset for the model's vision part
    // would otherwise drop that ref from allowedRefs and silently STRIP the
    // user-picked image from the manifest (toEngineManifest keeps only allowed
    // refs). Authority comes from the user's pick; readability only governs what
    // the model gets to SEE. The strip below still removes refs the model invented
    // (never provided), which is its real purpose.
    const allowedRefs = new Set((job.input.images ?? []).map((i) => i.ref));

    const wordsPerSecond = await this.deps.wordsPerSecond?.(job.projectId);
    const offeredImages = images.length > 0 ? images : undefined;

    const chat = (selectedModel: string, messages: import("../gateway/ninerouter-client.js").ChatMessage[]) =>
      this.vision.chatWithVisionFallback(selectedModel, messages, signal);
    const planChat = (selectedModel: string, messages: import("../gateway/ninerouter-client.js").ChatMessage[]) =>
      this.vision.chatWithVisionFallback(selectedModel, messages, signal, CONTENT_PLAN_OUTPUT);

    let plannedContent;
    let contentPlanAdvisories;
    try {
      const contentPlan = await runContentPlan({
        model,
        projectId: job.projectId,
        input: job.input,
        research,
        // Enforce claim-provenance only for URL-grounded runs (including all-unreadable → []).
        // Text-only briefs omit the arg so existing plans without sourceRef stay valid.
        ...(job.input.urls.length > 0 ? { researchSources } : {}),
        offeredImages,
        wordsPerSecond,
        chat: planChat,
        callErrorMessage: authorCallErrorMessage,
        logger: this.logger(),
      });
      if (isCancelled(signal)) return { scenes: [], cancelled: true };
      if (!contentPlan.ok) {
        return { scenes: [], message: contentPlan.message, ...(unreadableUrls.length > 0 ? { unreadableUrls } : {}) };
      }
      plannedContent = contentPlan.contentPlan;
      contentPlanAdvisories = contentPlan.advisories;
    } catch (error) {
      if (isCancelled(signal, error)) return { scenes: [], cancelled: true };
      throw error;
    }
    const batchDecision = planAuthorBatching({
      sceneIds: plannedContent.scenes.map((scene) => scene.sceneId),
      imageCount: job.input.images?.length ?? 0,
    });
    if (batchDecision.mode === "too-large") {
      this.logger().error(
        {
          projectId: job.projectId,
          componentCount: batchDecision.componentIds.length,
          maxComponents: MAX_BATCHED_COMPONENTS,
          batchSize: AUTHOR_BATCH_SIZE,
          maxBatches: MAX_AUTHOR_BATCHES,
        },
        "content plan exceeds bounded authoring batch budget",
      );
      return { scenes: [], message: AUTHOR_BATCH_BUDGET_FAILURE, ...(unreadableUrls.length > 0 ? { unreadableUrls } : {}) };
    }

    let parsed: SuccessfulAuthorReply;
    if (batchDecision.mode === "batched") {
      const batched = await runBatchedAuthorReply({
        model,
        projectId: job.projectId,
        input: job.input,
        // Code authoring never receives raw research bodies.
        wordsPerSecond,
        contentPlan: plannedContent,
        contentPlanAdvisories,
        batches: batchDecision.batches,
        batchSize: AUTHOR_BATCH_SIZE,
        chat,
        callErrorMessage: authorCallErrorMessage,
        callLogger: log,
        logger: this.logger(),
      });
      if (isCancelled(signal)) return { scenes: [], cancelled: true };
      if (!batched.ok) return { scenes: [], message: batched.message, ...(unreadableUrls.length > 0 ? { unreadableUrls } : {}) };
      parsed = batched.parsed;
    } else {
      const authored = await runSingleAuthorReply({
        model,
        projectId: job.projectId,
        input: job.input,
        // Do not pass raw research into code authoring.
        offeredImages,
        wordsPerSecond,
        contentPlan: plannedContent,
        contentPlanAdvisories,
        chat,
        callErrorMessage: authorCallErrorMessage,
        callLogger: log,
        logger: this.logger(),
      });
      if (isCancelled(signal)) return { scenes: [], cancelled: true };
      if (!authored.ok) return { scenes: [], message: authored.message, ...(unreadableUrls.length > 0 ? { unreadableUrls } : {}) };
      parsed = authored.parsed;
    }

    // Build candidate in memory, then apply via failure-atomic transaction
    // (stage → admit staged → backup → promote). Never clear-first.
    const engineManifest = toEngineManifest(parsed.manifest, allowedRefs, {
      ...(job.input.format ? { format: job.input.format } : {}),
      ...(job.input.durationTier ? { durationTier: job.input.durationTier } : {}),
      ...(job.input.videoLanguage ? { videoLanguage: job.input.videoLanguage } : {}),
    });
    const modules = parsed.modules.map((mod) => ({
      componentId: mod.id,
      fileName: sceneFileName(mod.id),
      source: normalizeAuthoredSource(normalizeAuthoredFontSizes(normalizeAuthoredImports(mod.code))),
    }));
    const usableClaims = plannedContent.claims.filter((c) => c.confidence === "supported" && c.action === "use");
    const engineSceneIds = new Set(engineManifest.scenes.map((s) => s.id));
    const sceneLinks = plannedContent.scenes
      .filter((s) => engineSceneIds.has(s.sceneId))
      .map((s) => ({ sceneId: s.sceneId, evidenceClaimIds: s.evidenceClaimIds }));
    if (plannedContent.scenes.some((s) => !engineSceneIds.has(s.sceneId))) {
      this.logger().warn(
        { projectId: job.projectId },
        "content-plan scene ids did not fully match engine scenes; evidence scene links omitted for mismatches",
      );
    }
    const evidence = buildProjectEvidence({
      sources: researchSources,
      claims: usableClaims.map((c) => ({
        id: c.id,
        text: c.text,
        support: c.support,
        ...(c.sourceRef ? { sourceRef: c.sourceRef } : {}),
      })),
      scenes: sceneLinks,
    });

    const applied = await applyAuthoringCandidate({
      projectId: job.projectId,
      candidate: { manifest: engineManifest, modules, evidence },
      ...(signal ? { signal } : {}),
      deps: {
        // Staged paths only. Project-level admit is intentionally not a seam here.
        ...(this.deps.admitFiles ? { admitFiles: this.deps.admitFiles } : {}),
        onCommitted: async (info: { previousComponentIds: string[]; nextComponentIds: string[] }) => {
          for (const id of new Set([...info.previousComponentIds, ...info.nextComponentIds])) {
            unregisterComponent(id);
          }
        },
      },
    });

    if (applied.kind === "cancelled") {
      return { scenes: [], cancelled: true, ...(unreadableUrls.length > 0 ? { unreadableUrls } : {}) };
    }
    if (applied.kind === "rejected") {
      logAuthoringFailure(
        this.logger(),
        {
          class: "admission",
          projectId: job.projectId,
          violationCounts: countSafetyChecks(applied.violations),
          violations: applied.violations.map((v) => `${v.check} ${v.path ?? ""}: ${v.message}`),
        },
        "admission failed",
      );
      return { scenes: [], message: "Một số cảnh chưa hợp lệ. Hãy thử tạo lại." };
    }

    const reviewDir = projectPaths(job.projectId).reviewDir;
    const scenes: AuthoredScene[] = engineManifest.scenes.map((s) => ({
      sceneId: s.id,
      stillPath: join(reviewDir, `${s.id}.png`),
    }));
    return {
      scenes,
      ...(unreadableUrls.length > 0 ? { unreadableUrls } : {}),
      ...(researchWarning ? { sourceWarning: researchWarning } : {}),
    };
  }

  /**
   * Code-level self-repair: for each flagged scene, resolve its `.tsx`, ask the
   * AI to rewrite it (with the issue + current code, and — for layout/contrast
   * defects — the rendered still as an image), then overwrite + re-admit. If the
   * rewrite fails admission, the original code is restored so the project stays
   * renderable (atomic per scene).
   */
  async reauthor(projectId: string, targets: ReauthorTarget[], signal?: AbortSignal): Promise<{ scenes: AuthoredScene[] }> {
    const model = this.deps.model();
    if (!model) return { scenes: [] };
    const reviewDir = projectPaths(projectId).reviewDir;
    const admitOne = this.deps.admitOne ?? ((p: string) => admitAuthoredSceneFile(p));
    return runReauthor({
      model,
      projectId,
      targets,
      reviewDir,
      ...(signal ? { signal } : {}),
      loadManifest: (id) => loadManifest(id),
      resolveSceneFile,
      readText: (path) => readFile(path, "utf8"),
      writeText: (path, source) => writeFile(path, source, "utf8"),
      readStillDataUrl,
      chat: (selectedModel, messages, currentSignal) =>
        this.vision.chatWithVisionFallback(selectedModel, messages, currentSignal),
      admitOne,
      unregisterComponent,
      logger: log,
    });
  }

  /**
   * Read each provided image (already imported into the project `assetsDir` as
   * `assets/<sha>.<ext>`) into a data URL so the model can SEE it and decide
   * placement (create-time image staging). A ref we can't read on disk is skipped from the
   * vision parts only; image authorization is based on the user-approved refs
   * captured earlier, so a transient preview read failure never strips an
   * approved image from the final manifest.
   */
  private buildAuthorImages(projectId: string, refs: AuthorImageRef[]): AuthorImageInput[] {
    const root = projectPaths(projectId).root;
    const out: AuthorImageInput[] = [];
    for (const r of refs) {
      const abs = join(root, r.ref);
      try {
        if (!existsSync(abs)) continue;
        const ext = r.ref.split(".").pop()?.toLowerCase() ?? "png";
        const mime = ext === "jpg" ? "jpeg" : ext;
        const dataUrl = `data:image/${mime};base64,${readFileSync(abs).toString("base64")}`;
        out.push({ ref: r.ref, width: r.width, height: r.height, dataUrl });
      } catch (e) {
        // unreadable asset → skip; authoring continues without this image
        log.warn({ err: e, ref: r.ref }, "provided image unreadable; skipping from vision parts");
      }
    }
    return out;
  }

  async renderDraft(projectId: string, signal?: AbortSignal): Promise<{ ok: true } | { ok: false; error?: SerializedPipelineError }> {
    return renderDraftWithTools(this.renderTools(), projectId, signal);
  }

  /**
   * Fast per-scene stills (no TTS/MP4) — the cheap loop the silent refine pass
   * iterates on. Refreshes the registry first (same as a real render) so the
   * stills bundle THIS project's freshly-authored scenes. `sceneIds` scopes the
   * render to the scenes a refine pass just rewrote.
   */
  async renderStills(projectId: string, sceneIds?: string[], signal?: AbortSignal): Promise<{ stills: string[]; error?: SerializedPipelineError }> {
    return renderStillsWithTools(this.renderTools(), projectId, sceneIds, signal);
  }

  async renderFull(
    projectId: string,
    signal?: AbortSignal,
    opts?: { forceFull?: boolean },
  ): Promise<{ ok: true; outputPath: string } | { ok: false; error?: SerializedPipelineError }> {
    return renderFullWithTools(this.renderTools(), projectId, signal, opts);
  }

  async getSafetyReport(projectId: string): Promise<SafetyReportView> {
    return getSafetyReportWithTools(this.renderTools(), projectId);
  }

  /**
   * AI image preselection: ask the (vision) model which CRAWLED article images
   * actually illustrate the content, so the review screen can pre-tick them
   * (or, with human-review off, author uses exactly this set).
   * Reuses `buildAuthorImages` to read each ref → data URL, then intersects the
   * model's `keep` list with the provided refs (defense-in-depth, same spirit as
   * the manifest `allowedRefs` strip). Best-effort + model-dependent: no model,
   * no readable images, a vision failure, or an unparseable reply all yield `[]`
   * (no pre-selection — the review screen still works, author falls back to all).
   */
  async filterCrawledImages(
    projectId: string,
    articleText: string,
    refs: AuthorImageRef[],
    signal?: AbortSignal,
  ): Promise<string[]> {
    const model = this.deps.model();
    return runImageFilter({
      ...(model ? { model } : {}),
      projectId,
      articleText,
      refs,
      ...(signal ? { signal } : {}),
      isImageUnsupported: (selectedModel) => this.vision.isImageUnsupported(selectedModel),
      buildAuthorImages: (id, imageRefs) => this.buildAuthorImages(id, imageRefs),
      chat: (selectedModel, messages, currentSignal) =>
        this.vision.chatWithVisionFallback(selectedModel, messages, currentSignal, IMAGE_FILTER_OUTPUT),
      logger: log,
    });
  }

  /**
   * Crawl an article URL's images into the project `assetsDir` (article image crawl).
   * Fetches the page HTML through the SSRF-guarded TEXT fetcher, then hands it to
   * `crawlArticleImages` which downloads each candidate (binary SSRF fetcher),
   * imports content-addressed (caps + magic-byte sniff), and coarse-filters by
   * dimension. Best-effort: a page-fetch failure yields `[]` (crawl never blocks
   * authoring). Returns the local `assets/<sha>.<ext>` ref pool.
   */
  async crawlImages(projectId: string, url: string, signal?: AbortSignal): Promise<CrawledImage[]> {
    const destDir = projectPaths(projectId).assetsDir;
    return runArticleImageCrawler({
      url,
      destDir,
      ...(signal ? { signal } : {}),
      fetchPage: makeSafeFetch({
        ...(signal ? { signal } : {}),
        timeoutMs: DEFAULT_PAGE_FETCH_TIMEOUT_MS,
      }),
      crawlArticleImages: (html, pageUrl, outDir, opts) =>
        crawlArticleImagesWithStats(html, pageUrl, outDir, {
          ...(opts?.signal ? { signal: opts.signal } : signal ? { signal } : {}),
        }),
      logger: log,
    });
  }

  /**
   * AI visual-QA: ask the (vision) model to flag CLEAR layout defects on the
   * rendered scene stills — overlap, clipping, off-canvas, imbalance — that the
   * deterministic grid can't catch. `sceneIds` scopes the check (e.g. only the
   * scenes a user just edited); omit to check every scene. Returns a truthful
   * checked/skipped result. Skipped is advisory and non-blocking — never a hard
   * render/admission gate and never counted as a clean QA pass.
   */
  async visualQa(projectId: string, sceneIds?: string[], signal?: AbortSignal): Promise<VisualQaResult> {
    const model = this.deps.model();
    return runVisualQa({
      ...(model ? { model } : {}),
      projectId,
      ...(sceneIds ? { sceneIds } : {}),
      ...(signal ? { signal } : {}),
      reviewDir: projectPaths(projectId).reviewDir,
      loadManifest: (id) =>
        loadManifest(id).catch((error) => {
          this.logger().warn({ err: error, projectId: id }, "visual-QA manifest unreadable; QA skipped");
          return null;
        }),
      readStillDataUrl,
      // Full multimodal chat only — do not route through chatWithVisionFallback.
      chat: (selectedModel, messages, currentSignal) =>
        this.deps.client.chatStructured(selectedModel, messages, VISUAL_QA_OUTPUT, {
          apiKey: this.deps.apiKey(),
          ...(currentSignal ? { signal: currentSignal } : {}),
        }),
      logger: this.logger(),
    });
  }

  /** Snapshot the current authored source of the named scenes (for QA rollback). */
  async snapshotScenes(projectId: string, sceneIds: string[]): Promise<SceneSnapshot> {
    return snapshotAuthoredScenes({
      projectId,
      sceneIds,
      loadManifest: (id) =>
        loadManifest(id).catch((error) => {
          this.logger().warn({ err: error, projectId: id }, "scene manifest unreadable during snapshot resolution");
          return { scenes: [] };
        }),
      resolveSceneFile,
      readText: (path) => readFile(path, "utf8"),
      logger: this.logger(),
    });
  }

  /** Restore authored source from a snapshot + re-admit so the next render uses it. */
  async restoreScenes(projectId: string, snapshot: SceneSnapshot): Promise<void> {
    const admitOne = this.deps.admitOne ?? ((p: string) => admitAuthoredSceneFile(p));
    return restoreAuthoredScenes({
      projectId,
      snapshot,
      loadManifest: (id) =>
        loadManifest(id).catch((error) => {
          this.logger().warn({ err: error, projectId: id }, "scene manifest unreadable during restore resolution");
          return { scenes: [] };
        }),
      resolveSceneFile,
      writeText: (path, source) => writeFile(path, source, "utf8"),
      unregisterComponent,
      admitOne,
      logger: this.logger(),
    });
  }
}
