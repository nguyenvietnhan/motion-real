import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  ingestUrl,
  scaffoldVideoProject,
  renderProject,
  runDoctor,
  listProjects,
  readTracker,
  writeTracker,
  upsertItem,
  projectPaths,
  writeJson,
  readJson,
  PipelineError,
  serializeError,
  vivibeApiKey,
  defaultVivibeVoiceId,
  type IngestResult,
  type ScaffoldVideoProjectResult,
  type RenderProjectResult,
  type DoctorReport,
  type ProjectSummary,
  type TrackerItem,
  type TrackerStatus,
  type SafetyReport,
  type SafetyIssue,
} from "@news/pipeline";
import { ok, err, type ToolResult } from "./types.js";

/**
 * The MCP tool layer (tool-productization R3). Each tool is a plain async
 * function returning a `ToolResult` so it is unit-testable without a transport;
 * `server.ts` adapts these to MCP `registerTool` handlers. Every tool drives the
 * single-process orchestrator (`@news/pipeline` imported from source), so the
 * full `N1–N30` grid, the draft-first gate, determinism, caches, and the Vivibe
 * provider rule apply identically to the CLI (R3.3, R3.5, R10.1).
 */

// --- injectable deps (real pipeline by default) ---------------------------

export type ToolDeps = {
  ingestUrl: typeof ingestUrl;
  scaffoldVideoProject: typeof scaffoldVideoProject;
  renderProject: typeof renderProject;
  runDoctor: typeof runDoctor;
  listProjects: typeof listProjects;
  readTracker: typeof readTracker;
  writeTracker: typeof writeTracker;
  /** Does a reviewed draft exist for this project? (draft-first gate input.) */
  draftExistsFor: (projectId: string) => boolean;
  /** TTS config presence — used to refuse a downgrade, never to substitute. */
  ttsConfig: () => { apiKey: string; voiceId: string | undefined };
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
  runDoctor,
  listProjects,
  readTracker,
  writeTracker,
  draftExistsFor,
  ttsConfig: () => ({ apiKey: vivibeApiKey(), voiceId: defaultVivibeVoiceId() }),
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

/** The shape `get_safety_report` returns: the hard-error subset split from warnings. */
export type SafetyReportView = { ok: boolean; hardErrors: SafetyIssue[]; warnings: SafetyIssue[] };

// --- TTS guard (R3.6, R10.9, Property 10) ----------------------------------

/**
 * Refuse a render when the Vivibe config is incomplete, naming the EXACT missing
 * field — and never substituting `mock`/`none`. The provider stays Vivibe.
 */
function assertVivibeConfig(deps: ToolDeps): PipelineError | undefined {
  const { apiKey, voiceId } = deps.ttsConfig();
  const missing: string[] = [];
  if (!apiKey) missing.push("VIVIBE_API_KEY/VIETNAMESE_API_KEY");
  if (!voiceId) missing.push("VIVIBE_VOICE_ID/VIETNAMESE_VOICEID");
  if (missing.length === 0) return undefined;
  return new PipelineError({
    stage: "config",
    cause: `incomplete Vivibe TTS config: missing ${missing.join(", ")}`,
    remediation: "Set the missing Vivibe key/voice id in .env; the provider stays Vivibe (never downgraded to mock/none).",
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
        });
        return ok(res);
      } catch (e) {
        return err(serializeError(e, "config"));
      }
    },

    async render_draft(
      input: z.infer<typeof renderDraftInput>,
      onProgress?: (ratio: number) => void,
    ): Promise<ToolResult<RenderProjectResult>> {
      const cfgError = assertVivibeConfig(deps);
      if (cfgError) return err(cfgError.toSerialized());
      try {
        const res = await deps.renderProject(input.projectId, {
          quality: "draft",
          ...(input.concurrency ? { concurrency: input.concurrency } : {}),
          ...(onProgress ? { onProgress } : {}),
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
      const cfgError = assertVivibeConfig(deps);
      if (cfgError) return err(cfgError.toSerialized());
      try {
        const res = await deps.renderProject(input.projectId, {
          quality: "full",
          forceFull,
          ...(onProgress ? { onProgress } : {}),
        });
        await persistSafetyReport(input.projectId, res.report);
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
