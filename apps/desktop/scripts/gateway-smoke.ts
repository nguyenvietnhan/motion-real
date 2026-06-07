/**
 * 9router gateway smoke test (web-dashboard). Exercises the REAL Model_Gateway
 * integration end-to-end against a live 9router, with NO Electron:
 *   - start (reuse a running 9router, else spawn it headless and wait),
 *   - discover providers + their connected counts + login type,
 *   - list available models,
 *   - show currently connected accounts.
 *
 * Run:  npx tsx apps/desktop/scripts/gateway-smoke.ts
 */
import { ModelGatewayManager } from "../src/main/gateway/model-gateway-manager.js";
import { buildNineRouterGatewayDeps } from "../src/main/gateway/ninerouter-deps.js";

async function main(): Promise<void> {
  const gateway = new ModelGatewayManager(
    buildNineRouterGatewayDeps({
      // In the smoke test we don't open a browser — just report the URL.
      openExternal: (url) => console.log(`  → would open login UI at: ${url}`),
    }),
  );

  console.log("Starting 9router gateway (reuse if already running)…");
  const state = await gateway.start();
  console.log("Gateway state:", JSON.stringify(state));
  if (state.kind !== "ready") {
    console.error("9router did not become reachable. Is it installed? Try: 9router -n -t");
    process.exit(1);
  }

  const providers = await gateway.listProviders();
  console.log(`\nProviders (${providers.length}):`);
  for (const p of providers) {
    console.log(`  - ${p.name.padEnd(16)} [${p.loginType}]  connected: ${p.connectedCount}`);
  }

  const accounts = await gateway.refreshConnections();
  console.log("\nConnected accounts:", JSON.stringify(accounts));

  const models = await gateway.listModels();
  console.log(`\nModels (${models.length}):`);
  for (const m of models.slice(0, 20)) console.log(`  - ${m.id}`);

  console.log("\nAI ready (needs a connection + a selected model)?", gateway.aiReady());
  console.log("\n✓ 9router integration smoke test passed.");
}

main().catch((e) => {
  console.error("Smoke test failed:", e);
  process.exit(1);
});
