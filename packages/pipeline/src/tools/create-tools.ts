import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  ELEVENLABS_DEFAULT_MODEL_ID,
  vivibeApiKey,
  defaultVivibeVoiceId,
  elevenLabsApiKey,
  defaultElevenLabsVoiceId,
} from "@news/tts";
import { resolveBgmTrack } from "../audio/bgm-library.js";
import { runDoctor, type DoctorReport } from "../cli/cli.js";
import { PipelineError, serializeError } from "../errors.js";
import { ingestUrl, type IngestResult } from "../ingest/url-ingest.js";
import {
  scaffoldVideoProject,
  renderProject,
  type ScaffoldVideoProjectResult,
  type RenderProjectResult,
} from "../orchestrator.js";
import {
  renderProjectStills,
  type RenderProjectStillsResult,
} from "../render/render-stills.js";
import {
  readTracker,
  writeTracker,
  upsertItem,
  type TrackerItem,
  type TrackerStatus,
} from "../tracker/tracker.js";
import {
  projectPaths,
  writeJson,
  readJson,
  readBrief,
  listProjects,
  type ProjectSummary,
} from "../store/store.js";
import {
  type SafetyReport,
  type SafetyIssue,
  type TtsProvider,
} from "../types.js";
import { ok, err, type ToolResult } from "./tool-result.js";

/**
 * The internal engine tool facade (tool-productization R3). Each tool is a
 * plain async function returning a `ToolResult` so it is unit-testable without a
 * transport. Every tool drives the single-process orchestrator, so the full
 * `N1-N30` grid, the draft-first gate, determinism, caches, and the Vivibe
 * provider rule apply identically to the CLI (R3.3, R3.5, R10.1).
 */

// --- injectable deps (real pipeline by default) ---------------------------

export type ToolDeps = {
  ingestUrl: typeof ingestUrl;
  scaffoldVideoProject: typeof scaffoldVideoProject;
  renderProject: typeof renderProject;
  renderProjectStills: typeof renderProjectStills;
  runDoctor: typeof runDoctor;
  listProjects: typeof listProjects;
  readTracker: typeof readTracker;
  writeTracker: typeof writeTracker;
  /** Does a reviewed draft exist for this project? (draft-first gate input.) */
  draftExistsFor: (projectId: string) => boolean;
  /** TTS config presence — used to refuse a downgrade, never to substitute. */
  ttsConfig: (projectId: string) => TtsConfig | Promise<TtsConfig>;
};

export type TtsConfig = {
  provider?: TtsProvider;
  apiKey: string;
  voiceId: string | undefined;
  modelId?: string;
};

/** Default draft-first input: the orchestrator writes `<id>.draft.mp4` here. */
export function draftExistsFor(projectId: string): boolean {
  return existsSync(join(projectPaths(projectId).rendersDir, `${projectId}.draft.mp4`));
}

/** Pure draft-first decision (R3.4, Property 8): allowed iff a draft exists OR forceFull. */
export function fullRenderAllowed(draftExists: boolean, forceFull: boolean): boolean {
  return draftExists || forceFull;
}

const DEFAULT_DEPS: ToolDeps = {
  ingestUrl,
  scaffoldVideoProject,
  renderProject,
  renderProjectStills,
  runDoctor,
  listProjects,
  readTracker,
  writeTracker,
  draftExistsFor,
  ttsConfig: async (projectId) => {
    const brief = await readBrief(projectId);
    const provider = brief.tts.provider;
    if (provider === "elevenlabs") {
      return {
        provider,
        apiKey: elevenLabsApiKey(),
        voiceId: brief.tts.voiceId ?? defaultElevenLabsVoiceId(),
        modelId: brief.tts.modelId ?? ELEVENLABS_DEFAULT_MODEL_ID,
      };
    }
    return {
      provider,
      apiKey: vivibeApiKey(),
      voiceId: brief.tts.voiceId ?? defaultVivibeVoiceId(),
      modelId: brief.tts.modelId,
    };
  },
};

// --- input schemas (Zod) ---------------------------------------------------

export const TRACKER_STATUSES = ["pending", "in-progress", "done", "failed", "paused-resumable"] as const;

export const ingestUrlInput = z.object({
  url: z.string().url(),
  id: z.string().min(1).optional(),
});

export const scaffoldProjectInput = z.object({
  prompt: z.string().min(1),
  projectId: z.string().min(1).optional(),
  duration: z.union([z.literal(60), z.literal(90), z.literal(120), z.literal(180)]).optional(),
  language: z.enum(["vi", "en"]).optional(),
  ttsProvider: z.enum(["vivibe", "elevenlabs"]).optional(),
  voiceId: z.string().min(1).optional(),
  modelId: z.string().min(1).optional(),
});

export const renderDraftInput = z.object({
  projectId: z.string().min(1),
  /** Optional render concurrency cap; lower values are more stable under Electron. */
  concurrency: z.number().int().positive().optional(),
});

export const renderFullInput = z.object({
  projectId: z.string().min(1),
  forceFull: z.boolean().optional(),
});

export const getSafetyReportInput = z.object({
  projectId: z.string().min(1),
});

export const renderStillsInput = z.object({
  projectId: z.string().min(1),
  /** Render only these scene ids (the scenes a refine pass touched); absent ⇒ all. */
  sceneIds: z.array(z.string().min(1)).optional(),
});

export const doctorInput = z.object({});

export const listProjectsInput = z.object({});

export const trackerListInput = z.object({
  trackerPath: z.string().min(1).optional(),
});

export const trackerAddInput = z.object({
  trackerPath: z.string().min(1).optional(),
  url: z.string().url(),
  title: z.string().default(""),
  source: z.string().default(""),
  id: z.string().min(1).optional(),
});

export const trackerUpdateInput = z.object({
  trackerPath: z.string().min(1).optional(),
  id: z.string().min(1),
  status: z.enum(TRACKER_STATUSES).optional(),
  reason: z.string().optional(),
  projectId: z.string().optional(),
});

// --- safety-report persistence (web-dashboard Task 2.1, R6.1/R6.2) ---------

/** Where the last render's safety report is persisted, per project. */
function safetyReportPath(projectId: string): string {
  return join(projectPaths(projectId).root, "safety-report.json");
}

/** Persist the report from the latest render so the repair loop can read it back. */
async function persistSafetyReport(projectId: string, report: SafetyReport): Promise<void> {
  try {
    await writeJson(safetyReportPath(projectId), report);
  } catch {
    // best-effort: a persistence failure must never fail the render itself.
  }
}

/**
 * Resolve the project's chosen BGM (freeform-engine I2/O4) to an absolute path
 * for the mixer. The selection lives on the manifest's `bgm` field: a user
 * library filename or the virtual bundled-default name. Empty/stale/deleted
 * refs resolve to undefined. This boundary converts that result to null so a
 * project that says "Không nhạc" explicitly disables the bundled orchestrator
 * BGM fallback.
 */
async function resolveProjectBgm(projectId: string): Promise<string | null> {
  try {
    const manifest = await readJson<{ bgm?: unknown }>(projectPaths(projectId).manifest);
    return resolveBgmTrack(typeof manifest.bgm === "string" ? manifest.bgm : undefined) ?? null;
  } catch {
    return null;
  }
}

/** The shape `get_safety_report` returns: the hard-error subset split from warnings. */
export type SafetyReportView = { ok: boolean; hardErrors: SafetyIssue[]; warnings: SafetyIssue[] };

// --- TTS guard (R3.6, R10.9, Property 10) ----------------------------------

/**
 * Refuse a render when the selected provider config is incomplete, naming the
 * exact missing field and never substituting `mock`/`none`.
 */
function assertTtsConfig({ provider = "vivibe", apiKey, voiceId }: TtsConfig): PipelineError | undefined {
  if (provider === "mock" || provider === "none") return undefined;
  const missing: string[] = [];
  if (provider === "elevenlabs") {
    if (!apiKey) missing.push("ELEVENLABS_API_KEY");
    if (!voiceId) missing.push("ELEVENLABS_VOICE_ID");
  } else {
    if (!apiKey) missing.push("VIVIBE_API_KEY/VIETNAMESE_API_KEY");
    if (!voiceId) missing.push("VIVIBE_VOICE_ID/VIETNAMESE_VOICEID");
  }
  if (missing.length === 0) return undefined;
  const label = provider === "elevenlabs" ? "ElevenLabs" : "Vivibe";
  return new PipelineError({
    stage: "config",
    cause: `incomplete ${label} TTS config: missing ${missing.join(", ")}`,
    remediation: `Set the missing ${label} key/voice id; the provider is never downgraded to mock/none.`,
  });
}

// --- the tool set ----------------------------------------------------------

export type Tools = ReturnType<typeof createTools>;

export function createTools(overrides: Partial<ToolDeps> = {}) {
  const deps: ToolDeps = { ...DEFAULT_DEPS, ...overrides };

  return {
    async ingest_url(input: z.infer<typeof ingestUrlInput>): Promise<ToolResult<IngestResult>> {
      try {
        const res = await deps.ingestUrl(input.url, input.id ? { id: input.id } : {});
        return ok(res);
      } catch (e) {
        return err(serializeError(e, "ingest"));
      }
    },

    async scaffold_project(
      input: z.infer<typeof scaffoldProjectInput>,
    ): Promise<ToolResult<ScaffoldVideoProjectResult>> {
      try {
        const res = await deps.scaffoldVideoProject({
          prompt: input.prompt,
          ...(input.projectId ? { projectId: input.projectId } : {}),
          ...(input.duration ? { duration: input.duration } : {}),
          ...(input.language ? { language: input.language } : {}),
          ...(input.ttsProvider ? {
            tts: {
              provider: input.ttsProvider,
              ...(input.voiceId ? { voiceId: input.voiceId } : {}),
              ...(input.modelId ? { modelId: input.modelId } : {}),
            },
          } : {}),
        });
        return ok(res);
      } catch (e) {
        return err(serializeError(e, "config"));
      }
    },

    async render_draft(
      input: z.infer<typeof renderDraftInput>,
      onProgress?: (ratio: number) => void,
      signal?: AbortSignal,
    ): Promise<ToolResult<RenderProjectResult>> {
      const ttsConfig = await deps.ttsConfig(input.projectId);
      const cfgError = assertTtsConfig(ttsConfig);
      if (cfgError) return err(cfgError.toSerialized());
      try {
        // Resolve the project's chosen BGM (manifest `bgm` ref) to an absolute
        // path and pass it via the `bgmPath` opt the orchestrator already mixes
        // under the narration. Absent/stale ref ⇒ null ⇒ explicitly no BGM.
        const bgmPath = await resolveProjectBgm(input.projectId);
        const res = await deps.renderProject(input.projectId, {
          quality: "draft",
          ...(ttsConfig.provider ? { ttsProvider: ttsConfig.provider } : {}),
          ttsApiKey: ttsConfig.apiKey,
          voiceId: ttsConfig.voiceId,
          modelId: ttsConfig.modelId,
          bgmPath,
          ...(input.concurrency ? { concurrency: input.concurrency } : {}),
          ...(onProgress ? { onProgress } : {}),
          ...(signal ? { signal } : {}),
        });
        await persistSafetyReport(input.projectId, res.report);
        return ok(res);
      } catch (e) {
        return err(serializeError(e, "render"));
      }
    },

    async render_full(
      input: z.infer<typeof renderFullInput>,
      onProgress?: (ratio: number) => void,
      signal?: AbortSignal,
    ): Promise<ToolResult<RenderProjectResult>> {
      const forceFull = input.forceFull ?? false;
      // Draft-first gate at the surface (R3.4): refuse a full render with no
      // prior draft unless forceFull — the orchestrator enforces it again.
      if (!fullRenderAllowed(deps.draftExistsFor(input.projectId), forceFull)) {
        return err(
          new PipelineError({
            stage: "render",
            cause: `full render blocked: no draft exists for "${input.projectId}"`,
            remediation: "Render a draft (render_draft) and have the user review it first, or pass forceFull: true.",
          }).toSerialized(),
        );
      }
      const ttsConfig = await deps.ttsConfig(input.projectId);
      const cfgError = assertTtsConfig(ttsConfig);
      if (cfgError) return err(cfgError.toSerialized());
      try {
        const bgmPath = await resolveProjectBgm(input.projectId);
        const res = await deps.renderProject(input.projectId, {
          quality: "full",
          forceFull,
          ...(ttsConfig.provider ? { ttsProvider: ttsConfig.provider } : {}),
          ttsApiKey: ttsConfig.apiKey,
          voiceId: ttsConfig.voiceId,
          modelId: ttsConfig.modelId,
          bgmPath,
          ...(onProgress ? { onProgress } : {}),
          ...(signal ? { signal } : {}),
        });
        await persistSafetyReport(input.projectId, res.report);
        return ok(res);
      } catch (e) {
        return err(serializeError(e, "render"));
      }
    },

    async render_stills(
      input: z.infer<typeof renderStillsInput>,
      onProgress?: (done: number, total: number) => void,
      signal?: AbortSignal,
    ): Promise<ToolResult<RenderProjectStillsResult>> {
      // Stills need NO Vivibe config (no TTS) — this is the cheap visual-only
      // loop the silent refine pass iterates on, so it deliberately skips the
      // provider-config guard the MP4 render tools enforce.
      try {
        const res = await deps.renderProjectStills(input.projectId, {
          ...(input.sceneIds ? { sceneIds: input.sceneIds } : {}),
          ...(onProgress ? { onProgress } : {}),
          ...(signal ? { signal } : {}),
        });
        return ok(res);
      } catch (e) {
        return err(serializeError(e, "render"));
      }
    },

    async get_safety_report(
      input: z.infer<typeof getSafetyReportInput>,
    ): Promise<ToolResult<SafetyReportView>> {
      // Read the report the orchestrator already produced for the last render of
      // this project; split hard errors from warnings for the repair loop
      // (R6.1/R6.2). The grid is NOT re-run here — this only exposes the report.
      try {
        const path = safetyReportPath(input.projectId);
        if (!existsSync(path)) {
          return err(
            new PipelineError({
              stage: "render-oracle",
              cause: `no safety report found for "${input.projectId}" (render a draft first)`,
              remediation: "Run render_draft for this project before requesting its safety report.",
            }).toSerialized(),
          );
        }
        const report = await readJson<SafetyReport>(path);
        const hardErrors = report.issues.filter((i) => i.severity === "error");
        const warnings = report.issues.filter((i) => i.severity !== "error");
        return ok({ ok: hardErrors.length === 0, hardErrors, warnings });
      } catch (e) {
        return err(serializeError(e, "render-oracle"));
      }
    },

    async doctor(): Promise<ToolResult<DoctorReport>> {
      try {
        return ok(await deps.runDoctor());
      } catch (e) {
        return err(serializeError(e, "config"));
      }
    },

    async list_projects(): Promise<ToolResult<ProjectSummary[]>> {
      try {
        return ok(await deps.listProjects());
      } catch (e) {
        return err(serializeError(e, "config"));
      }
    },

    async tracker_list(input: z.infer<typeof trackerListInput>): Promise<ToolResult<TrackerItem[]>> {
      try {
        return ok(await deps.readTracker(input.trackerPath));
      } catch (e) {
        return err(serializeError(e, "config"));
      }
    },

    async tracker_add(input: z.infer<typeof trackerAddInput>): Promise<ToolResult<TrackerItem>> {
      try {
        const items = await deps.readTracker(input.trackerPath);
        const id = input.id ?? slugFromUrl(input.url);
        const item: TrackerItem = {
          id,
          url: input.url,
          title: input.title,
          source: input.source,
          status: "pending",
          updatedAt: new Date().toISOString(),
        };
        await deps.writeTracker(upsertItem(items, item), input.trackerPath);
        return ok(item);
      } catch (e) {
        return err(serializeError(e, "config"));
      }
    },

    async tracker_update(input: z.infer<typeof trackerUpdateInput>): Promise<ToolResult<TrackerItem>> {
      try {
        const items = await deps.readTracker(input.trackerPath);
        const existing = items.find((it) => it.id === input.id);
        if (!existing) {
          return err(
            new PipelineError({
              stage: "config",
              cause: `tracker item not found: "${input.id}"`,
              remediation: "List the tracker to find a valid id, or add the item first.",
            }).toSerialized(),
          );
        }
        const patch: Partial<TrackerItem> & { id: string } = {
          id: input.id,
          updatedAt: new Date().toISOString(),
          ...(input.status ? { status: input.status as TrackerStatus } : {}),
          ...(input.reason !== undefined ? { reason: input.reason } : {}),
          ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
        };
        const next = upsertItem(items, patch);
        await deps.writeTracker(next, input.trackerPath);
        return ok(next.find((it) => it.id === input.id)!);
      } catch (e) {
        return err(serializeError(e, "config"));
      }
    },
  };
}

/** Deterministic slug from a URL host+path (fallback tracker id). */
function slugFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const slug = `${u.hostname}${u.pathname}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48);
    return slug || "item";
  } catch {
    return "item";
  }
}
