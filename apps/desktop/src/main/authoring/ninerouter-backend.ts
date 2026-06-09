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
import type { AuthorJob, VisualDefect, SceneSnapshot } from "../agent/agent-worker.js";
import type { NineRouterClient, ChatMessage } from "../gateway/ninerouter-client.js";
import { buildAuthorMessages, buildReauthorMessages, buildVisualQaMessages } from "./prompt.js";
import { parseAuthorReply } from "./reply-parser.js";
import { parseReauthorReply } from "./reply-parser.js";
import type { AuthorManifest } from "./manifest-schema.js";
import { extractJsonObject } from "./manifest-schema.js";
import { sceneFileName, resolveSceneFile } from "./scene-files.js";
import { normalizeAuthoredImports } from "./normalize-imports.js";
import { normalizeAuthoredFontSizes } from "./normalize-fontsize.js";
import { loadAuthoredTsx } from "./tsx-loader.js";

/**
 * Pure-AUTHOR authoring backend (desktop-author-mode). The AI writes FRESH `.tsx`
 * scene modules per topic (no fixed kit): it returns a manifest + one `.tsx` code
 * block per scene id; we write each module, admit them through the gate, and
 * render. Drives the SAME `@news/mcp` tools / single registry.
 */

type Tools = ReturnType<typeof createTools>;

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
function sanitizeTheme(theme: { dominant: string; mood?: string }): { dominant: string; mood?: string } {
  const dominant = HEX6.test(theme.dominant.trim()) ? theme.dominant.trim() : "#1E9CB0";
  const mood = (theme.mood ?? "").trim().slice(0, 40);
  return mood ? { dominant, mood } : { dominant };
}

/** AuthorManifest (open-id, pure-author) → engine Manifest with sequential scene ids. */
function toEngineManifest(m: AuthorManifest): Manifest {
  const scenes: ManifestScene[] = m.scenes.map((s, i) => ({
    id: `scene-${String(i + 1).padStart(2, "0")}`,
    component: s.component,
    eyebrow: s.eyebrow,
    headline: s.headline,
    narration: s.narration,
    props: s.props ?? {},
    ...(s.body ? { body: s.body } : {}),
    ...(s.transitionToNext ? { transitionToNext: s.transitionToNext } : {}),
  }));
  // Clamp to the engine VideoSpec limits so AI variance never trips schema
  // validation: title ≤140, theme.dominant hex, theme.mood ≤40.
  return { title: m.title.slice(0, 140), theme: sanitizeTheme(m.theme), scenes } as Manifest;
}

export class NineRouterAuthoringBackend implements AuthoringBackend {
  constructor(private readonly deps: NineRouterBackendDeps) {}

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

    const messages = buildAuthorMessages(job.input, research);
    let reply: string;
    try {
      console.log(`[authoring] calling AI model "${model}" for project ${job.projectId}…`);
      reply = await this.deps.client.chat(model, messages, { apiKey: this.deps.apiKey() });
      console.log(`[authoring] AI replied (${reply.length} chars) for project ${job.projectId}.`);
    } catch (e) {
      console.error(`[authoring] AI call failed for project ${job.projectId}:`, e);
      return { scenes: [], message: "Không nhận được phản hồi từ AI (quá thời gian chờ hoặc mất kết nối). Hãy kiểm tra 9Router/model rồi thử lại." };
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
    const engineManifest = toEngineManifest(parsed.manifest);
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
  async reauthor(projectId: string, targets: ReauthorTarget[]): Promise<{ scenes: AuthoredScene[] }> {
    const model = this.deps.model();
    if (!model) return { scenes: [] };
    const reviewDir = projectPaths(projectId).reviewDir;
    const admitOne = this.deps.admitOne ?? ((p: string) => admitAndRegisterAuthored(p, { load: loadAuthoredTsx }));
    const done: AuthoredScene[] = [];

    for (const t of targets) {
      const resolved = await resolveSceneFile(projectId, t.sceneId, (id) => loadManifest(id));
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
          ...(t.issues ? { issues: t.issues } : {}),
          ...(intent ? { intent } : {}),
          ...(stillDataUrl ? { stillDataUrl } : {}),
        });

        let reply: string;
        try {
          reply = await this.chatWithVisionFallback(model, messages);
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
          `Sửa đúng import whitelist: useTheme/chromeBorder/frameRamp/useRamp nhập từ "@news/blocks" (KHÔNG nhập từ "@news/design"); ` +
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

  /** Call the model; if a vision (image) call fails, retry text-only (Req 3.7). */
  private async chatWithVisionFallback(model: string, messages: ChatMessage[]): Promise<string> {
    try {
      return await this.deps.client.chat(model, messages, { apiKey: this.deps.apiKey() });
    } catch (e) {
      const hasImage = messages.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === "image_url"));
      if (!hasImage) throw e;
      console.warn("[reauthor] vision chat failed; retrying text-only:", e);
      const textOnly: ChatMessage[] = messages.map((m) => ({
        role: m.role,
        content: Array.isArray(m.content)
          ? m.content.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n")
          : m.content,
      }));
      return await this.deps.client.chat(model, textOnly, { apiKey: this.deps.apiKey() });
    }
  }

  async renderDraft(projectId: string): Promise<{ ok: true } | { ok: false; error?: SerializedPipelineError }> {
    await this.refreshRegistry(projectId);
    const res = await this.deps.tools.render_draft(
      // Cap draft concurrency: forcing all CPU cores crashed Chromium in Electron
      // ("Page.bringToFront: Target closed"). 2 is a stable preview default.
      { projectId, concurrency: 2 },
      this.deps.onRenderProgress ? (r) => this.deps.onRenderProgress!(r, projectId) : undefined,
    );
    if (!res.ok) {
      console.error(`[render] render_draft failed for ${projectId} [${res.error.stage}]: ${res.error.cause}`);
      // Carry the engine error so the repair loop can route infra vs content.
      return { ok: false, error: res.error };
    }
    console.log(`[render] render_draft OK for ${projectId} → ${(res.data as { mp4Path?: string }).mp4Path ?? "(draft)"}`);
    return { ok: true };
  }

  async renderFull(projectId: string): Promise<{ ok: true; outputPath: string } | { ok: false; error?: SerializedPipelineError }> {
    await this.refreshRegistry(projectId);
    const res = await this.deps.tools.render_full(
      { projectId },
      this.deps.onRenderProgress ? (r) => this.deps.onRenderProgress!(r, projectId) : undefined,
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
   * AI visual-QA: ask the (vision) model to flag CLEAR layout defects on the
   * rendered scene stills — overlap, clipping, off-canvas, imbalance — that the
   * deterministic grid can't catch. `sceneIds` scopes the check (e.g. only the
   * scenes a user just edited); omit to check every scene. Best-effort and
   * model-dependent: no model, no stills, a vision failure, or an unparseable
   * reply all yield `[]` (skip QA, never block the pipeline).
   */
  async visualQa(projectId: string, sceneIds?: string[]): Promise<VisualDefect[]> {
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
      reply = await this.deps.client.chat(model, buildVisualQaMessages(scenes), { apiKey: this.deps.apiKey() });
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
      const resolved = await resolveSceneFile(projectId, sceneId, (id) => loadManifest(id));
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
      const resolved = await resolveSceneFile(projectId, sceneId, (id) => loadManifest(id));
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
