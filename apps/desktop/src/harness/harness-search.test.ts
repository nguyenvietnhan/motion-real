import { describe, expect, it, vi } from "vitest";
import { installSearchHooks, type HarnessSearchContext } from "./harness-search.js";

function fixture() {
  const listeners = new Map<string, (...args: any[]) => any>();
  const ctx = {
    on: (event: string, listener: (...args: any[]) => any) => listeners.set(event, listener),
    systemPrompt: { assemble: vi.fn(async () => "fresh-tools") },
  } as unknown as HarnessSearchContext;
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  const ready = { promise, resolve, reject };
  installSearchHooks(ctx, ready.promise);
  return { ctx, ready, listeners };
}

describe("native Exa search integration", () => {
  it("waits for MCP once and reassembles the first prompt instead of forwarding its stale catalog", async () => {
    const { ctx, ready, listeners } = fixture();
    const next = vi.fn(async () => "stale-tools");
    const run = listeners.get("system-prompt/assemble")!("stale", {}, next);
    expect(next).not.toHaveBeenCalled();
    ready.resolve();
    await expect(run).resolves.toBe("fresh-tools");
    expect(ctx.systemPrompt.assemble).toHaveBeenCalledTimes(1);
    await expect(listeners.get("system-prompt/assemble")!("current", {}, next)).resolves.toBe("stale-tools");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("cancels the waiting turn without cancelling MCP or poisoning later turns", async () => {
    const { ready, listeners } = fixture();
    const controller = new AbortController();
    const run = listeners.get("system-prompt/assemble")!({}, { signal: controller.signal }, vi.fn());
    controller.abort(new Error("user stopped"));
    await expect(run).rejects.toThrow("user stopped");
    ready.resolve();
    await ready.promise;
    await expect(listeners.get("system-prompt/assemble")!({}, {}, async () => "resumed")).resolves.toBe("resumed");
  });

  it("removes only DeepSeek search through native per-agent restrictions and replaces its old guidance", () => {
    const { ready, listeners } = fixture();
    const restrict = vi.fn();
    const section = vi.fn();
    const schemas = vi.fn((scope?: unknown) => scope ? [{ name: "web_search" }, { name: "pwsh" }] : []);
    const agent = { ctx: { tools: { schemas, restrict }, systemPrompt: { section } } };
    listeners.get("agent/created")!({ agent });
    expect(schemas).toHaveBeenCalledExactlyOnceWith(agent);
    expect(restrict).toHaveBeenCalledExactlyOnceWith({ deny: ["web_search"] });
    expect(section).toHaveBeenCalledWith(expect.objectContaining({ name: "tool:web_search", text: expect.stringContaining("mcp__exa__web_search_exa") }));
    listeners.get("agent/created")!({ agent: { ctx: {
      tools: { schemas: () => [], restrict }, systemPrompt: { section },
    } } });
    expect(restrict).toHaveBeenCalledTimes(1);
    ready.resolve();
  });

  it("surfaces initialization errors rather than treating them as a ready search tool", async () => {
    const { ready, listeners } = fixture();
    ready.reject(new Error("missing MCP dependency"));
    await ready.promise.catch((_error) => undefined);
    await expect(listeners.get("system-prompt/assemble")!({}, {}, vi.fn())).rejects.toThrow("missing MCP dependency");
  });
});
