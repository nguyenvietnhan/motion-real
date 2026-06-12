import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import {
  admitProjectScenes,
  admitAndRegisterAuthored,
  loadManifest,
  projectPaths,
  writeAuthoredScene,
  writeJson,
  unregisterComponent,
  makeSafeFetch,
  crawlArticleImages,
  type CrawledImage,
  type Manifest,
  type ManifestScene,
  type AdmitProjectResult,
  type AuthoredRegistration,
  type SafetyIssue,
  type SerializedPipelineError,
} from "@news/pipeline";
import type { createTools } from "@news/mcp";
import type { AuthoringBackend, AuthoredScene, ReauthorTarget } from "../agent/custom-loop-worker.js";
import type { SafetyReportView } from "../agent/repair-loop.js";
import type { AuthorJob, VisualDefect, SceneSnapshot, AuthorImageRef } from "../agent/agent-worker.js";
import { GatewayChatError, type NineRouterClient, type ChatMessage } from "../gateway/ninerouter-client.js";
import { buildAuthorMessages, buildReauthorMessages, buildVisualQaMessages, buildImageFilterMessages, type AuthorImageInput } from "./prompt.js";
import { parseAuthorReply } from "./reply-parser.js";
import { parseReauthorReply } from "./reply-parser.js";
import type { AuthorManifest } from "./manifest-schema.js";
import { extractJsonObject } from "./manifest-schema.js";
import { sceneFileName, resolveSceneFile } from "./scene-files.js";
import { normalizeAuthoredImports } from "./normalize-imports.js";
import { normalizeAuthoredFontSizes } from "./normalize-fontsize.js";
import { loadAuthoredTsx } from "./tsx-loader.js";
import { listStylePackIds } from "@news/design";

/**
 * Pure-AUTHOR authoring backend (desktop-author-mode). The AI writes FRESH `.tsx`
 * scene modules per topic (no fixed kit): it returns a manifest + one `.tsx` code
 * block per scene id; we write each module, admit them through the gate, and
 * render. Drives the SAME `@news/mcp` tools / single registry.
 */

type Tools = ReturnType<typeof createTools>;

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
   * Admit + register a project's authored scenes (injectable for tests). The
   * default runs the real gate through the esbuild `.tsx` loader; tests stub it
   * because the bundled loader's repo-root resolution doesn't hold under vitest.
   */
  admit?: (projectId: string) => Promise<AdmitProjectResult>;
  /** Admit + register ONE authored module (injectable for tests; reauthor path). */
  admitOne?: (tsxPath: string) => Promise<AuthoredRegistration>;
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
  } catch {
    return undefined;
  }
}

/** Engine ThemeSpec limits: dominant must be 6-digit hex, mood ≤40 chars. */
const HEX6 = /^#[0-9a-fA-F]{6}$/;
function sanitizeTheme(
  theme: { dominant: string; mood?: string },
  stylePackId?: string,
): { dominant: string; mood?: string; stylePackId?: string } {
  const dominant = HEX6.test(theme.dominant.trim()) ? theme.dominant.trim() : "#1E9CB0";
  const mood = (theme.mood ?? "").trim().slice(0, 40);
  // Only honor a stylePackId that is actually registered — an unknown id (stale
  // renderer, hand-edited request) falls through to the engine default rather
  // than reaching the manifest and tripping the N1 unknown-pack hard error.
  const pack = stylePackId && listStylePackIds().includes(stylePackId) ? stylePackId : undefined;
  return {
    dominant,
    ...(mood ? { mood } : {}),
    ...(pack ? { stylePackId: pack } : {}),
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
 * `stylePackId` is the look the USER picked at the create screen (the AI never
 * authors it — it only writes `theme.dominant`/`mood`). We inject it into the
 * engine theme here so the chosen pack drives chrome + layout at render; an
 * unregistered id is dropped (engine default) by `sanitizeTheme`.
 */
function toEngineManifest(
  m: AuthorManifest,
  allowedRefs: ReadonlySet<string> = new Set(),
  stylePackId?: string,
): Manifest {
  const scenes: ManifestScene[] = m.scenes.map((s, i) => {
    const keepImage = s.image && allowedRefs.has(s.image.ref);
    if (s.image && !keepImage) {
      console.warn(`[authoring] dropping scene-${String(i + 1).padStart(2, "0")} image with non-provided ref "${s.image.ref}".`);
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
  // validation: title ≤140, theme.dominant hex, theme.mood ≤40.
  return { title: m.title.slice(0, 140), theme: sanitizeTheme(m.theme, stylePackId), scenes } as Manifest;
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
      const ing = await this.deps.tools.ingest_url({ url }).catch(() => null);
      // ingest_url returns an IngestResult ({ researchPath, metadata, wordCount });
      // the extracted article (text + provenance header) is written to that file —
      // the body is NOT inlined in the result. Read the research file to ground the
      // author prompt. (A prior version read `ing.data.text`, which never exists, so
      // EVERY link was silently treated as unreadable even on a clean fetch.)
      let body: string | undefined;
      if (ing && ing.ok) {
        body = await readFile(ing.data.researchPath, "utf8").catch(() => undefined);
      }
      if (body && body.trim()) {
        chunks.push(`# ${url}\n${body.trim()}`);
      } else {
        unreadableUrls.push(url);
        const reason = ing && !ing.ok ? `${ing.error.stage}: ${ing.error.cause}` : "no readable article text";
        console.warn(`[authoring] could not read link ${url} (${reason}); skipping; authoring continues.`);
      }
    }
    const research = chunks.length > 0 ? chunks.join("\n\n---\n\n") : undefined;

    // Provided images (Phase 2 Block A): read each already-imported asset into a
    // data URL so the model can SEE it and decide placement. A ref we can't read
    // is skipped (never blocks authoring). `allowedRefs` is the set the model was
    // actually shown, used below to strip any hallucinated ref from the manifest.
    const images = this.buildAuthorImages(job.projectId, job.input.images ?? []);
    const allowedRefs = new Set(images.map((i) => i.ref));

    const messages = buildAuthorMessages(job.input, research, images.length > 0 ? images : undefined);
    let reply: string;
    try {
      console.log(`[authoring] calling AI model "${model}" for project ${job.projectId}…`);
      reply = await this.chatWithVisionFallback(model, messages);
      console.log(`[authoring] AI replied (${reply.length} chars) for project ${job.projectId}.`);
    } catch (e) {
      console.error(`[authoring] AI call failed for project ${job.projectId}:`, e);
      return { scenes: [], message: authorCallErrorMessage(e) };
    }

    const parsed = parseAuthorReply(reply);
    if (!parsed.ok) {
      console.error(`[authoring] author-reply parse failed (${parsed.reason}: ${parsed.detail}). Raw reply (first 2000 chars):\n${reply.slice(0, 2000)}`);
      return { scenes: [], message: "AI chưa trả về kịch bản hợp lệ. Hãy thử lại hoặc mô tả rõ hơn." };
    }

    // Write each AI-authored module. Unregister first so a re-authored id (or a
    // cross-project id collision in the process-wide registry) is refreshed with
    // THIS project's code at admission time.
    for (const mod of parsed.modules) {
      unregisterComponent(mod.id);
      await writeAuthoredScene(job.projectId, sceneFileName(mod.id), normalizeAuthoredFontSizes(normalizeAuthoredImports(mod.code)));
    }
    const engineManifest = toEngineManifest(parsed.manifest, allowedRefs, job.input.stylePackId);
    await writeJson(manifestPathOf(job.projectId), engineManifest);

    const admit = this.deps.admit ?? ((id: string) => admitProjectScenes(id, { load: loadAuthoredTsx }));
    const admitted = await admit(job.projectId);
    if (!admitted.ok) {
      console.error(
        "[authoring] admission failed:\n" +
          admitted.violations.map((v) => `  ${v.check} ${v.path}: ${v.message}`).join("\n"),
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
    const admitOne = this.deps.admitOne ?? ((p: string) => admitAndRegisterAuthored(p, { load: loadAuthoredTsx }));
    const done: AuthoredScene[] = [];

    // The project's chosen design language drives the repair prompt too, so a
    // galaxy scene is rewritten with galaxy rules (not the cream/squared default).
    // Read it once from the stored manifest; an unreadable/absent id ⇒ undefined
    // (the prompt builder falls back to the default language). Same read also
    // yields the set of scenes that carry an image, so the reauthor prompt can
    // hard-require keeping <SceneImage> (a free rewrite otherwise drops it on a
    // vague "make it nicer" edit while the manifest still references the image).
    const manifestForReauthor = await loadManifest(projectId).catch(() => undefined);
    const stylePackId = manifestForReauthor?.theme?.stylePackId;
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
      const resolved = await resolveSceneFile(projectId, t.sceneId, (id) => loadManifest(id).catch(() => ({ scenes: [] })));
      if (!resolved) {
        console.error(`[reauthor] cannot resolve authored file for ${t.sceneId}; skipping.`);
        continue;
      }
      const { componentId, path } = resolved;

      let originalCode: string;
      try {
        originalCode = await readFile(path, "utf8");
      } catch (e) {
        console.error(`[reauthor] cannot read ${t.sceneId} (${componentId}):`, e);
        continue;
      }

      // Up to 2 attempts: a first rewrite, then — if it fails the admission gate
      // (e.g. a wrong import like `useTheme` from "@news/design") — ONE corrective
      // retry that feeds the exact violations back so the model self-fixes the
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
          ...(stylePackId ? { stylePackId } : {}),
          ...(t.issues ? { issues: t.issues } : {}),
          ...(intent ? { intent } : {}),
          ...(stillDataUrl ? { stillDataUrl } : {}),
          ...(imageSceneIds.has(t.sceneId) ? { hasImage: true } : {}),
          ...(imageSceneIds.has(t.sceneId) ? { hasImage: true } : {}),
        });

        let reply: string;
        try {
          reply = await this.chatWithVisionFallback(model, messages, signal);
        } catch (e) {
          console.error(`[reauthor] AI call failed for ${t.sceneId}:`, e);
          break; // give up this scene; original is restored below
        }

        const parsed = parseReauthorReply(reply, componentId);
        if (!parsed.ok) {
          console.error(`[reauthor] parse failed for ${t.sceneId} (${parsed.reason}: ${parsed.detail}).`);
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
        console.error(`[reauthor] re-admit failed for ${t.sceneId} (attempt ${attempt + 1}); ${last ? "rolling back" : "retrying with feedback"}:\n${violationText}`);
        feedback =
          `Lần trước mã bị TỪ CHỐI khi nạp:\n${violationText}\n\n` +
          `Sửa đúng import whitelist: useTheme/surfaceBorder/frameRamp/useRamp nhập từ "@news/blocks" (KHÔNG nhập từ "@news/design"); ` +
          `chỉ dùng API được phép; giữ nguyên id "${componentId}". Trả về lại đúng một khối tsx.`;
      }

      if (!applied) {
        await writeFile(path, originalCode, "utf8");
        unregisterComponent(componentId);
        await admitOne(path).catch(() => {});
        continue;
      }
      done.push({ sceneId: t.sceneId, stillPath: join(reviewDir, `${t.sceneId}.png`) });
    }
    return { scenes: done };
  }

  /**
   * Clear this project's authored component ids from the process-wide registry
   * so the upcoming render re-registers them FRESH from THIS project's files.
   * Guards against a cross-project id collision (the registry is shared across
   * the long-lived Electron session) staling the Node-side prop validation.
   */
  private async refreshRegistry(projectId: string): Promise<void> {
    try {
      const m = await loadManifest(projectId);
      for (const s of m.scenes) unregisterComponent(s.component);
    } catch {
      /* best-effort: a missing/unreadable manifest just means nothing to clear */
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
      } catch {
        /* unreadable asset → skip; authoring continues without this image */
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
        console.warn(`[authoring] model "${model}" rejected an inline image (HTTP 400); using text-only for it this session.`);
      } else {
        console.warn("[authoring] vision chat failed; retrying text-only:", e);
      }
      return this.deps.client.chat(model, this.toTextOnly(messages), { apiKey, ...(signal ? { signal } : {}) });
    }
  }

  async renderDraft(projectId: string, signal?: AbortSignal): Promise<{ ok: true } | { ok: false; error?: SerializedPipelineError }> {
    await this.refreshRegistry(projectId);
    const res = await this.deps.tools.render_draft(
      // Cap draft concurrency: forcing all CPU cores crashed Chromium in Electron
      // ("Page.bringToFront: Target closed"). 2 is a stable preview default.
      { projectId, concurrency: 2 },
      this.deps.onRenderProgress ? (r) => this.deps.onRenderProgress!(r, projectId) : undefined,
      signal,
    );
    if (!res.ok) {
      console.error(`[render] render_draft failed for ${projectId} [${res.error.stage}]: ${res.error.cause}`);
      // Carry the engine error so the repair loop can route infra vs content.
      return { ok: false, error: res.error };
    }
    console.log(`[render] render_draft OK for ${projectId} → ${(res.data as { mp4Path?: string }).mp4Path ?? "(draft)"}`);
    return { ok: true };
  }

  async renderFull(projectId: string, signal?: AbortSignal): Promise<{ ok: true; outputPath: string } | { ok: false; error?: SerializedPipelineError }> {
    await this.refreshRegistry(projectId);
    const res = await this.deps.tools.render_full(
      { projectId },
      this.deps.onRenderProgress ? (r) => this.deps.onRenderProgress!(r, projectId) : undefined,
      signal,
    );
    if (!res.ok) {
      console.error(`[render] render_full failed for ${projectId} [${res.error.stage}]: ${res.error.cause}`);
      return { ok: false, error: res.error };
    }
    const outputPath = (res.data as { mp4Path?: string }).mp4Path ?? "";
    console.log(`[render] render_full OK for ${projectId} → ${outputPath}`);
    return { ok: true, outputPath };
  }

  async getSafetyReport(projectId: string): Promise<SafetyReportView> {
    const res = await this.deps.tools.get_safety_report({ projectId });
    if (!res.ok) {
      console.error(`[render] get_safety_report failed for ${projectId}: ${res.error.cause}`);
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
      console.error(
        "[render] safety grid HARD errors:\n" +
          hardErrors.map((e) => `  ${e.check}${e.sceneId ? ` @${e.sceneId}` : ""}: ${e.message}`).join("\n"),
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
      console.warn("[image-filter] vision call failed; no pre-selection:", e);
      return [];
    }
    const json = extractJsonObject(reply);
    if (!json) return [];
    try {
      const keep = (JSON.parse(json) as { keep?: unknown }).keep;
      if (!Array.isArray(keep)) return [];
      // Intersect with the provided refs so a hallucinated path can't slip in.
      return keep.filter((r): r is string => typeof r === "string" && allowed.has(r));
    } catch {
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
      console.warn(`[crawl] page fetch failed for ${url}; no images crawled:`, e);
      return [];
    }
    if (signal?.aborted) return [];
    try {
      return await crawlArticleImages(html, url, destDir);
    } catch (e) {
      console.warn(`[crawl] image crawl failed for ${url}:`, e);
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
    const manifest = await loadManifest(projectId).catch(() => null);
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
      console.warn("[visual-qa] vision call failed; skipping QA:", e);
      return [];
    }
    return parseVisualDefects(reply, known);
  }

  /** Snapshot the current authored source of the named scenes (for QA rollback). */
  async snapshotScenes(projectId: string, sceneIds: string[]): Promise<SceneSnapshot> {
    const snap: SceneSnapshot = [];
    for (const sceneId of sceneIds) {
      const resolved = await resolveSceneFile(projectId, sceneId, (id) => loadManifest(id).catch(() => ({ scenes: [] })));
      if (!resolved) continue;
      try {
        snap.push({ sceneId, code: await readFile(resolved.path, "utf8") });
      } catch (e) {
        console.warn(`[visual-qa] snapshot read failed for ${sceneId}:`, e);
      }
    }
    return snap;
  }

  /** Restore authored source from a snapshot + re-admit so the next render uses it. */
  async restoreScenes(projectId: string, snapshot: SceneSnapshot): Promise<void> {
    const admitOne = this.deps.admitOne ?? ((p: string) => admitAndRegisterAuthored(p, { load: loadAuthoredTsx }));
    for (const { sceneId, code } of snapshot) {
      const resolved = await resolveSceneFile(projectId, sceneId, (id) => loadManifest(id).catch(() => ({ scenes: [] })));
      if (!resolved) continue;
      try {
        await writeFile(resolved.path, code, "utf8");
        unregisterComponent(resolved.componentId);
        await admitOne(resolved.path).catch(() => {});
      } catch (e) {
        console.warn(`[visual-qa] restore failed for ${sceneId}:`, e);
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
  } catch {
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
