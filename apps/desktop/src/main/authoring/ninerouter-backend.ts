import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import {
  createLogger,
  admitProjectScenes,
  admitAuthoredSceneFile,
  loadManifest,
  projectPaths,
  writeAuthoredScene,
  writeJson,
  unregisterComponent,
  makeSafeFetch,
  crawlArticleImages,
  type CrawledImage,
  type AdmitProjectResult,
  type AuthoredRegistration,
  type SerializedPipelineError,
} from "@motionreal/pipeline";
import type { createTools } from "@motionreal/pipeline";
import type { AuthoringBackend, AuthoredScene, ReauthorTarget } from "../agent/custom-loop-worker.js";
import type { SafetyReportView } from "../agent/repair-loop.js";
import type { AuthorJob, VisualDefect, SceneSnapshot, AuthorImageRef } from "../agent/agent-worker.js";
import { GatewayChatError, type NineRouterClient, type ChatMessage } from "../gateway/ninerouter-client.js";
import { logAuthoringFailure } from "./authoring-failure.js";
import { countSafetyChecks, toEngineManifest } from "./author-manifest-convert.js";
import { type AuthorImageInput } from "./prompt.js";
import type { ContentPlan } from "./content-plan.js";
import { runContentPlan } from "./content-plan-runner.js";
import { runBatchedAuthorReply, runSingleAuthorReply, type SuccessfulAuthorReply } from "./author-reply-runner.js";
import { runReauthor } from "./reauthor-runner.js";
import { runImageFilter } from "./image-filter-runner.js";
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
    // Non-retryable HTTP (e.g. 4xx). 401/403 with a "reset after" window is the
    // upstream provider account being rate-limited / quota-locked (NOT a wrong
    // model id) — surface the wait window + the "switch model" escape so the user
    // doesn't hunt through Settings for a config error that isn't there.
    if (e.status === 401 || e.status === 403 || e.status === 429) {
      const reset = /reset after ([^)"]+)/i.exec(e.message)?.[1]?.trim();
      const when = reset ? `Hạn mức sẽ mở lại sau ~${reset}.` : "Hạn mức sẽ tự mở lại sau một lúc.";
      return `Tài khoản của model đang bị giới hạn tạm thời (hết hạn mức / quá tải từ nhà cung cấp). ${when} Hãy chờ rồi thử lại, hoặc đổi sang model/tài khoản khác trong Cài đặt.`;
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
   * Admit a project's authored scenes (injectable for tests). The default is a
   * pure AST gate; authored code is never imported into the Electron/Node host.
   */
  admit?: (projectId: string) => Promise<AdmitProjectResult>;
  /** Admit ONE authored module (injectable for tests; reauthor path). */
  admitOne?: (tsxPath: string) => Promise<AuthoredRegistration>;
  /** Optional structured logger override for focused backend observability tests. */
  logger?: AuthoringLogger;
};

function manifestPathOf(projectId: string): string {
  return projectPaths(projectId).manifest;
}

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
  constructor(private readonly deps: NineRouterBackendDeps) {}

  private logger(): AuthoringLogger {
    return this.deps.logger ?? log;
  }

  /**
   * Model ids that rejected an INLINE image this session (vision-capable model
   * hardening). Some providers behind 9router (e.g. `kr/auto` routing to Kiro)
   * answer an `image_url` data-URL part with HTTP 400 "Improperly formed
   * request" — and a 400 trips 9router's ~2-minute circuit breaker, which then
   * fails EVERY following call (even text-only authoring) until it resets. Once
   * we see that, we remember the model can't take images and send text-only
   * DIRECTLY from then on — so we never trip the breaker a second time. Per
   * process (capabilities don't change mid-session); cleared on restart.
   */
  private readonly imageUnsupportedModels = new Set<string>();

  /** A 400 that means "this provider can't take the inline image", not a transient blip. */
  private isImageRejection(e: unknown): boolean {
    return e instanceof GatewayChatError && e.kind === "http" && e.status === 400;
  }

  async authorScenes(job: AuthorJob): Promise<{ scenes: AuthoredScene[]; message?: string; unreadableUrls?: string[] }> {
    const model = this.deps.model();
    if (!model) return { scenes: [], message: "Chưa chọn model AI." };

    // Best-effort grounding: fetch any links in the brief. A failed fetch is NOT
    // fatal — authoring continues from the user's text + the model's knowledge.
    const chunks: string[] = [];
    const unreadableUrls: string[] = [];
    for (const url of job.input.urls) {
      const ing = await this.deps.tools.ingest_url({ url }).catch((error) => {
        log.warn({ err: error, url }, "URL ingest threw; authoring will continue without article text");
        return null;
      });
      // ingest_url returns an IngestResult ({ researchPath, metadata, wordCount });
      // the extracted article (text + provenance header) is written to that file —
      // the body is NOT inlined in the result. Read the research file to ground the
      // author prompt. (A prior version read `ing.data.text`, which never exists, so
      // EVERY link was silently treated as unreadable even on a clean fetch.)
      let body: string | undefined;
      if (ing && ing.ok) {
        body = await readFile(ing.data.researchPath, "utf8").catch((error) => {
          log.warn({ err: error, url, researchPath: ing.data.researchPath }, "ingested article file unreadable");
          return undefined;
        });
      }
      if (body && body.trim()) {
        chunks.push(`# ${url}\n${body.trim()}`);
      } else {
        unreadableUrls.push(url);
        const reason = ing && !ing.ok ? `${ing.error.stage}: ${ing.error.cause}` : "no readable article text";
        log.warn({ url, reason }, "could not read link; skipping; authoring continues");
      }
    }
    const research = chunks.length > 0 ? chunks.join("\n\n---\n\n") : undefined;

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

    const contentPlan = await runContentPlan({
      model,
      projectId: job.projectId,
      input: job.input,
      research,
      offeredImages,
      wordsPerSecond,
      chat: (selectedModel, messages) => this.chatWithVisionFallback(selectedModel, messages),
      callErrorMessage: authorCallErrorMessage,
      logger: this.logger(),
    });
    if (!contentPlan.ok) {
      return { scenes: [], message: contentPlan.message, ...(unreadableUrls.length > 0 ? { unreadableUrls } : {}) };
    }
    const plannedContent = contentPlan.contentPlan;
    const contentPlanAdvisories = contentPlan.advisories;

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
        research,
        wordsPerSecond,
        contentPlan: plannedContent,
        contentPlanAdvisories,
        batches: batchDecision.batches,
        batchSize: AUTHOR_BATCH_SIZE,
        chat: (selectedModel, messages) => this.chatWithVisionFallback(selectedModel, messages),
        callErrorMessage: authorCallErrorMessage,
        callLogger: log,
        logger: this.logger(),
      });
      if (!batched.ok) return { scenes: [], message: batched.message, ...(unreadableUrls.length > 0 ? { unreadableUrls } : {}) };
      parsed = batched.parsed;
    } else {
      const authored = await runSingleAuthorReply({
        model,
        projectId: job.projectId,
        input: job.input,
        research,
        offeredImages,
        wordsPerSecond,
        contentPlan: plannedContent,
        contentPlanAdvisories,
        chat: (selectedModel, messages) => this.chatWithVisionFallback(selectedModel, messages),
        callErrorMessage: authorCallErrorMessage,
        callLogger: log,
        logger: this.logger(),
      });
      if (!authored.ok) return { scenes: [], message: authored.message, ...(unreadableUrls.length > 0 ? { unreadableUrls } : {}) };
      parsed = authored.parsed;
    }

    // Write each AI-authored module. Unregister first so a re-authored id (or a
    // cross-project id collision in the process-wide registry) is refreshed with
    // THIS project's code at admission time.
    await this.clearAuthoredSceneFiles(job.projectId);
    for (const mod of parsed.modules) {
      unregisterComponent(mod.id);
      await writeAuthoredScene(job.projectId, sceneFileName(mod.id), normalizeAuthoredFontSizes(normalizeAuthoredImports(mod.code)));
    }
    const engineManifest = toEngineManifest(parsed.manifest, allowedRefs, {
      ...(job.input.format ? { format: job.input.format } : {}),
      ...(job.input.durationTier ? { durationTier: job.input.durationTier } : {}),
      ...(job.input.videoLanguage ? { videoLanguage: job.input.videoLanguage } : {}),
    });
    await writeJson(manifestPathOf(job.projectId), engineManifest);

    const admit = this.deps.admit ?? ((id: string) => admitProjectScenes(id));
    const admitted = await admit(job.projectId);
    if (!admitted.ok) {
      logAuthoringFailure(
        this.logger(),
        {
          class: "admission",
          projectId: job.projectId,
          violationCounts: countSafetyChecks(admitted.violations),
          violations: admitted.violations.map((v) => `${v.check} ${v.path}: ${v.message}`),
        },
        "admission failed",
      );
      // NO kit fallback — pure-author surfaces the failure for retry / AI-fix.
      return { scenes: [], message: "Một số cảnh chưa hợp lệ. Hãy thử tạo lại." };
    }

    const reviewDir = projectPaths(job.projectId).reviewDir;
    const scenes: AuthoredScene[] = engineManifest.scenes.map((s) => ({
      sceneId: s.id,
      stillPath: join(reviewDir, `${s.id}.png`),
    }));
    return { scenes, ...(unreadableUrls.length > 0 ? { unreadableUrls } : {}) };
  }

  private async clearAuthoredSceneFiles(projectId: string): Promise<void> {
    const dir = projectPaths(projectId).authoredDir;
    if (!existsSync(dir)) return;
    const files = await readdir(dir);
    await Promise.all(
      files
        .filter((file) => /\.tsx$/.test(file) && !file.startsWith("_"))
        .map((file) => rm(join(dir, file), { force: true })),
    );
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
      chat: (selectedModel, messages, currentSignal) => this.chatWithVisionFallback(selectedModel, messages, currentSignal),
      admitOne,
      unregisterComponent,
      logger: log,
    });
  }

  /**
   * Clear any stale host-registry entries left by older sessions/tests. Current
   * admission no longer imports authored code into the host; render-time
   * registration happens inside the generated Remotion entry.
   */
  private async refreshRegistry(projectId: string): Promise<void> {
    try {
      const m = await loadManifest(projectId);
      for (const s of m.scenes) unregisterComponent(s.component);
    } catch (e) {
      // best-effort: a missing/unreadable manifest just means nothing to clear
      log.debug({ err: e, projectId }, "refreshRegistry: no manifest to clear");
    }
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

  /** Flatten any multimodal (vision) message to text-only (drop image parts). */
  private toTextOnly(messages: ChatMessage[]): ChatMessage[] {
    return messages.map((m) => ({
      role: m.role,
      content: Array.isArray(m.content)
        ? m.content.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n")
        : m.content,
    }));
  }

  /**
   * Call the model with vision parts, degrading to text-only safely
   * (vision-capable model hardening). Key behaviors:
   * - if the chosen model already rejected an inline image THIS session, skip
   * vision and send text-only DIRECTLY — never re-trip 9router's ~2-minute
   * circuit breaker (a 400 there fails every following call, even authoring);
   * - on a 400 "improperly formed" from a call that carried an image, remember
   * the model can't take images, then retry text-only;
   * - a non-image failure (or a text-only message) is rethrown unchanged.
   */
  private async chatWithVisionFallback(model: string, messages: ChatMessage[], signal?: AbortSignal): Promise<string> {
    const apiKey = this.deps.apiKey();
    const hasImage = messages.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === "image_url"));

    // Known image-incapable model → don't even attempt vision (avoid the breaker).
    if (hasImage && this.imageUnsupportedModels.has(model)) {
      return this.deps.client.chat(model, this.toTextOnly(messages), { apiKey, ...(signal ? { signal } : {}) });
    }
    try {
      return await this.deps.client.chat(model, messages, { apiKey, ...(signal ? { signal } : {}) });
    } catch (e) {
      if (!hasImage) throw e;
      // The image part is what the provider choked on → remember it so future
      // calls skip vision, then retry this one text-only.
      if (this.isImageRejection(e)) {
        this.imageUnsupportedModels.add(model);
        log.warn({ model }, "model rejected an inline image (HTTP 400); using text-only for it this session");
      } else {
        log.warn({ err: e }, "vision chat failed; retrying text-only");
      }
      return this.deps.client.chat(model, this.toTextOnly(messages), { apiKey, ...(signal ? { signal } : {}) });
    }
  }

  async renderDraft(projectId: string, signal?: AbortSignal): Promise<{ ok: true } | { ok: false; error?: SerializedPipelineError }> {
    await this.refreshRegistry(projectId);
    const res = await this.deps.tools.render_draft(
      { projectId },
      this.deps.onRenderProgress ? (r) => this.deps.onRenderProgress!(r, projectId) : undefined,
      signal,
    );
    if (!res.ok) {
      log.error({ projectId, stage: res.error.stage, cause: res.error.cause }, "render_draft failed");
      // Carry the engine error so the repair loop can route infra vs content.
      return { ok: false, error: res.error };
    }
    log.info({ projectId, mp4Path: (res.data as { mp4Path?: string }).mp4Path ?? "(draft)" }, "render_draft OK");
    return { ok: true };
  }

  /**
   * Fast per-scene stills (no TTS/MP4) — the cheap loop the silent refine pass
   * iterates on. Refreshes the registry first (same as a real render) so the
   * stills bundle THIS project's freshly-authored scenes. `sceneIds` scopes the
   * render to the scenes a refine pass just rewrote.
   */
  async renderStills(projectId: string, sceneIds?: string[], signal?: AbortSignal): Promise<{ stills: string[] }> {
    await this.refreshRegistry(projectId);
    const res = await this.deps.tools.render_stills(
      { projectId, ...(sceneIds && sceneIds.length > 0 ? { sceneIds } : {}) },
      undefined,
      signal,
    );
    if (!res.ok) {
      log.error({ projectId, stage: res.error.stage, cause: res.error.cause }, "render_stills failed");
      return { stills: [] };
    }
    return { stills: res.data.stills };
  }

  async renderFull(projectId: string, signal?: AbortSignal): Promise<{ ok: true; outputPath: string } | { ok: false; error?: SerializedPipelineError }> {
    await this.refreshRegistry(projectId);
    const res = await this.deps.tools.render_full(
      { projectId },
      this.deps.onRenderProgress ? (r) => this.deps.onRenderProgress!(r, projectId) : undefined,
      signal,
    );
    if (!res.ok) {
      log.error({ projectId, stage: res.error.stage, cause: res.error.cause }, "render_full failed");
      return { ok: false, error: res.error };
    }
    const outputPath = (res.data as { mp4Path?: string }).mp4Path ?? "";
    log.info({ projectId, outputPath }, "render_full OK");
    return { ok: true, outputPath };
  }

  async getSafetyReport(projectId: string): Promise<SafetyReportView> {
    const res = await this.deps.tools.get_safety_report({ projectId });
    if (!res.ok) {
      log.error({ projectId, cause: res.error.cause }, "get_safety_report failed");
      return { ok: false, hardErrors: [], warnings: [] };
    }
    // N24/N25 are the REVIEW tier (human/agent self-critique + contact sheet),
    // confirmed before final publish — NOT auto-detectable draft defects. They
    // are unconfirmed by default, so they must not block the draft repair loop
    // (which only gates on the auto-run render oracles). The draft is "passed"
    // once the real oracles are clean; the checklist belongs to the approve step.
    const reviewTier = new Set(["N24", "N25"]);
    const hardErrors = res.data.hardErrors.filter((e) => !reviewTier.has(e.check));
    if (hardErrors.length > 0) {
      log.error(
        { projectId, hardErrors: hardErrors.map((e) => `${e.check}${e.sceneId ? ` @${e.sceneId}` : ""}: ${e.message}`) },
        "safety grid HARD errors",
      );
    }
    return { ok: hardErrors.length === 0, hardErrors, warnings: res.data.warnings };
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
      isImageUnsupported: (selectedModel) => this.imageUnsupportedModels.has(selectedModel),
      buildAuthorImages: (id, imageRefs) => this.buildAuthorImages(id, imageRefs),
      chat: (selectedModel, messages, currentSignal) => this.chatWithVisionFallback(selectedModel, messages, currentSignal),
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
      fetchPage: makeSafeFetch(),
      crawlArticleImages,
      logger: log,
    });
  }

  /**
   * AI visual-QA: ask the (vision) model to flag CLEAR layout defects on the
   * rendered scene stills — overlap, clipping, off-canvas, imbalance — that the
   * deterministic grid can't catch. `sceneIds` scopes the check (e.g. only the
   * scenes a user just edited); omit to check every scene. Best-effort and
   * model-dependent: no model, no stills, a vision failure, or an unparseable
   * reply all yield `[]` (skip QA, never block the pipeline).
   */
  async visualQa(projectId: string, sceneIds?: string[], signal?: AbortSignal): Promise<VisualDefect[]> {
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
        this.deps.client.chat(selectedModel, messages, {
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
