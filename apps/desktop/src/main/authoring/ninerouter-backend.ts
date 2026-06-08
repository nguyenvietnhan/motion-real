import { join } from "node:path";
import {
  admitProjectScenes,
  projectPaths,
  writeAuthoredScene,
  writeJson,
  type Manifest,
  type ManifestScene,
} from "@news/pipeline";
import type { createTools } from "@news/mcp";
import type { AuthoringBackend, AuthoredScene } from "../agent/custom-loop-worker.js";
import type { SafetyReportView } from "../agent/repair-loop.js";
import type { AuthorJob } from "../agent/agent-worker.js";
import type { NineRouterClient } from "../gateway/ninerouter-client.js";
import { buildAuthorMessages } from "./prompt.js";
import { parseAuthorManifest, type AuthorManifest } from "./manifest-schema.js";
import { SCENE_KIT } from "./starter-kit.js";
import { loadAuthoredTsx } from "./tsx-loader.js";

/**
 * Real authoring backend (web-dashboard A1). The AI does the journalism: it
 * returns a manifest selecting proven scene-kit components + Vietnamese content;
 * we write the kit `.tsx` + manifest, admit, and render. Output is reliably
 * admissible because the code is the known-good kit (bespoke per-topic visuals
 * are a later upgrade). Drives the SAME `@news/mcp` tools / single registry.
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
};

function manifestPathOf(projectId: string): string {
  return projectPaths(projectId).manifest;
}

/** Engine ThemeSpec limits: dominant must be 6-digit hex, mood ≤40 chars. */
const HEX6 = /^#[0-9a-fA-F]{6}$/;
function sanitizeTheme(theme: { dominant: string; mood?: string }): { dominant: string; mood?: string } {
  const dominant = HEX6.test(theme.dominant.trim()) ? theme.dominant.trim() : "#1E9CB0";
  const mood = (theme.mood ?? "").trim().slice(0, 40);
  return mood ? { dominant, mood } : { dominant };
}

/** AuthorManifest (kit-based) → engine Manifest with sequential scene ids. */
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

  async ingest(input: { kind: "url"; url: string }): Promise<{ ok: boolean; message?: string }> {
    const res = await this.deps.tools.ingest_url({ url: input.url });
    return res.ok ? { ok: true } : { ok: false, message: res.error.cause };
  }

  async authorScenes(job: AuthorJob): Promise<{ scenes: AuthoredScene[]; message?: string }> {
    const model = this.deps.model();
    if (!model) return { scenes: [], message: "Chưa chọn model AI." };

    // Research: for a URL, reuse the just-ingested text; for a topic, none yet.
    let research: string | undefined;
    if (job.input.kind === "url") {
      const ing = await this.deps.tools.ingest_url({ url: job.input.url }).catch(() => null);
      if (ing && ing.ok) {
        const text = (ing.data as { text?: unknown } | undefined)?.text;
        if (typeof text === "string" && text.trim()) research = text;
      }
    }

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

    const parsed = parseAuthorManifest(reply);
    if (!parsed.ok) {
      console.error(`[authoring] manifest parse failed (${parsed.reason}). Raw reply (first 2000 chars):\n${reply.slice(0, 2000)}`);
      return { scenes: [], message: `AI trả về kịch bản chưa hợp lệ (${parsed.reason}).` };
    }

    // Write only the kit components actually used, plus the manifest.
    const used = new Set<string>(parsed.manifest.scenes.map((s) => s.component));
    const known = new Set<string>(SCENE_KIT.map((e) => e.id));
    const unknown = [...used].filter((id) => !known.has(id));
    if (unknown.length > 0) {
      console.error(
        `[authoring] AI used component ids NOT in the kit: ${unknown.join(", ")}. ` +
          `Allowed ids: ${[...known].join(", ")}. These scenes have no module and will fail admission.`,
      );
    }
    for (const entry of SCENE_KIT) {
      if (used.has(entry.id)) await writeAuthoredScene(job.projectId, entry.file, entry.code);
    }
    const engineManifest = toEngineManifest(parsed.manifest);
    await writeJson(manifestPathOf(job.projectId), engineManifest);

    const admitted = await admitProjectScenes(job.projectId, { load: loadAuthoredTsx });
    if (!admitted.ok) {
      console.error(
        "[authoring] admission failed:\n" +
          admitted.violations.map((v) => `  ${v.check} ${v.path}: ${v.message}`).join("\n"),
      );
      return { scenes: [], message: "Một số cảnh chưa hợp lệ. Hãy thử tạo lại." };
    }

    const reviewDir = projectPaths(job.projectId).reviewDir;
    const scenes: AuthoredScene[] = engineManifest.scenes.map((s) => ({
      sceneId: s.id,
      stillPath: join(reviewDir, `${s.id}.png`),
    }));
    return { scenes };
  }

  /** v1: kit-based scenes rarely trip hard errors; re-author is a no-op re-render. */
  async reauthor(): Promise<{ scenes: AuthoredScene[] }> {
    return { scenes: [] };
  }

  async renderDraft(projectId: string): Promise<{ ok: boolean }> {
    const res = await this.deps.tools.render_draft(
      { projectId },
      this.deps.onRenderProgress ? (r) => this.deps.onRenderProgress!(r, projectId) : undefined,
    );
    if (!res.ok) {
      console.error(`[render] render_draft failed for ${projectId} [${res.error.stage}]: ${res.error.cause}`);
    } else {
      console.log(`[render] render_draft OK for ${projectId} → ${(res.data as { mp4Path?: string }).mp4Path ?? "(draft)"}`);
    }
    return { ok: res.ok };
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
