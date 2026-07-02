/**
 * @news/mcp — a Model Context Protocol server exposing the @news/pipeline
 * orchestrator as typed tools (tool-productization R3). It is a thin leaf
 * adapter over the pipeline-owned tool facade. No second registry, no in-tool
 * planner.
 *
 * This barrel re-exports the tool facade + result type for compatibility while
 * the external stdio server still exists.
 */

export {
  createTools,
  draftExistsFor,
  fullRenderAllowed,
  ingestUrlInput,
  scaffoldProjectInput,
  renderDraftInput,
  renderFullInput,
  getSafetyReportInput,
  renderStillsInput,
  doctorInput,
  listProjectsInput,
  trackerListInput,
  trackerAddInput,
  trackerUpdateInput,
  type ToolDeps,
  type Tools,
  type TtsConfig,
  type SafetyReportView,
  type ToolResult,
} from "@news/pipeline";
export * from "./server.js";
