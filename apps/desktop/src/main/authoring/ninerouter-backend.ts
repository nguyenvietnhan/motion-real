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
import type { AuthorJob } from "../agent/agent-worker.js";
import type { NineRouterClient, ChatMessage } from "../gateway/ninerouter-client.js";
import { buildAuthorMessages, buildReauthorMessages } from "./prompt.js";
import { parseAuthorReply } from "./reply-parser.js";
import { parseReauthorReply } from "./reply-parser.js";
import type { AuthorManifest } from "./manifest-schema.js";
import { sceneFileName, resolveSceneFile } from "./scene-files.js";
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

  async authorScenes(job: AuthorJob): Promise<{ scenes: AuthoredScene[]; message?: string }> {
    const model = this.deps.model();
    if (!model) return { scenes: [], message: "Chưa chọn model AI." };

    // Best-effort grounding: fetch any links in the brief. A failed fetch is NOT
    // fatal — authoring continues from the user's text + the model's knowledge.
    const chunks: string[] = [];
    for (const url of job.input.urls) {
      const ing = await this.deps.tools.ingest_url({ url }).catch(() => null);
      const text = ing && ing.ok ? (ing.data as { text?: unknown } | undefined)?.text : undefined;
      if (typeof text === "string" && text.trim()) {
        chunks.push(`# ${url}\n${text.trim()}`);
      } else {
        console.warn(`[authoring] could not read link ${url} (skipping; authoring continues).`);
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
      return { scenes: [], message: e instanceof Error ? e.message : "Gọi AI thất bại." };
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
      await writeAuthoredScene(job.projectId, sceneFileName(mod.id), mod.code);
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
    return { scenes };
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

      const stillDataUrl = needsVision(t.issues) ? readStillDataUrl(join(reviewDir, `${t.sceneId}.png`)) : undefined;
      const messages = buildReauthorMessages({
        sceneId: t.sceneId,
        componentId,
        currentCode: originalCode,
        ...(t.issues ? { issues: t.issues } : {}),
        ...(t.intent ? { intent: t.intent } : {}),
        ...(stillDataUrl ? { stillDataUrl } : {}),
      });

      let reply: string;
      try {
        reply = await this.chatWithVisionFallback(model, messages);
      } catch (e) {
        console.error(`[reauthor] AI call failed for ${t.sceneId}:`, e);
        continue;
      }

      const parsed = parseReauthorReply(reply, componentId);
      if (!parsed.ok) {
        console.error(`[reauthor] parse failed for ${t.sceneId} (${parsed.reason}: ${parsed.detail}).`);
        continue;
      }

      // Overwrite + re-admit; on admission failure, roll back to the original.
      await writeFile(path, parsed.module.code, "utf8");
      unregisterComponent(componentId);
      const re = await admitOne(path);
      if (!re.ok) {
        console.error(
          `[reauthor] re-admit failed for ${t.sceneId}; rolling back:\n` +
            re.violations.map((v) => `  ${v.check} ${v.path}: ${v.message}`).join("\n"),
        );
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
}
