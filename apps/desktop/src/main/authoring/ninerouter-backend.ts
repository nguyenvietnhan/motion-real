import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import {
  createLogger,
  admitProjectAuthored,
  admitAuthoredSceneFile,
  admitAuthoredTransitionFile,
  loadManifest,
  projectPaths,
  writeAuthoredScene,
  writeJson,
  unregisterComponent,
  unregisterTransition,
  manifestBoundaryTransitionIds,
  transitionFileName,
  makeSafeFetch,
  crawlArticleImages,
  appendEvent,
  type CrawledImage,
  type Manifest,
  type ManifestScene,
  type AdmitProjectAuthoredResult,
  type AuthoredRegistration,
  type AuthoredTransitionRegistration,
  type SafetyIssue,
  type SerializedPipelineError,
  DEFAULT_TRANSITION_SAMPLE_FRACTIONS,
  transitionSampleFileName,
  typecheckAuthoredScenes,
  workspaceRoot,
  resolveVideoRenderer,
  admitProjectHyperframes,
  writeHyperframesScene,
} from "@news/pipeline";
import type { createTools } from "@news/mcp";
import type { AuthoringBackend, AuthoredScene, ReauthorTarget } from "../agent/custom-loop-worker.js";
import type { SafetyReportView } from "../agent/repair-loop.js";
import type { AuthorJob, VisualDefect, SceneSnapshot, AuthorImageRef, TransitionAuthorOutcome, TransitionDefect } from "../agent/agent-worker.js";
import { GatewayChatError, type NineRouterClient, type ChatMessage } from "../gateway/ninerouter-client.js";
import {
  buildAuthorMessages,
  buildBoundaryTransitionMessages,
  buildTransitionDirectorMessages,
  buildTransitionQaMessages,
  buildReauthorMessages,
  buildVisualQaMessages,
  buildImageFilterMessages,
  type AuthorImageInput,
  type TransitionPromptScene,
} from "./prompt.js";
import { parseAuthorReply, parseHyperframesAuthorReply } from "./reply-parser.js";
import { parseReauthorReply, parseTransitionReply } from "./reply-parser.js";
import type { AuthorManifest } from "./manifest-schema.js";
import { extractJsonObject } from "./manifest-schema.js";
import { sceneFileName, resolveSceneFile } from "./scene-files.js";
import { normalizeAuthoredImports } from "./normalize-imports.js";
import { normalizeAuthoredFontSizes } from "./normalize-fontsize.js";
import type { VideoFormat, DurationTier, VideoLanguage } from "@news/schema";

/**
 * Pure-AUTHOR authoring backend (desktop-author-mode). The AI writes FRESH `.tsx`
 * scene modules per topic (no fixed kit): it returns a manifest + one `.tsx` code
 * block per scene id; we write each module, admit them through the gate, and
 * render. Drives the SAME `@news/mcp` tools / single registry.
 */

type Tools = ReturnType<typeof createTools>;

/** Scope-tagged structured logger for the authoring backend (library-adoption pilot). */
const log = createLogger("authoring");

/**
 * Phrase an AI-call failure in plain Vietnamese, by KIND, so the user knows which
 * layer hiccuped and whether retrying helps — instead of one generic "timeout or
 * lost connection" line for every failure. Mirrors the gateway's `chat()` retry:
 * a "transient" error is only thrown AFTER auto-retries are exhausted, so its
 * message says "still failing after several tries".
 */
export function authorCallErrorMessage(e: unknown): string {
  if (e instanceof GatewayChatError) {
    if (e.kind === "timeout") {
      return "Model phản hồi quá lâu (hết thời gian chờ). Model có thể đang quá tải — hãy thử lại hoặc chọn model khác.";
    }
    if (e.kind === "transient") {
      return "9Router/model tạm thời không phản hồi (thường do model đang khởi động). Đã thử lại vài lần nhưng chưa được — hãy chờ chút rồi thử lại, hoặc đổi model.";
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
   * Admit a project's authored modules (injectable for tests). The default is a
   * pure AST gate; authored code is never imported into the Electron/Node host.
   */
  admit?: (projectId: string) => Promise<AdmitProjectAuthoredResult>;
  /** Admit ONE authored module (injectable for tests; reauthor path). */
  admitOne?: (tsxPath: string) => Promise<AuthoredRegistration>;
  /** Admit ONE authored transition module (injectable for tests; boundary transition path). */
  admitTransitionOne?: (tsxPath: string) => Promise<AuthoredTransitionRegistration>;
  /** Typecheck ONE transition module (injectable for tests). */
  typecheckTransition?: (tsxPath: string) => SafetyIssue[];
};

function manifestPathOf(projectId: string): string {
  return projectPaths(projectId).manifest;
}

/**
 * Vision-guided repair applies to the layout pixel oracle (N14 content-zone /
 * caption-clearance) — the only HARD pixel error that reaches the repair loop.
 * Contrast (N18) is advisory (warning severity) and never arrives as a hard
 * error here, so it does not drive vision repair.
 */
function needsVision(issues?: SafetyIssue[]): boolean {
  return (issues ?? []).some((i) => i.check === "N14");
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

/** Engine ThemeSpec limits: dominant must be 6-digit hex, mood ≤40 chars. */
const HEX6 = /^#[0-9a-fA-F]{6}$/;
function sanitizeTheme(theme: { dominant: string; mood?: string }): { dominant: string; mood?: string } {
  const dominant = HEX6.test(theme.dominant.trim()) ? theme.dominant.trim() : "#1E9CB0";
  const mood = (theme.mood ?? "").trim().slice(0, 40);
  return {
    dominant,
    ...(mood ? { mood } : {}),
  };
}

/**
 * AuthorManifest (open-id, pure-author) → engine Manifest with sequential scene
 * ids. `allowedRefs` is the set of image refs we actually provided to the model;
 * any scene `image.ref` NOT in that set is a hallucinated path and is DROPPED
 * (defense-in-depth so an invented ref never reaches the manifest/render — the
 * N9 build existence check is the backstop). Empty set ⇒ no images were offered,
 * so every `image` is dropped.
 *
 * `delivery` carries the three create-screen knobs the USER picked (the AI never
 * authors them — it only writes `theme.dominant`/`mood` + the scenes). We inject
 * `format` / `durationTier` / `videoLanguage` into the engine manifest here so the
 * canvas + caption presence + word-budget + authored content language are driven by the
 * user's choice, defaulting to tiktok / undefined / vi.
 */
function toEngineManifest(
  m: AuthorManifest,
  allowedRefs: ReadonlySet<string> = new Set(),
  delivery: { format?: VideoFormat; durationTier?: DurationTier; videoLanguage?: VideoLanguage } = {},
): Manifest {
  const scenes: ManifestScene[] = m.scenes.map((s, i) => {
    const keepImage = s.image && allowedRefs.has(s.image.ref);
    if (s.image && !keepImage) {
      log.warn({ sceneIndex: i + 1, ref: s.image.ref }, "dropping scene image with non-provided ref");
    }
    return {
      id: `scene-${String(i + 1).padStart(2, "0")}`,
      component: s.component,
      eyebrow: s.eyebrow,
      headline: s.headline,
      narration: s.narration,
      props: s.props ?? {},
      ...(s.body ? { body: s.body } : {}),
      ...(keepImage ? { image: { ref: s.image!.ref, ...(s.image!.alt ? { alt: s.image!.alt } : {}) } } : {}),
      ...(s.transitionToNext ? { transitionToNext: s.transitionToNext } : {}),
    };
  });
  // Clamp to the engine VideoSpec limits so AI variance never trips schema
  // validation: title ≤140, theme.dominant hex, theme.mood ≤40. The delivery
  // knobs are injected from the user's UI choice, never authored by the model.
  return {
    title: m.title.slice(0, 140),
    ...(m.hashtags && m.hashtags.length > 0 ? { hashtags: m.hashtags } : {}),
    theme: sanitizeTheme(m.theme),
    ...(delivery.format ? { format: delivery.format } : {}),
    ...(delivery.durationTier ? { durationTier: delivery.durationTier } : {}),
    ...(delivery.videoLanguage ? { videoLanguage: delivery.videoLanguage } : {}),
    scenes,
  } as Manifest;
}

export class NineRouterAuthoringBackend implements AuthoringBackend {
  constructor(private readonly deps: NineRouterBackendDeps) {}

  /**
   * Model ids that rejected an INLINE image this session (Phase 2 Block B
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

    // Provided images (Phase 2 Block A): read each already-imported asset into a
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
    const messages = buildAuthorMessages(job.input, research, images.length > 0 ? images : undefined, wordsPerSecond);
    let reply: string;
    try {
      log.info({ model, projectId: job.projectId }, "calling AI model for authoring");
      reply = await this.chatWithVisionFallback(model, messages);
      log.info({ projectId: job.projectId, replyChars: reply.length }, "AI replied");
    } catch (e) {
      log.error({ err: e, projectId: job.projectId }, "AI call failed");
      return { scenes: [], message: authorCallErrorMessage(e) };
    }

    const useHyperframes = resolveVideoRenderer(job.input.format ?? "tiktok") === "hyperframes";
    const parsed = useHyperframes ? parseHyperframesAuthorReply(reply) : parseAuthorReply(reply);
    if (!parsed.ok) {
      log.error(
        { projectId: job.projectId, renderer: useHyperframes ? "hyperframes" : "remotion", reason: parsed.reason, detail: parsed.detail, rawReply: reply.slice(0, 2000) },
        "author-reply parse failed",
      );
      return { scenes: [], message: "AI chưa trả về kịch bản hợp lệ. Hãy thử lại hoặc mô tả rõ hơn." };
    }

    const engineManifest = toEngineManifest(parsed.manifest, allowedRefs, {
      ...(job.input.format ? { format: job.input.format } : {}),
      ...(job.input.durationTier ? { durationTier: job.input.durationTier } : {}),
      ...(job.input.videoLanguage ? { videoLanguage: job.input.videoLanguage } : {}),
    });
    if (useHyperframes) {
      const hyperframesParsed = parsed as { ok: true; manifest: AuthorManifest; scenes: { sceneId: string; html: string }[] };
      await this.clearHyperframesSceneFiles(job.projectId);
      await this.writeHyperframesDesign(job.projectId, engineManifest);
      await appendEvent(job.projectId, {
        type: "hyperframes.design",
        phase: "done",
        path: projectPaths(job.projectId).hyperframesDesign,
      });
      for (const scene of hyperframesParsed.scenes) {
        await writeHyperframesScene(job.projectId, scene.sceneId, scene.html);
      }
    } else {
      const remotionParsed = parsed as { ok: true; manifest: AuthorManifest; modules: { id: string; code: string }[] };
      // Write each AI-authored module. Unregister first so a re-authored id (or a
      // cross-project id collision in the process-wide registry) is refreshed with
      // THIS project's code at admission time.
      await this.clearAuthoredSceneFiles(job.projectId);
      for (const mod of remotionParsed.modules) {
        unregisterComponent(mod.id);
        await writeAuthoredScene(job.projectId, sceneFileName(mod.id), normalizeAuthoredFontSizes(normalizeAuthoredImports(mod.code)));
      }
    }
    await writeJson(manifestPathOf(job.projectId), engineManifest);

    const admitted = useHyperframes
      ? await admitProjectHyperframes(job.projectId, engineManifest)
      : await (this.deps.admit ?? ((id: string) => admitProjectAuthored(id)))(job.projectId);
    if (!admitted.ok) {
      log.error(
        { projectId: job.projectId, violations: admitted.violations.map((v) => v.check + " " + v.path + ": " + v.message) },
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

  async prepareTransitions(projectId: string, sceneIds?: string[], signal?: AbortSignal): Promise<TransitionAuthorOutcome> {
    const model = this.deps.model();
    if (!model) return { authoredBoundaryIds: [], failedBoundaryIds: [] };

    const manifest = await loadManifest(projectId).catch((error) => {
      log.warn({ err: error, projectId }, "transition authoring skipped: manifest unreadable");
      return null;
    });
    if (!manifest || manifest.scenes.length < 2) return { authoredBoundaryIds: [], failedBoundaryIds: [] };
    if (resolveVideoRenderer(manifest.format ?? "tiktok") === "hyperframes") {
      return { authoredBoundaryIds: [], failedBoundaryIds: [] };
    }

    const scenes = await this.readTransitionPromptScenes(projectId);
    if (scenes.length < 2) return { authoredBoundaryIds: [], failedBoundaryIds: manifestBoundaryTransitionIds(manifest) };
    const wanted = new Set(this.boundaryIdsForScope(manifest, sceneIds));
    if (wanted.size === 0) return { authoredBoundaryIds: [], failedBoundaryIds: [] };

    const plan = await this.transitionDirectorPlan(projectId, scenes, signal);
    const authored = new Set<string>();
    const failed = new Set<string>();
    const sceneById = new Map(scenes.map((scene) => [scene.id, scene] as const));

    for (let i = 0; i < manifest.scenes.length - 1; i += 1) {
      if (signal?.aborted) break;
      const from = manifest.scenes[i]!;
      const to = manifest.scenes[i + 1]!;
      const boundaryId = `${from.id}-to-${to.id}`;
      if (!wanted.has(boundaryId)) continue;
      const fromScene = sceneById.get(from.id);
      const toScene = sceneById.get(to.id);
      if (!fromScene || !toScene) {
        failed.add(boundaryId);
        continue;
      }
      const ok = await this.authorOneBoundaryTransition(projectId, {
        model,
        boundaryId,
        fromScene,
        toScene,
        format: manifest.format,
        videoLanguage: manifest.videoLanguage,
        plan: plan.get(boundaryId),
        signal,
      });
      if (ok) authored.add(boundaryId);
      else failed.add(boundaryId);
    }

    if (signal?.aborted) return { authoredBoundaryIds: [...authored], failedBoundaryIds: [...failed] };

    const samples = await this.renderTransitionSamples(projectId, [...wanted], signal);
    const defects = await this.transitionVisualQa(projectId, samples, signal);
    for (const defect of defects) {
      if (signal?.aborted) break;
      const parts = this.scenesForBoundary(defect.boundaryId, scenes);
      if (!parts) continue;
      const currentCode = await this.readTransitionCode(projectId, defect.boundaryId);
      const ok = await this.authorOneBoundaryTransition(projectId, {
        model,
        boundaryId: defect.boundaryId,
        fromScene: parts.fromScene,
        toScene: parts.toScene,
        format: manifest.format,
        videoLanguage: manifest.videoLanguage,
        plan: plan.get(defect.boundaryId),
        feedback: defect.issue,
        currentCode,
        samples: samples.get(defect.boundaryId),
        signal,
      });
      if (ok) {
        authored.add(defect.boundaryId);
        failed.delete(defect.boundaryId);
      } else {
        failed.add(defect.boundaryId);
      }
    }

    return { authoredBoundaryIds: [...authored], failedBoundaryIds: [...failed] };
  }

  private async readTransitionPromptScenes(projectId: string): Promise<TransitionPromptScene[]> {
    const manifest = await loadManifest(projectId);
    const out: TransitionPromptScene[] = [];
    for (const scene of manifest.scenes) {
      const resolved = await resolveSceneFile(projectId, scene.id, (id) => loadManifest(id).catch((error) => {
        log.warn({ err: error, projectId: id, sceneId: scene.id }, "scene manifest unreadable during transition source resolution");
        return { scenes: [] };
      }));
      if (!resolved) {
        log.warn({ projectId, sceneId: scene.id, component: scene.component }, "transition authoring cannot resolve scene source");
        continue;
      }
      const code = await readFile(resolved.path, "utf8").catch((error) => {
        log.warn({ err: error, projectId, sceneId: scene.id, path: resolved.path }, "transition authoring cannot read scene source");
        return "";
      });
      out.push({
        id: scene.id,
        component: scene.component,
        headline: scene.headline,
        narration: scene.narration,
        props: scene.props ?? {},
        code,
        ...(scene.eyebrow ? { eyebrow: scene.eyebrow } : {}),
        ...(scene.body ? { body: scene.body } : {}),
      });
    }
    return out;
  }

  private boundaryIdsForScope(manifest: Manifest, sceneIds?: string[]): string[] {
    const scope = sceneIds && sceneIds.length > 0 ? new Set(sceneIds) : null;
    const ids: string[] = [];
    for (let i = 0; i < manifest.scenes.length - 1; i += 1) {
      const from = manifest.scenes[i]!;
      const to = manifest.scenes[i + 1]!;
      if (scope && !scope.has(from.id) && !scope.has(to.id)) continue;
      ids.push(`${from.id}-to-${to.id}`);
    }
    return ids;
  }

  private async transitionDirectorPlan(projectId: string, scenes: TransitionPromptScene[], signal?: AbortSignal): Promise<Map<string, string>> {
    const model = this.deps.model();
    if (!model) return new Map();
    const manifest = await loadManifest(projectId).catch((error) => {
      log.warn({ err: error, projectId }, "transition director manifest unreadable; using default delivery context");
      return null;
    });
    const messages = buildTransitionDirectorMessages({
      format: manifest?.format,
      videoLanguage: manifest?.videoLanguage,
      scenes,
    });
    try {
      const reply = await this.chatWithVisionFallback(model, messages, signal);
      const json = extractJsonObject(reply);
      if (!json) return new Map();
      const parsed = JSON.parse(json) as { boundaries?: unknown };
      if (!Array.isArray(parsed.boundaries)) return new Map();
      const out = new Map<string, string>();
      for (const item of parsed.boundaries) {
        const o = item as { id?: unknown; concept?: unknown; risk?: unknown };
        if (typeof o.id !== "string" || typeof o.concept !== "string") continue;
        out.set(o.id, [o.concept, typeof o.risk === "string" && o.risk.trim() ? `Risk: ${o.risk}` : ""].filter(Boolean).join("\n"));
      }
      return out;
    } catch (error) {
      log.warn({ err: error, projectId }, "transition director plan failed; continuing without it");
      return new Map();
    }
  }

  private async authorOneBoundaryTransition(
    projectId: string,
    input: {
      model: string;
      boundaryId: string;
      fromScene: TransitionPromptScene;
      toScene: TransitionPromptScene;
      format?: Manifest["format"];
      videoLanguage?: Manifest["videoLanguage"];
      plan?: string;
      feedback?: string;
      currentCode?: string;
      samples?: { fraction: number; dataUrl: string }[];
      signal?: AbortSignal;
    },
  ): Promise<boolean> {
    const path = join(projectPaths(projectId).authoredDir, transitionFileName(input.boundaryId));
    const original = existsSync(path) ? await readFile(path, "utf8").catch((error) => {
      log.warn({ err: error, projectId, boundaryId: input.boundaryId, path }, "existing transition source unreadable; treating as absent");
      return undefined;
    }) : undefined;
    const admitOne = this.deps.admitTransitionOne ?? ((tsxPath: string) => admitAuthoredTransitionFile(tsxPath));
    let feedback = input.feedback;
    const MAX_ATTEMPTS = 2;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      if (input.signal?.aborted) return false;
      let reply: string;
      try {
        reply = await this.chatWithVisionFallback(
          input.model,
          buildBoundaryTransitionMessages({
            boundaryId: input.boundaryId,
            fromScene: input.fromScene,
            toScene: input.toScene,
            ...(input.format ? { format: input.format } : {}),
            ...(input.videoLanguage ? { videoLanguage: input.videoLanguage } : {}),
            ...(input.plan ? { plan: input.plan } : {}),
            ...(feedback ? { feedback } : {}),
            ...(input.currentCode ? { currentCode: input.currentCode } : {}),
            ...(input.samples && input.samples.length > 0 ? { samples: input.samples } : {}),
          }),
          input.signal,
        );
      } catch (error) {
        log.warn({ err: error, projectId, boundaryId: input.boundaryId, attempt: attempt + 1 }, "transition AI call failed");
        feedback = `Lần trước AI call bị lỗi: ${error instanceof Error ? error.message : String(error)}. Hãy trả đúng một module TSX hợp lệ.`;
        continue;
      }

      const parsed = parseTransitionReply(reply, [input.boundaryId]);
      if (!parsed.ok) {
        log.warn(
          { projectId, boundaryId: input.boundaryId, reason: parsed.reason, detail: parsed.detail, rawReply: reply.slice(0, 1200) },
          "single-boundary transition parse failed",
        );
        feedback = `Lần trước reply bị từ chối: ${parsed.detail}. Trả về đúng một khối tsx có marker và id literal "${input.boundaryId}".`;
        continue;
      }

      const code = normalizeAuthoredFontSizes(normalizeAuthoredImports(parsed.modules[0]!.code));
      const written = await writeAuthoredScene(projectId, transitionFileName(input.boundaryId), code);
      unregisterTransition(input.boundaryId);
      const admitted = await admitOne(written);
      if (admitted.ok && admitted.transitionId === input.boundaryId) {
        const typeIssues = this.typecheckTransitionCandidate(written);
        const typeErrors = typeIssues.filter((issue) => issue.severity === "error");
        if (typeErrors.length === 0) {
          return true;
        }
        const typeText = typeErrors.map((issue) => `${issue.check} ${issue.path ?? written}: ${issue.message}`).join("\n");
        log.warn({ projectId, boundaryId: input.boundaryId, attempt: attempt + 1, errors: typeText }, "transition typecheck failed");
        feedback =
          `Lần trước mã qua admission nhưng lỗi TypeScript khi build:\n${typeText}\n\n` +
          `Sửa thành TSX typecheck sạch. Remotion import từ "remotion" (vd interpolate, interpolateColors, AbsoluteFill); @news/compositions chỉ dùng registerTransition và type SceneBoundaryTransitionProps.`;
        continue;
      }
      const violationText = admitted.ok
        ? `registerTransition id "${admitted.transitionId}" khác boundary "${input.boundaryId}".`
        : admitted.violations.map((v) => `${v.check} ${v.path}: ${v.message}`).join("\n");
      log.warn({ projectId, boundaryId: input.boundaryId, attempt: attempt + 1, violations: violationText }, "transition admission failed");
      feedback =
        `Lần trước mã bị TỪ CHỐI khi nạp:\n${violationText}\n\n` +
        `Sửa theo contract: chỉ import react, remotion, @news/compositions, zod; default export registerTransition({ id: "${input.boundaryId}", displayName, Component }); không schema/example.`;
    }

    await this.restoreTransitionCandidate(projectId, input.boundaryId, original);
    return false;
  }

  private typecheckTransitionCandidate(tsxPath: string): SafetyIssue[] {
    const check = this.deps.typecheckTransition ?? ((path: string) => typecheckAuthoredScenes([path], workspaceRoot()));
    try {
      return check(tsxPath);
    } catch (error) {
      log.warn({ err: error, path: tsxPath }, "transition typecheck threw; letting render-time fallback handle it");
      return [];
    }
  }

  private async restoreTransitionCandidate(projectId: string, boundaryId: string, original: string | undefined): Promise<void> {
    const path = join(projectPaths(projectId).authoredDir, transitionFileName(boundaryId));
    unregisterTransition(boundaryId);
    if (original !== undefined) {
      await writeFile(path, original, "utf8").catch((error) => {
        log.warn({ err: error, projectId, boundaryId, path }, "failed to restore previous transition module");
      });
      return;
    }
    await rm(path, { force: true }).catch((error) => {
      log.warn({ err: error, projectId, boundaryId, path }, "failed to remove rejected transition module");
    });
  }

  private async renderTransitionSamples(
    projectId: string,
    boundaryIds: string[],
    signal?: AbortSignal,
  ): Promise<Map<string, { fraction: number; dataUrl: string }[]>> {
    const out = new Map<string, { fraction: number; dataUrl: string }[]>();
    if (boundaryIds.length === 0) return out;
    const res = await this.deps.tools.render_stills(
      { projectId, transitionFractions: true },
      undefined,
      signal,
    ).catch((error) => {
      log.warn({ err: error, projectId }, "transition sample render threw");
      return null;
    });
    if (!res?.ok) {
      if (res && !res.ok) log.warn({ projectId, stage: res.error.stage, cause: res.error.cause }, "transition sample render failed");
      return out;
    }
    const reviewDir = projectPaths(projectId).reviewDir;
    for (const boundaryId of boundaryIds) {
      const [fromSceneId, toSceneId] = boundaryId.split("-to-");
      if (!fromSceneId || !toSceneId) continue;
      const samples: { fraction: number; dataUrl: string }[] = [];
      for (const fraction of DEFAULT_TRANSITION_SAMPLE_FRACTIONS) {
        const path = join(reviewDir, transitionSampleFileName(fromSceneId, toSceneId, fraction));
        const url = readStillDataUrl(path);
        if (url) samples.push({ fraction, dataUrl: url });
      }
      if (samples.length > 0) out.set(boundaryId, samples);
    }
    return out;
  }

  private async transitionVisualQa(
    projectId: string,
    samples: Map<string, { fraction: number; dataUrl: string }[]>,
    signal?: AbortSignal,
  ): Promise<TransitionDefect[]> {
    if (samples.size === 0) return [];
    const manifest = await loadManifest(projectId).catch((error) => {
      log.warn({ err: error, projectId }, "transition QA manifest unreadable; QA skipped");
      return null;
    });
    if (!manifest) return [];
    const sceneById = new Map(manifest.scenes.map((scene) => [scene.id, scene] as const));
    const samplesByBoundary = [...samples.entries()].map(([boundaryId, boundarySamples]) => {
      const [fromSceneId, toSceneId] = boundaryId.split("-to-");
      return {
        boundaryId,
        fromHeadline: sceneById.get(fromSceneId ?? "")?.headline ?? "",
        toHeadline: sceneById.get(toSceneId ?? "")?.headline ?? "",
        samples: boundarySamples,
      };
    });
    const model = this.deps.model();
    if (!model) return [];
    // Do not let the generic image-call fallback turn this into text-only QA.
    // Without the pixels the model can only guess and may rewrite a valid,
    // distinctive transition based on a hallucinated structural defect.
    if (this.imageUnsupportedModels.has(model)) return [];
    let reply: string;
    try {
      reply = await this.chatWithVisionFallback(model, buildTransitionQaMessages({ samplesByBoundary }), signal);
    } catch (error) {
      log.warn({ err: error, projectId }, "transition visual QA failed; skipping repair");
      return [];
    }
    const json = extractJsonObject(reply);
    if (!json) return [];
    try {
      const raw = JSON.parse(json) as { issues?: unknown };
      if (!Array.isArray(raw.issues)) return [];
      const known = new Set(samples.keys());
      const out: TransitionDefect[] = [];
      const seen = new Set<string>();
      for (const item of raw.issues) {
        const o = item as { boundaryId?: unknown; severity?: unknown; issue?: unknown };
        const boundaryId = typeof o.boundaryId === "string" ? o.boundaryId : "";
        const severity = typeof o.severity === "string" ? o.severity.toLowerCase() : "high";
        const issue = typeof o.issue === "string" ? o.issue.trim() : "";
        if (!known.has(boundaryId) || seen.has(boundaryId) || severity !== "high" || issue === "") continue;
        seen.add(boundaryId);
        out.push({ boundaryId, issue });
      }
      return out;
    } catch (error) {
      log.warn({ err: error, projectId }, "transition visual QA JSON parse failed");
      return [];
    }
  }

  private scenesForBoundary(boundaryId: string, scenes: TransitionPromptScene[]): { fromScene: TransitionPromptScene; toScene: TransitionPromptScene } | null {
    const [fromSceneId, toSceneId] = boundaryId.split("-to-");
    const fromScene = scenes.find((scene) => scene.id === fromSceneId);
    const toScene = scenes.find((scene) => scene.id === toSceneId);
    return fromScene && toScene ? { fromScene, toScene } : null;
  }

  private async readTransitionCode(projectId: string, boundaryId: string): Promise<string | undefined> {
    const path = join(projectPaths(projectId).authoredDir, transitionFileName(boundaryId));
    if (!existsSync(path)) return undefined;
    return readFile(path, "utf8").catch((error) => {
      log.warn({ err: error, projectId, boundaryId, path }, "transition source unreadable during QA repair");
      return undefined;
    });
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

  private async clearHyperframesSceneFiles(projectId: string): Promise<void> {
    const dir = projectPaths(projectId).hyperframesScenesDir;
    if (!existsSync(dir)) return;
    const files = await readdir(dir);
    await Promise.all(files.filter((file) => /\.html$/i.test(file)).map((file) => rm(join(dir, file), { force: true })));
  }

  private async writeHyperframesDesign(projectId: string, manifest: Manifest): Promise<void> {
    const paths = projectPaths(projectId);
    await mkdir(paths.hyperframesDir, { recursive: true });
    const dominant = manifest.theme?.dominant ?? "#1E9CB0";
    const mood = manifest.theme?.mood ?? "editorial, cinematic, clear";
    const text = [
      "# DESIGN.md",
      "",
      "Creative guidance for this HyperFrames project. This is not a template, component kit, or layout constraint.",
      "",
      "## Palette",
      `- Dominant: ${dominant}`,
      "- Supporting colors: choose per scene for contrast and narrative fit.",
      "",
      "## Typography",
      "- Use bespoke typography per scene; prioritize legibility on 1920x1080.",
      "",
      "## Motion Tone",
      `- ${mood}`,
      "- Entrance animations should feel authored for the scene, not copied from a preset.",
      "",
      "## What NOT to Do",
      "- Do not make every scene a centered title card.",
      "- Do not use external assets, fonts, URLs, data URLs, or remote scripts.",
      "- Do not introduce a reusable scene/template catalog.",
      "",
    ].join("\n");
    await writeFile(paths.hyperframesDesign, text, "utf8");
  }

  /**
   * Code-level self-repair: for each flagged scene, resolve its `.tsx`, ask the
   * AI to rewrite it (with the issue + current code, and — for layout/contrast
   * defects — the rendered still as an image), then overwrite + re-admit. If the
   * rewrite fails admission, the original code is restored so the project stays
   * renderable (atomic per scene). (desktop-author-mode, Req 3.)
   */
  async reauthor(projectId: string, targets: ReauthorTarget[], signal?: AbortSignal): Promise<{ scenes: AuthoredScene[] }> {
    const model = this.deps.model();
    if (!model) return { scenes: [] };
    const reviewDir = projectPaths(projectId).reviewDir;
    const admitOne = this.deps.admitOne ?? ((p: string) => admitAuthoredSceneFile(p));
    const done: AuthoredScene[] = [];

    // Read the manifest once to find which scenes carry an image, so the reauthor
    // prompt can hard-require keeping <SceneImage> (a free rewrite otherwise drops
    // it on a vague "make it nicer" edit while the manifest still references the
    // image). The multi-style concept is gone (one neutral theme — D1), so there is
    // no per-project style to thread into the repair prompt anymore.
    const manifestForReauthor = await loadManifest(projectId).catch((error) => {
      log.warn({ err: error, projectId }, "reauthor manifest unreadable; image-preservation hints unavailable");
      return undefined;
    });
    const imageSceneIds = new Set(
      (manifestForReauthor?.scenes ?? [])
        .filter((s: { image?: { ref?: string } }) => !!s.image?.ref)
        .map((s: { id: string }) => s.id),
    );

    for (const t of targets) {
      // A user "Dừng render" mid-reauthor stops before the next scene's AI call
      // (the in-flight chat is aborted via the signal). Already-rewritten scenes
      // stay applied; the controller restores the prior reviewable stage.
      if (signal?.aborted) break;
      const resolved = await resolveSceneFile(projectId, t.sceneId, (id) => loadManifest(id).catch((error) => {
        log.warn({ err: error, projectId: id, sceneId: t.sceneId }, "scene manifest unreadable during reauthor resolution");
        return { scenes: [] };
      }));
      if (!resolved) {
        log.error({ sceneId: t.sceneId }, "[reauthor] cannot resolve authored file; skipping");
        continue;
      }
      const { componentId, path } = resolved;

      let originalCode: string;
      try {
        originalCode = await readFile(path, "utf8");
      } catch (e) {
        log.error({ err: e, sceneId: t.sceneId, componentId }, "[reauthor] cannot read scene file");
        continue;
      }

      // Up to 2 attempts: a first rewrite, then — if it fails the admission gate
      // (for example with a wrong import or invalid syntax) — ONE corrective retry
      // that feeds the exact violations back so the model self-fixes the
      // deterministic error. On final failure the original code is restored
      // (atomic per scene), so the project always stays renderable.
      const MAX_REAUTHOR_ATTEMPTS = 2;
      let applied = false;
      let feedback: string | undefined;
      for (let attempt = 0; attempt < MAX_REAUTHOR_ATTEMPTS && !applied; attempt++) {
        const stillDataUrl = needsVision(t.issues) || t.visual ? readStillDataUrl(join(reviewDir, `${t.sceneId}.png`)) : undefined;
        const intent = [t.intent, feedback].filter((s) => s && s.trim()).join("\n\n") || undefined;
        const messages = buildReauthorMessages({
          sceneId: t.sceneId,
          componentId,
          currentCode: originalCode,
          ...(t.issues ? { issues: t.issues } : {}),
          ...(intent ? { intent } : {}),
          ...(stillDataUrl ? { stillDataUrl } : {}),
          ...(imageSceneIds.has(t.sceneId) ? { hasImage: true } : {}),
        });

        let reply: string;
        try {
          reply = await this.chatWithVisionFallback(model, messages, signal);
        } catch (e) {
          log.error({ err: e, sceneId: t.sceneId }, "[reauthor] AI call failed");
          break; // give up this scene; original is restored below
        }

        const parsed = parseReauthorReply(reply, componentId);
        if (!parsed.ok) {
          // Log the raw reply (capped) like the author path does — a `no-code`
          // reauthor failure is otherwise undiagnosable (we can't tell prose from
          // a code block that just lacks the fence / `registerComponent`).
          log.error(
            { sceneId: t.sceneId, reason: parsed.reason, detail: parsed.detail, rawReply: reply.slice(0, 2000) },
            "[reauthor] parse failed",
          );
          continue; // retry if attempts remain
        }

        // Overwrite + re-admit; on admission failure, capture the violations as
        // corrective feedback for the next attempt (or roll back if exhausted).
        await writeFile(path, normalizeAuthoredFontSizes(normalizeAuthoredImports(parsed.module.code)), "utf8");
        unregisterComponent(componentId);
        const re = await admitOne(path);
        if (re.ok) {
          applied = true;
          break;
        }
        const violationText = re.violations.map((v) => `  ${v.check} ${v.path}: ${v.message}`).join("\n");
        const last = attempt + 1 >= MAX_REAUTHOR_ATTEMPTS;
        log.error(
          { sceneId: t.sceneId, attempt: attempt + 1, action: last ? "rolling-back" : "retrying-with-feedback", violations: violationText },
          "[reauthor] re-admit failed",
        );
        feedback =
          `Lần trước mã bị TỪ CHỐI khi nạp:\n${violationText}\n\n` +
          `Sửa theo AUTHOR mode hiện tại: chỉ import react, remotion, zod, @news/compositions; KHÔNG import @news/blocks, @news/theme, @news/design; ` +
          `mã phải là TSX parse được, giữ nguyên id "${componentId}", chỉ dùng API được phép. Trả về lại đúng một khối tsx.`;
      }

      if (!applied) {
        await writeFile(path, originalCode, "utf8");
        unregisterComponent(componentId);
        await admitOne(path).catch((e) => log.debug({ err: e, sceneId: t.sceneId, componentId }, "[reauthor] re-admit of restored original failed"));
        continue;
      }
      done.push({ sceneId: t.sceneId, stillPath: join(reviewDir, `${t.sceneId}.png`) });
    }
    return { scenes: done };
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
      for (const id of manifestBoundaryTransitionIds(m)) unregisterTransition(id);
    } catch (e) {
      // best-effort: a missing/unreadable manifest just means nothing to clear
      log.debug({ err: e, projectId }, "refreshRegistry: no manifest to clear");
    }
  }

  /**
   * Read each provided image (already imported into the project `assetsDir` as
   * `assets/<sha>.<ext>`) into a data URL so the model can SEE it and decide
   * placement (Phase 2 Block A). A ref we can't read on disk is skipped (never
   * blocks authoring) and is thereby also excluded from the allowed-ref set, so a
   * scene the model pins to a missing image gets stripped downstream.
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
   * Call the model with vision parts, degrading to text-only safely (Req 3.7 +
   * Phase 2 Block B hardening). Key behaviors:
   *  - if the chosen model already rejected an inline image THIS session, skip
   *    vision and send text-only DIRECTLY — never re-trip 9router's ~2-minute
   *    circuit breaker (a 400 there fails every following call, even authoring);
   *  - on a 400 "improperly formed" from a call that carried an image, remember
   *    the model can't take images, then retry text-only;
   *  - a non-image failure (or a text-only message) is rethrown unchanged.
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
   * AI image-filter (Phase 2 Block B): ask the (vision) model which CRAWLED
   * article images actually illustrate the content, so the review screen can
   * pre-tick them (or, with human-review off, author uses exactly this set).
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
    if (!model || refs.length === 0) return [];
    // This call is image-ONLY (no meaningful text-only form), so if the model is
    // already known to reject inline images, don't even try — calling would just
    // 400 and trip 9router's circuit breaker, which would then fail the authoring
    // call that follows. No pre-selection; the review screen still works.
    if (this.imageUnsupportedModels.has(model)) return [];
    const images = this.buildAuthorImages(projectId, refs);
    if (images.length === 0) return [];
    const allowed = new Set(images.map((i) => i.ref));
    let reply: string;
    try {
      reply = await this.chatWithVisionFallback(model, buildImageFilterMessages(articleText, images), signal);
    } catch (e) {
      log.warn({ err: e, projectId }, "[image-filter] vision call failed; no pre-selection");
      return [];
    }
    const json = extractJsonObject(reply);
    if (!json) return [];
    try {
      const keep = (JSON.parse(json) as { keep?: unknown }).keep;
      if (!Array.isArray(keep)) return [];
      // Intersect with the provided refs so a hallucinated path can't slip in.
      return keep.filter((r): r is string => typeof r === "string" && allowed.has(r));
    } catch (error) {
      log.warn({ err: error, projectId }, "image-filter JSON parse failed; using no preselection");
      return [];
    }
  }

  /**
   * Crawl an article URL's images into the project `assetsDir` (Phase 2 Block B).
   * Fetches the page HTML through the SSRF-guarded TEXT fetcher, then hands it to
   * `crawlArticleImages` which downloads each candidate (binary SSRF fetcher),
   * imports content-addressed (caps + magic-byte sniff), and coarse-filters by
   * dimension. Best-effort: a page-fetch failure yields `[]` (crawl never blocks
   * authoring). Returns the local `assets/<sha>.<ext>` ref pool.
   */
  async crawlImages(projectId: string, url: string, signal?: AbortSignal): Promise<CrawledImage[]> {
    const destDir = projectPaths(projectId).assetsDir;
    let html: string;
    try {
      const res = await makeSafeFetch()(url);
      if (!res.ok) return [];
      html = await res.text();
    } catch (e) {
      log.warn({ err: e, url }, "[crawl] page fetch failed; no images crawled");
      return [];
    }
    if (signal?.aborted) return [];
    try {
      return await crawlArticleImages(html, url, destDir);
    } catch (e) {
      log.warn({ err: e, url }, "[crawl] image crawl failed");
      return [];
    }
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
    if (!model) return [];
    const manifest = await loadManifest(projectId).catch((error) => {
      log.warn({ err: error, projectId }, "visual-QA manifest unreadable; QA skipped");
      return null;
    });
    if (!manifest) return [];
    const reviewDir = projectPaths(projectId).reviewDir;
    const wanted = sceneIds && sceneIds.length > 0 ? new Set(sceneIds) : null;
    const known = new Set<string>();
    const scenes: { sceneId: string; stillDataUrl: string }[] = [];
    for (const s of manifest.scenes) {
      if (wanted && !wanted.has(s.id)) continue;
      known.add(s.id);
      const url = readStillDataUrl(join(reviewDir, `${s.id}.png`));
      if (url) scenes.push({ sceneId: s.id, stillDataUrl: url });
    }
    if (scenes.length === 0) return [];

    let reply: string;
    try {
      reply = await this.deps.client.chat(model, buildVisualQaMessages(scenes), { apiKey: this.deps.apiKey(), ...(signal ? { signal } : {}) });
    } catch (e) {
      log.warn({ err: e, projectId }, "[visual-qa] vision call failed; skipping QA");
      return [];
    }
    return parseVisualDefects(reply, known);
  }

  /** Snapshot the current authored source of the named scenes (for QA rollback). */
  async snapshotScenes(projectId: string, sceneIds: string[]): Promise<SceneSnapshot> {
    const snap: SceneSnapshot = [];
    for (const sceneId of sceneIds) {
      const resolved = await resolveSceneFile(projectId, sceneId, (id) => loadManifest(id).catch((error) => {
        log.warn({ err: error, projectId: id, sceneId }, "scene manifest unreadable during snapshot resolution");
        return { scenes: [] };
      }));
      if (!resolved) continue;
      try {
        snap.push({ sceneId, code: await readFile(resolved.path, "utf8") });
      } catch (e) {
        log.warn({ err: e, projectId, sceneId }, "[visual-qa] snapshot read failed");
      }
    }
    return snap;
  }

  /** Restore authored source from a snapshot + re-admit so the next render uses it. */
  async restoreScenes(projectId: string, snapshot: SceneSnapshot): Promise<void> {
    const admitOne = this.deps.admitOne ?? ((p: string) => admitAuthoredSceneFile(p));
    for (const { sceneId, code } of snapshot) {
      const resolved = await resolveSceneFile(projectId, sceneId, (id) => loadManifest(id).catch((error) => {
        log.warn({ err: error, projectId: id, sceneId }, "scene manifest unreadable during restore resolution");
        return { scenes: [] };
      }));
      if (!resolved) continue;
      try {
        await writeFile(resolved.path, code, "utf8");
        unregisterComponent(resolved.componentId);
        await admitOne(resolved.path).catch((e) => log.debug({ err: e, projectId, sceneId }, "[visual-qa] re-admit after restore failed"));
      } catch (e) {
        log.warn({ err: e, projectId, sceneId }, "[visual-qa] restore failed");
      }
    }
  }
}

/** Parse the visual-QA JSON reply into high-severity, known-scene defects (tolerant). */
function parseVisualDefects(reply: string, knownScenes: Set<string>): VisualDefect[] {
  const json = extractJsonObject(reply);
  if (!json) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    log.warn({ err: error }, "visual-QA JSON parse failed; treating reply as no defects");
    return [];
  }
  const issues = (raw as { issues?: unknown })?.issues;
  if (!Array.isArray(issues)) return [];
  const out: VisualDefect[] = [];
  const seen = new Set<string>();
  for (const it of issues) {
    const o = it as { sceneId?: unknown; issue?: unknown; severity?: unknown };
    const sceneId = typeof o.sceneId === "string" ? o.sceneId : "";
    const issue = typeof o.issue === "string" ? o.issue.trim() : "";
    const severity = typeof o.severity === "string" ? o.severity.toLowerCase() : "high";
    // Only act on clearly-flagged, known scenes; ignore "low" hunches + hallucinated ids.
    if (severity !== "high" || !knownScenes.has(sceneId) || issue === "" || seen.has(sceneId)) continue;
    seen.add(sceneId);
    out.push({ sceneId, issue });
  }
  return out;
}
