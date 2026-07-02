import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  createTools,
  type ToolDeps,
  ingestUrlInput,
  scaffoldProjectInput,
  renderDraftInput,
  renderFullInput,
  renderStillsInput,
  doctorInput,
  listProjectsInput,
  trackerListInput,
  trackerAddInput,
  trackerUpdateInput,
  getSafetyReportInput,
  type ToolResult,
} from "@news/pipeline";

/**
 * Build the MCP server (tool-productization R3). Each tool delegates to the
 * pipeline-owned tool facade (which drives the single-process orchestrator) and renders
 * the `ToolResult` as an MCP `CallToolResult`: the structured payload as JSON
 * text plus `isError` on a failure, so a hard grid failure / refusal surfaces as
 * a failing tool result and never as "done" (R3.5, R10.1).
 */

/** Adapt a ToolResult to an MCP CallToolResult (structured JSON text + isError). */
function toCallResult<T>(result: ToolResult<T>): CallToolResult {
  const text = JSON.stringify(result, null, 2);
  return {
    content: [{ type: "text", text }],
    structuredContent: result as unknown as Record<string, unknown>,
    isError: result.ok === false,
  };
}

export function createMcpServer(overrides: Partial<ToolDeps> = {}): McpServer {
  const tools = createTools(overrides);
  const server = new McpServer(
    { name: "news-remotion-tool", version: "0.1.0" },
    {
      instructions:
        "Author-mode Vietnamese short-form news video pipeline. Tools drive the single-process " +
        "orchestrator; the full N1–N30 safety grid, draft-first gate, determinism, and Vivibe voice " +
        "are always in force. Always render_draft and let the user review before render_full.",
    },
  );

  server.registerTool(
    "ingest_url",
    {
      title: "Ingest article URL",
      description: "Fetch an article and write a grounded research file (text + metadata only, no media) under planning/.",
      inputSchema: ingestUrlInput.shape,
    },
    async (args) => toCallResult(await tools.ingest_url(args)),
  );

  server.registerTool(
    "scaffold_project",
    {
      title: "Scaffold a video project",
      description: "Create a self-contained AUTHOR-mode project (brief + empty manifest + authored/ dir) for a topic.",
      inputSchema: scaffoldProjectInput.shape,
    },
    async (args) => toCallResult(await tools.scaffold_project(args)),
  );

  server.registerTool(
    "render_draft",
    {
      title: "Render a draft preview",
      description: "Render a fast low-res draft (<id>.draft.mp4) for review. Runs the full safety grid + configured TTS.",
      inputSchema: renderDraftInput.shape,
    },
    async (args, extra) => toCallResult(await tools.render_draft(args, makeProgress(extra))),
  );

  server.registerTool(
    "render_full",
    {
      title: "Render the full-quality video",
      description:
        "Render the final MP4. Refused unless a prior draft exists (draft-first gate) or forceFull is set. Runs the full grid.",
      inputSchema: renderFullInput.shape,
    },
    async (args, extra) => toCallResult(await tools.render_full(args, makeProgress(extra))),
  );

  server.registerTool(
    "render_stills",
    {
      title: "Render per-scene stills (fast, no TTS)",
      description:
        "Render one PNG per scene (or a subset via sceneIds) WITHOUT TTS, MP4, or the heavy oracle suite — the cheap inner loop the silent refine pass iterates on.",
      inputSchema: renderStillsInput.shape,
    },
    async (args) => toCallResult(await tools.render_stills(args)),
  );

  server.registerTool(
    "get_safety_report",
    {
      title: "Get the safety-grid report",
      description:
        "Return the last render's safety-grid report for a project, split into hard errors and warnings (drives the generate-validate-repair loop).",
      inputSchema: getSafetyReportInput.shape,
    },
    async (args) => toCallResult(await tools.get_safety_report(args)),
  );

  server.registerTool(
    "doctor",
    {
      title: "Environment readiness check",
      description: "Run all readiness checks (Vivibe .env, ffmpeg, browser, registry, style packs, fonts, MCP wiring).",
      inputSchema: doctorInput.shape,
    },
    async () => toCallResult(await tools.doctor()),
  );

  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description: "List known projects with their pipeline state.",
      inputSchema: listProjectsInput.shape,
    },
    async () => toCallResult(await tools.list_projects()),
  );

  server.registerTool(
    "tracker_list",
    {
      title: "List tracker items",
      description: "List the bulk-production work queue (JSON or CSV).",
      inputSchema: trackerListInput.shape,
    },
    async (args) => toCallResult(await tools.tracker_list(args)),
  );

  server.registerTool(
    "tracker_add",
    {
      title: "Add a tracker item",
      description: "Add a pending item to the bulk-production work queue.",
      inputSchema: trackerAddInput.shape,
    },
    async (args) => toCallResult(await tools.tracker_add(args)),
  );

  server.registerTool(
    "tracker_update",
    {
      title: "Update a tracker item",
      description: "Update a tracker item's status/reason/projectId by id.",
      inputSchema: trackerUpdateInput.shape,
    },
    async (args) => toCallResult(await tools.tracker_update(args)),
  );

  return server;
}

/** Map orchestrator progress (0..1) to MCP progress notifications when a token is present (R3.9). */
function makeProgress(extra: unknown): ((ratio: number) => void) | undefined {
  const e = extra as
    | { sendNotification?: (n: unknown) => unknown; _meta?: { progressToken?: string | number } }
    | undefined;
  const token = e?._meta?.progressToken;
  if (token === undefined || !e?.sendNotification) return undefined;
  const send = e.sendNotification;
  return (ratio: number) => {
    try {
      send({
        method: "notifications/progress",
        params: { progressToken: token, progress: Math.round(ratio * 100), total: 100 },
      });
    } catch {
      // progress is best-effort; never let it fail a render
    }
  };
}
