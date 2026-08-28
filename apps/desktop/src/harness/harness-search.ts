import { addAbortListener } from "node:events";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

type SearchScope = {
  tools: { schemas(scope?: unknown): Array<{ name: string }>; restrict(filter: { deny: string[] }): unknown };
  systemPrompt: { section(section: { name: string; order: number; text: string }): unknown };
};

export type HarnessSearchContext = {
  on(event: "agent/created", listener: (payload: { agent: { ctx: SearchScope } }) => void): unknown;
  on(event: "system-prompt/assemble", listener: (assembly: unknown, context: { signal?: AbortSignal }, next: () => Promise<unknown>) => Promise<unknown>): unknown;
  systemPrompt: { assemble(context: { signal?: AbortSignal }): Promise<unknown> };
};

/** Native tool restrictions plus a one-time assembly barrier, not another agent loop. */
export function installSearchHooks(ctx: HarnessSearchContext, ready: Promise<void>): void {
  let settled = false;
  let failure: unknown;
  const initialization = ready.then(() => { settled = true; }, (error) => { failure = error; settled = true; });
  ctx.on("agent/created", ({ agent }) => {
    if (agent.ctx.tools.schemas(agent).some((tool) => tool.name === "web_search")) {
      agent.ctx.tools.restrict({ deny: ["web_search"] });
      agent.ctx.systemPrompt.section({ name: "tool:web_search", order: 110,
        text: "Use mcp__exa__web_search_exa for web search. Cite source URLs. If unavailable or rate-limited, report that failure; do not claim research succeeded." });
    }
  });
  ctx.on("system-prompt/assemble", async (_assembly, context, next) => {
    if (failure) throw failure;
    if (settled) return next();
    context.signal?.throwIfAborted();
    let subscription: Disposable | undefined;
    try {
      await Promise.race([initialization, new Promise<never>((_resolve, reject) => {
        if (context.signal) subscription = addAbortListener(context.signal, () => reject(context.signal!.reason));
      })]);
    } finally {
      subscription?.[Symbol.dispose]();
    }
    // The first assembly captured schemas before discovery finished. Reassemble
    // through Harness so tool ordering, Code Mode and other providers stay intact.
    return ctx.systemPrompt.assemble(context);
  });
}

export async function enableExaSearch(ctx: HarnessSearchContext, harnessCliPath: string): Promise<void> {
  const moduleUrl = pathToFileURL(createRequire(harnessCliPath).resolve("@deepseek-ai/dsh-mcp-client")).href;
  const initialization = (async () => {
    const mcp = await import(moduleUrl);
    await mcp.apply(ctx, mcp.Config({ serverName: "exa", transport: "streamable-http",
      url: "https://mcp.exa.ai/mcp?tools=web_search_exa", toolCallTimeoutMs: 30000, failOnStartupError: false }));
  })();
  installSearchHooks(ctx, initialization);
  await initialization;
}
