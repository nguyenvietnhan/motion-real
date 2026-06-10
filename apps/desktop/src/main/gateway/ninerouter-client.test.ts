import { describe, expect, it, vi } from "vitest";
import { GatewayChatError, NineRouterClient, type FetchImpl } from "./ninerouter-client.js";

/**
 * chat() retry/backoff self-tests. The gateway talks to an upstream provider
 * (Codex/Gemini/Kiro/…) that can answer a TRANSIENT 502/503/504/429 or drop the
 * socket during a cold start; chat() must auto-retry those (with backoff) before
 * surfacing a typed GatewayChatError, while failing fast on a non-retryable HTTP
 * status (4xx) and on a hard timeout. `fetchImpl`/`sleep` are injected so these
 * run with no live network and no real wall-clock delay.
 */

const MSG = [{ role: "user" as const, content: "hi" }];

/** A JSON chat-completion Response with the given assistant text. */
function okReply(text: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** An error Response with the given status (empty body). */
function statusReply(status: number): Response {
  return new Response("upstream error", { status });
}

/** Build a client whose fetch returns each queued result in order; sleep is a no-op. */
function clientWith(results: Array<Response | Error>): { client: NineRouterClient; calls: () => number } {
  let i = 0;
  const fetchImpl: FetchImpl = async () => {
    const r = results[Math.min(i, results.length - 1)] ?? statusReply(500);
    i++;
    if (r instanceof Error) throw r;
    return r;
  };
  const sleep = vi.fn(async () => {});
  const client = new NineRouterClient("http://test", { fetchImpl, sleep });
  return { client, calls: () => i };
}

describe("NineRouterClient.chat retry/backoff", () => {
  it("returns the reply on first success (no retry)", async () => {
    const { client, calls } = clientWith([okReply("xin chào")]);
    expect(await client.chat("m", MSG)).toBe("xin chào");
    expect(calls()).toBe(1);
  });

  it("retries a transient 502 and succeeds on the next attempt", async () => {
    const { client, calls } = clientWith([statusReply(502), okReply("ok-sau-retry")]);
    expect(await client.chat("m", MSG)).toBe("ok-sau-retry");
    expect(calls()).toBe(2); // one failed + one success
  });

  it("retries a dropped socket (network error) then succeeds", async () => {
    const { client, calls } = clientWith([new Error("socket hang up"), okReply("ok")]);
    expect(await client.chat("m", MSG)).toBe("ok");
    expect(calls()).toBe(2);
  });

  it("exhausts retries on a persistent 503 → throws transient GatewayChatError after 3 tries", async () => {
    const { client, calls } = clientWith([statusReply(503)]); // always 503
    await expect(client.chat("m", MSG)).rejects.toMatchObject({
      name: "GatewayChatError",
      kind: "transient",
      status: 503,
      attempts: 3,
    });
    expect(calls()).toBe(3); // MAX_CHAT_ATTEMPTS
  });

  it("does NOT retry a non-retryable HTTP 400 → throws http GatewayChatError at once", async () => {
    const { client, calls } = clientWith([statusReply(400), okReply("never-reached")]);
    await expect(client.chat("m", MSG)).rejects.toMatchObject({
      name: "GatewayChatError",
      kind: "http",
      status: 400,
    });
    expect(calls()).toBe(1); // failed fast, no retry
  });

  it("does NOT retry a 401 unauthorized (fails fast)", async () => {
    const { client, calls } = clientWith([statusReply(401)]);
    await expect(client.chat("m", MSG)).rejects.toBeInstanceOf(GatewayChatError);
    expect(calls()).toBe(1);
  });

  it("stops retrying when the external signal is already aborted", async () => {
    const { client, calls } = clientWith([statusReply(502), okReply("ok")]);
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(client.chat("m", MSG, { signal: ctrl.signal })).rejects.toBeInstanceOf(GatewayChatError);
    expect(calls()).toBe(1); // first attempt failed transient, but aborted → no retry
  });
});
