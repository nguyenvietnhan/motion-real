#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server.js";

/**
 * Entry point for the @news/mcp stdio server. Registered in
 * `.kiro/settings/mcp.json` so MCP-capable agents discover the tools. Imports
 * the orchestrator from source (single registry instance, R3.3).
 */
async function main(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Keep the process alive; the transport drives the lifecycle over stdio.
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("[news-mcp] fatal:", error);
  process.exit(1);
});
