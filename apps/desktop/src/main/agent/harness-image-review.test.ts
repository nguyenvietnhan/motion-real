import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertHarnessImageReads, readHarnessReviewHistory } from "./harness-image-review.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const event = (seq: number, type: string, data: Record<string, unknown>) => ({ seq, type, data });
const image = { type: "image", attachment: {
  attachmentId: "attachment-fixture", mediaType: "image/png", bytes: 70, width: 1, height: 1,
} };
const call = (seq: number, path: string, name = "read_image") => event(seq, "tool/call", {
  callId: `call-${seq}`, name, arguments: JSON.stringify({ file_path: path }),
});
const result = (seq: number, callId: string, isError = false, content: unknown[] = [image]) => event(seq, "tool/result", {
  message: { content: [{ type: "tool-result", toolCallId: callId, isError, content }] },
});
const assistant = (seq: number) => event(seq, "assistant/message", { message: { content: [{ type: "text", text: "Reviewed" }] } });
const page = (events: unknown[], hasMore = false) => ({ events: events.map((event) => ({ event })), hasMore });

async function fixture(count = 2) {
  const root = await mkdtemp(join(tmpdir(), "motionreal-image-evidence-"));
  roots.push(root);
  const project = join(root, "actual-project");
  await mkdir(join(project, "review"), { recursive: true });
  await symlink(project, join(root, "project"), "junction");
  const stills = Array.from({ length: count }, (_, index) => `project/review/scene-${String(index + 1).padStart(2, "0")}.png`);
  await Promise.all(stills.map((path) => writeFile(join(root, path), "fixture")));
  return { root, project, stills };
}

describe("Harness image-read evidence", () => {
  it("accepts successful native attachments through relative, absolute and junction paths", async () => {
    const { root, project, stills } = await fixture();
    const events = [call(11, stills[0]!), result(12, "call-11"), call(13, join(project, "review", "scene-02.png")), result(14, "call-13"), assistant(15)];
    await expect(assertHarnessImageReads({ root, stills, maxStills: 6, afterSeq: 10, events })).resolves.toBeUndefined();
  });

  it("accepts the bounded 18-artifact worst case for a 15-scene composite review", async () => {
    const { root, stills } = await fixture(18);
    const events = stills.flatMap((path, index) => {
      const seq = 11 + index * 2;
      return [call(seq, path), result(seq + 1, `call-${seq}`)];
    });
    events.push(assistant(11 + stills.length * 2));
    await expect(assertHarnessImageReads({ root, stills, maxStills: 18, afterSeq: 10, events })).resolves.toBeUndefined();
  });

  it.each(["no-reads", "old-request", "failed", "text-only", "wrong-tool", "wrong-file", "partial", "same-step", "interrupted", "missing-marker"])("rejects %s even when the model claims it reviewed every scene", async (failure) => {
    const { root, stills } = await fixture();
    let events = [call(11, stills[0]!), result(12, "call-11"), call(13, stills[1]!), result(14, "call-13"), assistant(15)];
    let afterSeq: unknown = 10;
    if (failure === "no-reads") events = [assistant(15)];
    if (failure === "old-request") afterSeq = 14;
    if (failure === "failed") events[1] = result(12, "call-11", true);
    if (failure === "text-only") events[1] = result(12, "call-11", false, [{ type: "text", text: "I opened the PNG" }]);
    if (failure === "wrong-tool") events[0] = call(11, stills[0]!, "read");
    if (failure === "wrong-file") events[0] = call(11, "project/review/other.png");
    if (failure === "partial") events = events.filter((entry) => entry.seq !== 14);
    if (failure === "same-step") events = [assistant(10), ...events.slice(0, -1)];
    if (failure === "interrupted") events[4] = event(15, "assistant/message", { interrupted: true });
    if (failure === "missing-marker") afterSeq = undefined;
    await expect(assertHarnessImageReads({ root, stills, maxStills: 6, afterSeq, events })).rejects.toThrow(/read_image|mốc đọc ảnh/);
  });

  it("does not count a call started before the request even if it completes afterwards", async () => {
    const { root, stills } = await fixture();
    await expect(assertHarnessImageReads({ root, stills: [stills[0]], maxStills: 3, afterSeq: 11,
      events: [call(11, stills[0]!), result(12, "call-11"), assistant(15)],
    })).rejects.toThrow(/read_image/);
  });

  it("rejects missing, duplicate or out-of-scope still paths", async () => {
    const { root, stills } = await fixture();
    for (const paths of [[], [stills[0], stills[0]], ["../outside.png"]]) {
      await expect(assertHarnessImageReads({ root, stills: paths, maxStills: 6, afterSeq: 10, events: [] })).rejects.toThrow(/still/);
    }
  });

  it("rejects a still list larger than the review scope allows", async () => {
    const { root, stills } = await fixture(2);
    await expect(assertHarnessImageReads({ root, stills, maxStills: 1, afterSeq: 10, events: [] })).rejects.toThrow(/still/);
  });
});

describe("native review history pagination", () => {
  it("gets a tail sequence without loading the whole conversation", async () => {
    const load = vi.fn(async () => page([assistant(90), event(95, "turn/end", {})], true));
    expect((await readHarnessReviewHistory(load)).lastSeq).toBe(95);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("loads backwards until the request boundary, retaining split call/result evidence", async () => {
    const load = vi.fn(async (beforeSeq?: number) => beforeSeq === undefined
      ? page([result(14, "call-11"), assistant(15)], true)
      : page([assistant(9), call(11, "project/review/one.png")], true));
    const history = await readHarnessReviewHistory(load, 10);
    expect(history.lastSeq).toBe(15);
    expect(history.events.map((entry) => entry.seq)).toEqual([11, 14, 15]);
    expect(load.mock.calls).toEqual([[undefined], [14]]);
  });

  it("handles an empty session and rejects malformed or non-progressing pages", async () => {
    await expect(readHarnessReviewHistory(async () => page([]))).resolves.toEqual({ events: [], lastSeq: -1 });
    await expect(readHarnessReviewHistory(async () => ({}), 10)).rejects.toThrow(/session.history/);
    await expect(readHarnessReviewHistory(async () => page([], true), 10)).rejects.toThrow(/trang cũ/);
    await expect(readHarnessReviewHistory(async () => page([assistant(15)], true), 10)).rejects.toThrow(/cursor/);
  });
});
