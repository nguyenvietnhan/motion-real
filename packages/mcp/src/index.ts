/**
 * @news/mcp — a Model Context Protocol server exposing the @news/pipeline
 * orchestrator as typed tools (tool-productization R3). It is a thin leaf
 * adapter: it imports the pipeline from source so it holds the ONE
 * @news/compositions registry instance (single-process constraint, R3.3) — the
 * same path the CLI uses. No second registry, no in-tool planner.
 *
 * This barrel re-exports the tool layer + result type so the server entry and
 * tests share one surface.
 */

export * from "./types.js";
export * from "./tools.js";
export * from "./server.js";
