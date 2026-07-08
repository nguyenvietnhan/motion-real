import { describe, expect, it, vi } from "vitest";
import { GatewayChatError, NineRouterClient, type FetchImpl } from "./ninerouter-client.js";

/**
 * chat retry/backoff self-tests. The gateway talks to an upstream provider
 * (Codex/Gemini/Kiro/…) that can answer a TRANSIENT 502/503/504/429 or drop the
 * socket during a cold start; chat must auto-retry those (with backoff) before
 * surfacing a typed GatewayChatError, while failing fast on a non-retryable HTTP
 * status (4xx) and on a hard timeout. `fetchImpl`/`sleep` are injected so these
 * run with no live network and no real wall-clock delay.
 */

const MSG = [{ role: "user" as const, content: "hi" }];

/** A JSON chat-completion Response with the given assistant text + optional finish_reason. */
function okReply(text: string, finishReason?: string): Response {
  const choice: Record<string, unknown> = { message: { content: text } };
  if (finishReason) choice.finish_reason = finishReason;
  return new Response(JSON.stringify({ choices: [choice] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** An error Response with the given status (empty body). */
function statusReply(status: number): Response {
  return new Response("upstream error", { status });
}

/** Build a client whose fetch returns each queued result in order; sleep is a no-op. */
function clientWith(results: Array<Response | Error>): { client: NineRouterClient; calls: () => number; requests: unknown[] } {
  let i = 0;
  const requests: unknown[] = [];
  const fetchImpl: FetchImpl = async (_url, init) => {
    requests.push(JSON.parse(String(init.body ?? "{}")));
    const r = results[Math.min(i, results.length - 1)] ?? statusReply(500);
    i++;
    if (r instanceof Error) throw r;
    // A Response body can be read only once; the continuation loop may pull the
    // SAME queued reply across several passes (e.g. the bounded-passes test reuses
    // one "length" reply), so hand back a fresh clone each call.
    return r.clone();
  };
  const sleep = vi.fn(async () => {});
  const client = new NineRouterClient("http://test", { fetchImpl, sleep });
  return { client, calls: () => i, requests };
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

describe("NineRouterClient.chat continuation (finish_reason: length)", () => {
  it("stitches a continuation pass when the first reply hit the token cap", async () => {
    // First reply stopped on "length" (truncated); the second finishes ("stop").
    // The two pieces concatenate into one full reply.
    const { client, calls } = clientWith([okReply("phần đầu ", "length"), okReply("phần cuối", "stop")]);
    expect(await client.chat("m", MSG)).toBe("phần đầu phần cuối");
    expect(calls()).toBe(2);
  });

  it("baseline: continuation uses one assistant echo plus one exact continue instruction", async () => {
    const { client, requests } = clientWith([okReply("phần đầu ", "length"), okReply("phần cuối", "stop")]);

    await client.chat("m", MSG);

    const second = requests[1] as { messages: Array<{ role: string; content: string }> };
    expect(second.messages).toHaveLength(3);
    expect(second.messages[0]).toEqual(MSG[0]);
    expect(second.messages[1]).toEqual({ role: "assistant", content: "phần đầu " });
    expect(second.messages[2]!.role).toBe("user");
    expect(second.messages[2]!.content).toContain("VIẾT TIẾP CHÍNH XÁC");
    expect(second.messages[2]!.content).toHaveLength(164);
  });

  it("returns immediately when the first reply finished (no continuation)", async () => {
    const { client, calls } = clientWith([okReply("xong", "stop")]);
    expect(await client.chat("m", MSG)).toBe("xong");
    expect(calls()).toBe(1);
  });

  it("a reply with no finish_reason is treated as complete (back-compat)", async () => {
    const { client, calls } = clientWith([okReply("không có finish_reason")]);
    expect(await client.chat("m", MSG)).toBe("không có finish_reason");
    expect(calls()).toBe(1);
  });

  it("bounds continuation to MAX_CONTINUATION_PASSES even if every pass stays truncated", async () => {
    // Every reply says "length"; the loop must stop after the bounded passes
    // (1 initial + 3 continuations = 4 calls) rather than looping forever.
    const { client, calls } = clientWith([okReply("x", "length")]);
    const out = await client.chat("m", MSG);
    expect(out).toBe("xxxx"); // initial + 3 continuation passes
    expect(calls()).toBe(4);
  });

  it("does not continue when the signal is already aborted (no extra passes)", async () => {
    // A pre-aborted signal: the first turn still runs (the caller owns that), but
    // the truncation-continuation loop must NOT fire additional passes.
    const ctrl = new AbortController();
    ctrl.abort();
    const { client, calls } = clientWith([okReply("một phần", "length")]);
    const out = await client.chat("m", MSG, { signal: ctrl.signal });
    expect(out).toBe("một phần"); // only the first piece; no continuation
    expect(calls()).toBe(1);
  });
});

describe("NineRouterClient best-effort management fallbacks", () => {
  const failingFetch: FetchImpl = async () => { throw new Error("gateway offline"); };

  it("reports unreachable instead of throwing when the reachability request fails", async () => {
    const client = new NineRouterClient("http://test", { fetchImpl: failingFetch });
    await expect(client.isReachable()).resolves.toBe(false);
  });

  it("returns empty provider/model lists when management requests fail", async () => {
    const client = new NineRouterClient("http://test", { fetchImpl: failingFetch });
    await expect(client.connectedAccounts()).resolves.toEqual([]);
    await expect(client.listModels()).resolves.toEqual([]);
  });

  it("returns null when API-key creation fails", async () => {
    const client = new NineRouterClient("http://test", { fetchImpl: failingFetch });
    await expect(client.createApiKey("news-studio")).resolves.toBeNull();
  });
});
