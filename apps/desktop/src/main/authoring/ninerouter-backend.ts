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
  return { title: m.title, theme: m.theme, scenes } as Manifest;
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
      reply = await this.deps.client.chat(model, messages, { apiKey: this.deps.apiKey() });
    } catch (e) {
      return { scenes: [], message: e instanceof Error ? e.message : "Gọi AI thất bại." };
    }

    const parsed = parseAuthorManifest(reply);
    if (!parsed.ok) {
      return { scenes: [], message: `AI trả về kịch bản chưa hợp lệ (${parsed.reason}).` };
    }

    // Write only the kit components actually used, plus the manifest.
    const used = new Set<string>(parsed.manifest.scenes.map((s) => s.component));
    for (const entry of SCENE_KIT) {
      if (used.has(entry.id)) await writeAuthoredScene(job.projectId, entry.file, entry.code);
    }
    const engineManifest = toEngineManifest(parsed.manifest);
    await writeJson(manifestPathOf(job.projectId), engineManifest);

    const admitted = await admitProjectScenes(job.projectId);
    if (!admitted.ok) {
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
    return { ok: res.ok };
  }

  async getSafetyReport(projectId: string): Promise<SafetyReportView> {
    const res = await this.deps.tools.get_safety_report({ projectId });
    if (!res.ok) return { ok: false, hardErrors: [], warnings: [] };
    return res.data;
  }
}
