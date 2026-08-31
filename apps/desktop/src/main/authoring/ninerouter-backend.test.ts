import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NineRouterAuthoringBackend, authorCallErrorMessage, isLogicChanged, type NineRouterBackendDeps } from "./ninerouter-backend.js";
import { GatewayChatError, type NineRouterClient, type ChatMessage, type ContentPart } from "../gateway/ninerouter-client.js";
import type { AuthorJob } from "../agent/agent-worker.js";
import { INVALID_PURPOSE_CONTENT_PLAN_REPLY } from "./__fixtures__/authoring-failure-incidents.js";

/**
 * — authorScenes writes AI-authored `.tsx` modules
 * + an open-id manifest and admits them (no kit fallback). Admission is stubbed
 * (the real esbuild loader's repo-root resolution doesn't hold under vitest).
 */

let home: string;
let previousHome: string | undefined;
beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "nrt-author-"));
  previousHome = process.env.VIDEO_TOOL_HOME;
  process.env.VIDEO_TOOL_HOME = home;
});
afterAll(() => {
  rmSync(home, { recursive: true, force: true });
  if (previousHome === undefined) delete process.env.VIDEO_TOOL_HOME;
  else process.env.VIDEO_TOOL_HOME = previousHome;
});

function block(id: string): string {
  return [
    "```tsx",
    `// component: ${id}`,
    'import { registerComponent } from "@motionreal/compositions";',
    "export const schema = {};",
    "export const example = {};",
    `export default registerComponent({ id: "${id}" });`,
    "```",
  ].join("\n");
}

function ids(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `scene-${String(index + 1).padStart(2, "0")}`);
}

function blocksFor(componentIds: readonly string[]): string {
  return componentIds.map((id) => block(id)).join("\n\n");
}

function bareBlock(id: string): string {
  return [
    `// component: ${id}`,
    'import { registerComponent } from "@motionreal/compositions";',
    "export const schema = {};",
    "export const example = {};",
    `export default registerComponent({ id: "${id}" });`,
  ].join("\n");
}

function bareBatchWithTrailingFence(componentIds: readonly string[]): string {
  return `${componentIds.map((id) => bareBlock(id)).join("\n\n")}\n\`\`\`\n`;
}

function validAuthorManifest() {
  return {
    title: "Video kiểm thử pure-author",
    theme: { dominant: "#1E9CB0" },
    scenes: [
      { component: "alpha", eyebrow: "A", headline: "Một", narration: "Câu một." },
      { component: "beta", eyebrow: "B", headline: "Hai", narration: "Câu hai." },
      { component: "alpha", eyebrow: "C", headline: "Ba", narration: "Câu ba." },
    ],
  };
}

function manifestOnlyReply(): string {
  return "```json\n" + JSON.stringify(validAuthorManifest()) + "\n```";
}

function validReply(): string {
  const manifest = validAuthorManifest();
  return "```json\n" + JSON.stringify(manifest) + "\n```\n\n" + block("alpha") + "\n\n" + block("beta");
}

function partialReply(): string {
  return manifestOnlyReply() + "\n\n" + block("alpha");
}

function validContentPlanReply(): string {
  const plan = {
    title: "Vì sao chip AI đắt",
    viewerPromise: "Người xem hiểu nút thắt khiến phần cứng AI trở nên đắt đỏ.",
    hookType: "contradiction",
    first3SecondsLine: "Con chip không đắt vì nó nhỏ. Nó đắt vì gần như không ai làm nổi.",
    openLoop: "Điểm nghẽn thật sự nằm ở cánh cửa sản xuất.",
    payoff: "Giá trị nằm ở năng lực sản xuất khan hiếm, không phải kích thước con chip.",
    claims: [
      {
        id: "claim-01",
        text: "Năng lực sản xuất chip tiên tiến tập trung vào rất ít nhà máy.",
        // user_brief: text-only and mixed-URL fixtures must not fail claim-provenance
        // when readable sources exist without matching sourceRef excerpts.
        support: "user_brief",
        confidence: "supported",
        action: "use",
      },
      {
        id: "claim-02",
        text: "Unsupported $999 launch price.",
        support: "source_material",
        confidence: "uncertain",
        action: "omit",
      },
    ],
    scenes: [
      {
        sceneId: "scene-01",
        purpose: "hook",
        beat: "Reveal scarcity before specs.",
        narration:
          "Con chip không đắt vì nó nhỏ. Nó đắt vì gần như không ai làm nổi. Khi năng lực sản xuất bị khóa, mọi thông số kỹ thuật chỉ còn là lời hứa trên giấy cho đến khi lô hàng thật ra khỏi nhà máy. Người xem cần nghe rõ nút thắt trước khi chạm vào bất kỳ thông số nào. Đây là mở đầu để hiểu vì sao năng lực khan hiếm định hình cả chuỗi giá trị.",
        onScreenText: "Đắt vì khan hiếm",
        visualMetaphor: "A tiny glowing chip behind a locked factory gate.",
        motionProgression: "Quick entrance: chip pops in under a second; semantic: the gate closes; living: the lock keeps a small warning pulse.",
        layoutFamily: "signature-visual",
        evidenceClaimIds: ["claim-01"],
      },
      {
        sceneId: "scene-02",
        purpose: "context",
        beat: "Show why capacity, not hype, is the bottleneck.",
        narration:
          "Khi chỉ vài nơi làm được, mỗi đơn hàng phải xếp hàng trước một cánh cửa hẹp. Hàng đợi dài không phải vì marketing ồn, mà vì mỗi lô chip phải chen chúc qua cùng một nút thắt sản xuất. Cổ chai thật sự nằm ở nhà máy, không nằm ở quảng cáo. Người xem theo dõi hàng đợi để thấy áp lực thật của cửa hẹp.",
        onScreenText: "Cổ chai là nhà máy",
        visualMetaphor: "A narrowing production timeline.",
        motionProgression: "Quick entrance: chips enter the timeline; semantic: the path narrows into one gate; final hold when the queue pauses at the bottleneck.",
        layoutFamily: "timeline",
        evidenceClaimIds: ["claim-01"],
      },
      {
        sceneId: "scene-03",
        purpose: "payoff",
        beat: "Resolve the open loop with the scarcity takeaway.",
        narration:
          "Thứ được định giá không phải vật liệu, mà là quyền bước qua cánh cổng sản xuất. Ai nắm cửa đó nắm chuỗi cung, và giá phản ánh đúng sức ép của cửa hẹp ấy. Kết lại: khan hiếm năng lực quyết định giá trị thực. Người xem mang theo một khung nhìn rõ về chỗ thắt cổ chai.",
        onScreenText: "Giá nằm ở năng lực biến thiết kế thành hàng thật",
        visualMetaphor: "Blueprint lines turning into one finished glowing chip.",
        motionProgression: "Quick entrance: blueprint frame appears; semantic: traces brighten into one finished chip; living: a small glow pulse continues through the payoff.",
        layoutFamily: "diagram",
        evidenceClaimIds: ["claim-01"],
      },
    ],
  };
  return JSON.stringify(plan);
}

/** ~17 words — pads tier-3 minTotalNarrationWords without inventing numbers/years. */
const LONG_PLAN_NARRATION_PAD =
  " The viewer keeps following the scarce production gate and why waiting lines form under real capacity pressure.";

function longContentPlanReply(count: number, overrides: { unsupportedFirstScene?: boolean } = {}): string {
  const purposes = ["context", "turn", "proof", "contrast"] as const;
  const layouts = ["signature-visual", "timeline", "diagram", "list"] as const;
  const scenes = ids(count).map((sceneId, index) => {
    const first = index === 0;
    const last = index === count - 1;
    const baseNarration =
      first && overrides.unsupportedFirstScene
        ? "The prototype reached 500 cycles in 2026 without usable evidence. That claim stays unsupported until a source backs it."
        : first
          ? "The bottleneck appears before the viewer sees any specification. Capacity, not hype, decides who ships and who waits in line for the same scarce process."
          : last
            ? "The story resolves by showing why the bottleneck matters. Price tracks the right to pass the narrow gate, not the bulk cost of raw material alone."
            : `This beat adds one concrete step in the explanation without inventing measurements. The viewer learns how the queue forms and why each station still depends on the same choke point.`;
    return {
      sceneId,
      purpose: first ? "hook" : last ? "payoff" : purposes[(index - 1) % purposes.length],
      beat: first ? "Open with the bottleneck." : last ? "Resolve the open loop." : `Advance beat ${index + 1}.`,
      // Pad every scene so tier-3 under-budget (≥388 words) passes for N=10..14.
      narration: `${baseNarration}${LONG_PLAN_NARRATION_PAD}`,
      onScreenText: first && overrides.unsupportedFirstScene ? "500 cycles in 2026" : first ? "The bottleneck first" : last ? "The bottleneck decides" : `Step ${index + 1}`,
      visualMetaphor: first ? "A small chip behind a locked gate." : last ? "A gate opening to a finished product." : `A visual station for beat ${index + 1}.`,
      motionProgression: "Quick entrance: the visual lands fast; semantic: one shape moves through the scene; living: a small signal pulse continues; final hold.",
      layoutFamily: layouts[index % layouts.length],
      evidenceClaimIds: [],
    };
  });
  return JSON.stringify({
    title: `Long plan ${count}`,
    viewerPromise: "The viewer follows the bottleneck without a giant monolithic code reply.",
    hookType: "surprise",
    first3SecondsLine: "The bottleneck shows up before the specs.",
    openLoop: "The viewer wants to see where the bottleneck lives.",
    payoff: "The bottleneck explains the whole system.",
    claims: [],
    scenes,
  });
}

function authorReplyForIds(componentIds: readonly string[], imageRef?: string): string {
  const manifest = {
    title: "Long monolithic with images",
    theme: { dominant: "#1E9CB0" },
    scenes: componentIds.map((component, index) => ({
      component,
      eyebrow: index === 0 ? "HOOK" : "BEAT",
      headline: `Scene ${index + 1}`,
      narration: `Narration ${index + 1}.`,
      ...(index === 0 && imageRef ? { image: { ref: imageRef } } : {}),
    })),
  };
  return "```json\n" + JSON.stringify(manifest) + "\n```\n\n" + blocksFor(componentIds);
}

function weakContentPlanReply(): string {
  const plan = JSON.parse(validContentPlanReply()) as {
    scenes: Array<{ purpose: string; narration: string; onScreenText: string; layoutFamily: string; evidenceClaimIds: string[] }>;
  };
  plan.scenes = plan.scenes.map((scene, index) => ({
    ...scene,
    purpose: index === 0 ? "context" : scene.purpose,
    narration: index === 0 ? "The prototype reached 500 cycles without a source." : scene.narration,
    onScreenText: index === 0 ? "500 cycles" : scene.onScreenText,
    layoutFamily: "statement",
    evidenceClaimIds: index === 0 ? [] : scene.evidenceClaimIds,
  }));
  return JSON.stringify(plan);
}

function claimLedgerContentPlanReply(): string {
  const plan = JSON.parse(validContentPlanReply()) as {
    scenes: Array<{ narration: string; onScreenText: string; evidenceClaimIds: string[] }>;
  };
  plan.scenes[0] = {
    ...plan.scenes[0]!,
    narration: "The lab report says the prototype reached 500 cycles in 2026, but no usable claim id is attached.",
    onScreenText: "500 cycles in 2026",
    evidenceClaimIds: [],
  };
  return JSON.stringify(plan);
}

function repairedClaimLedgerContentPlanReply(): string {
  const plan = JSON.parse(validContentPlanReply()) as {
    scenes: Array<{ narration: string; onScreenText: string; evidenceClaimIds: string[] }>;
  };
  plan.scenes[0] = {
    ...plan.scenes[0]!,
    narration:
      "A safety plan should keep concrete measurements out until a usable claim id supports them. " +
      "The viewer learns to wait for evidence instead of trusting an unsupported lab note. " +
      "That keeps the story honest while the rest of the bottleneck explanation continues.",
    onScreenText: "Evidence first",
    evidenceClaimIds: [],
  };
  return JSON.stringify(plan);
}

function advisoryContentPlanReply(): string {
  const plan = JSON.parse(validContentPlanReply()) as {
    scenes: Array<{ motionProgression: string; layoutFamily: string }>;
  };
  plan.scenes = plan.scenes.map((scene, index) => ({
    ...scene,
    motionProgression: index === 0 ? "Text appears." : scene.motionProgression,
    layoutFamily: "statement",
  }));
  return JSON.stringify(plan);
}

function chatReplies(...replies: string[]) {
  const queue = [...replies];
  const fallback = replies.at(-1) ?? validReply();
  return vi.fn(async (_model: string, _messages: ChatMessage[]) => queue.shift() ?? fallback);
}

function messageText(messages: ChatMessage[]): string {
  return messages
    .map((message) =>
      Array.isArray(message.content)
        ? message.content.filter((part): part is { type: "text"; text: string } => part.type === "text").map((part) => part.text).join("\n")
        : message.content,
    )
    .join("\n");
}

function fakeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function mockClient(chat: NineRouterClient["chat"]): NineRouterClient {
  return { chat, chatStructured: chat } as unknown as NineRouterClient;
}

function makeBackend(
  authorReply = validReply(),
  admitFiles = vi.fn(async (files: readonly string[]) => ({
    ok: true as const,
    componentIds: ["alpha", "beta"],
    files: [...files],
  })),
  planReply = validContentPlanReply(),
  logger?: ReturnType<typeof fakeLogger>,
) {
  const chat = chatReplies(planReply, authorReply);
  const client = mockClient(chat);
  const deps: NineRouterBackendDeps = {
    client,
    tools: {} as never,
    model: () => "test-model",
    apiKey: () => undefined,
    admitFiles,
    ...(logger ? { logger } : {}),
  };
  return { backend: new NineRouterAuthoringBackend(deps), admitFiles, client, chat };
}

function authoredDir(projectId: string): string {
  return join(home, ".video-tool", "projects", projectId, "authored");
}

describe("planContent", () => {
  it("uses the existing production planner without starting TSX authoring", async () => {
    const { backend, chat } = makeBackend();
    const plan = await backend.planContent("agent-plan", {
      text: "Giải thích vì sao chip AI đắt",
      urls: [],
      format: "tiktok",
      durationTier: 1,
      targetSeconds: 45,
      videoLanguage: "vi",
    }, new AbortController().signal);

    expect(plan.scenes.map((scene) => scene.sceneId)).toEqual(["scene-01", "scene-02", "scene-03"]);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(messageText(chat.mock.calls[0]![1])).toMatch(/CONTENT PLAN|kế hoạch/i);
  });
});

describe("authorScenes (pure-author)", () => {
  it("admits staged candidate module paths under .authoring-candidate, not the project root", async () => {
    const projectId = "pa-staged-admit";
    const { backend, admitFiles } = makeBackend(validReply());
    await backend.authorScenes({ projectId, input: { text: "chủ đề", urls: [] }, scriptGate: false });
    expect(admitFiles).toHaveBeenCalledTimes(1);
    const files = admitFiles.mock.calls[0]![0] as string[];
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((f) => f.replace(/\\/g, "/").includes("/.authoring-candidate/"))).toBe(true);
  });

  it("baseline: one successful text-only authoring run plans content before authoring", async () => {
    const projectId = "pa-chat-baseline";
    const { backend, chat } = makeBackend(validReply());
    const job: AuthorJob = { projectId, input: { text: "chủ đề baseline", urls: [] }, scriptGate: false };

    await backend.authorScenes(job);

    expect(chat).toHaveBeenCalledTimes(2);
    const [model, planMessages] = chat.mock.calls[0]!;
    expect(model).toBe("test-model");
    expect(planMessages).toHaveLength(2);
    expect(planMessages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(planMessages.every((m) => typeof m.content === "string")).toBe(true);
    expect(planMessages[0]!.content).toContain("CONTENT PLANNER");

    const [, authorMessages] = chat.mock.calls[1]!;
    expect(authorMessages).toHaveLength(2);
    expect(authorMessages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(authorMessages.every((m) => typeof m.content === "string")).toBe(true);
    const authorUserText = authorMessages[1]!.content as string;
    expect(authorUserText).toContain("CONTENT PLAN ĐÃ DUYỆT");
    expect(authorUserText).toContain("claim-01");
    expect(authorUserText).toContain("motionProgression");
    expect(authorUserText).not.toContain("Unsupported $999 launch price");
  });

  it("logs tolerant content-plan normalizations without blocking safe authoring", async () => {
    const projectId = "pa-content-plan-normalized";
    const logger = fakeLogger();
    const componentIds = ids(3);
    const admitFiles = vi.fn(async (_files: readonly string[]) => ({ ok: true as const, componentIds, files: [] }));
    const chat = chatReplies(INVALID_PURPOSE_CONTENT_PLAN_REPLY, authorReplyForIds(componentIds));
    const backend = new NineRouterAuthoringBackend({
      client: mockClient(chat),
      tools: {} as never,
      model: () => "test-model",
      apiKey: () => undefined,
      admitFiles,
      logger,
    });

    const out = await backend.authorScenes({ projectId, input: { text: "random forest", urls: [] }, scriptGate: false });

    expect(out.scenes).toHaveLength(3);
    const normalizationLog = logger.warn.mock.calls.find((call) => call[1] === "content-plan tolerant normalizations applied");
    expect(normalizationLog?.[0]).toMatchObject({
      projectId,
      counts: {
        "purpose-normalized": 2,
        "motion-defaulted": 2,
      },
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ kind: "purpose-normalized", sceneId: "scene-02", original: "definition", normalized: "context" }),
        expect.objectContaining({ kind: "motion-defaulted", sceneId: "scene-03", reason: "missing" }),
      ]),
    });
    expect(logger.warn.mock.calls).toContainEqual([
      expect.objectContaining({ projectId, count: 2 }),
      "content-plan purpose normalized",
    ]);
    expect(logger.warn.mock.calls).toContainEqual([
      expect.objectContaining({ projectId, count: 2 }),
      "content-plan motion defaulted",
    ]);
  });

  it("keeps normal 12-scene no-image plans on the single authoring path", async () => {
    const projectId = "pa-single-normal-long";
    const componentIds = ids(12);
    const admitFiles = vi.fn(async (_files: readonly string[]) => ({ ok: true as const, componentIds, files: [] }));
    const chat = chatReplies(longContentPlanReply(12), authorReplyForIds(componentIds));
    const backend = new NineRouterAuthoringBackend({
      client: mockClient(chat),
      tools: {} as never,
      model: () => "test-model",
      apiKey: () => undefined,
      admitFiles,
    });

    const out = await backend.authorScenes({ projectId, input: { text: "long topic", urls: [], format: "tiktok", durationTier: 3 }, scriptGate: false });

    expect(out.scenes).toHaveLength(12);
    expect(chat).toHaveBeenCalledTimes(2);
    const authorText = messageText(chat.mock.calls[1]![1] as ChatMessage[]);
    expect(authorText).toContain("AI_Output_Contract");
    expect(authorText).not.toContain("Batch 1/");
    expect(admitFiles).toHaveBeenCalledTimes(1);

    const dir = authoredDir(projectId);
    expect(existsSync(join(dir, "scene-01.tsx"))).toBe(true);
    expect(existsSync(join(dir, "scene-12.tsx"))).toBe(true);
    const manifest = JSON.parse(readFileSync(join(home, ".video-tool", "projects", projectId, "manifest.json"), "utf8"));
    expect(manifest.scenes.map((scene: { component: string }) => scene.component)).toEqual(componentIds);
  });

  it("keeps tier-3 plans within single-reply capacity (≤16) on the single authoring path", async () => {
    // AUTHOR_BATCH_THRESHOLD=16 and pacing maxScenes≤16 ⇒ real quality-passing
    // plans stay single; batch mode is unit-tested in author-batch-policy.test.ts.
    const projectId = "pa-single-at-capacity";
    const logger = fakeLogger();
    const componentIds = ids(14);
    const admitFiles = vi.fn(async (_files: readonly string[]) => ({ ok: true as const, componentIds, files: [] }));
    const chat = chatReplies(longContentPlanReply(14), authorReplyForIds(componentIds));
    const backend = new NineRouterAuthoringBackend({
      client: mockClient(chat),
      tools: {} as never,
      model: () => "test-model",
      apiKey: () => undefined,
      admitFiles,
      logger,
    });

    const out = await backend.authorScenes({ projectId, input: { text: "long topic", urls: [], format: "tiktok", durationTier: 3 }, scriptGate: false });

    expect(out.scenes).toHaveLength(14);
    expect(chat).toHaveBeenCalledTimes(2);
    const authorText = messageText(chat.mock.calls[1]![1] as ChatMessage[]);
    expect(authorText).toContain("AI_Output_Contract");
    expect(authorText).not.toContain("Batch 1/");
    expect(logger.info.mock.calls.some((call) => call[1] === "authoring batch selected; authoring will use compact TSX batches")).toBe(false);
    expect(admitFiles).toHaveBeenCalledTimes(1);
  });

  it("accepts TSX modules with a trailing fence after the JSON manifest on the single path", async () => {
    const projectId = "pa-single-structured-coverage";
    const logger = fakeLogger();
    const componentIds = ids(12);
    const admitFiles = vi.fn(async (_files: readonly string[]) => ({ ok: true as const, componentIds, files: [] }));
    // Single-path author replies still need a manifest; modules may use bare fences.
    const manifest = {
      title: "Structured coverage",
      theme: { dominant: "#1E9CB0" },
      scenes: componentIds.map((component, index) => ({
        component,
        eyebrow: index === 0 ? "HOOK" : "BEAT",
        headline: `Scene ${index + 1}`,
        narration: `Narration ${index + 1}.`,
      })),
    };
    const authorReply = "```json\n" + JSON.stringify(manifest) + "\n```\n\n" + bareBatchWithTrailingFence(componentIds);
    const chat = chatReplies(longContentPlanReply(12), authorReply);
    const backend = new NineRouterAuthoringBackend({
      client: mockClient(chat),
      tools: {} as never,
      model: () => "test-model",
      apiKey: () => undefined,
      admitFiles,
      logger,
    });

    const out = await backend.authorScenes({ projectId, input: { text: "long topic", urls: [], format: "tiktok", durationTier: 3 }, scriptGate: false });

    expect(out.scenes).toHaveLength(12);
    expect(chat).toHaveBeenCalledTimes(2);
    expect(admitFiles).toHaveBeenCalledTimes(1);
    expect(existsSync(join(authoredDir(projectId), "scene-12.tsx"))).toBe(true);
  });

  it("keeps claim-ledger repair plus normal single authoring inside the bounded call budget", async () => {
    const projectId = "pa-single-after-plan-repair";
    const componentIds = ids(10);
    const admitFiles = vi.fn(async (_files: readonly string[]) => ({ ok: true as const, componentIds, files: [] }));
    const chat = chatReplies(
      longContentPlanReply(10, { unsupportedFirstScene: true }),
      longContentPlanReply(10),
      authorReplyForIds(componentIds),
    );
    const backend = new NineRouterAuthoringBackend({
      client: mockClient(chat),
      tools: {} as never,
      model: () => "test-model",
      apiKey: () => undefined,
      admitFiles,
    });

    const out = await backend.authorScenes({ projectId, input: { text: "long repaired topic", urls: [], format: "tiktok", durationTier: 3 }, scriptGate: false });

    expect(out.scenes).toHaveLength(10);
    expect(chat).toHaveBeenCalledTimes(3);
    expect(messageText(chat.mock.calls[1]![1] as ChatMessage[])).toContain("CONTENT PLAN REPAIR");
    expect(messageText(chat.mock.calls[2]![1] as ChatMessage[])).toContain("AI_Output_Contract");
    expect(messageText(chat.mock.calls[2]![1] as ChatMessage[])).not.toContain("Batch 1/");
    expect(admitFiles).toHaveBeenCalledTimes(1);
  });

  it("does not write partial files when the single TSX reply is incomplete", async () => {
    // Tier 3 so a 12-scene plan passes pacing quality; fail on author reply.
    const projectId = "pa-single-missing";
    const componentIds = ids(12);
    const admitFiles = vi.fn(async (_files: readonly string[]) => ({ ok: true as const, componentIds, files: [] }));
    const chat = chatReplies(
      longContentPlanReply(12),
      "I cannot provide that module.",
      "I still cannot provide that module.",
    );
    const backend = new NineRouterAuthoringBackend({
      client: mockClient(chat),
      tools: {} as never,
      model: () => "test-model",
      apiKey: () => undefined,
      admitFiles,
    });

    const out = await backend.authorScenes({ projectId, input: { text: "long topic", urls: [], format: "tiktok", durationTier: 3 }, scriptGate: false });

    expect(out.scenes).toEqual([]);
    expect(out.message).toMatch(/hợp lệ/i);
    // plan + author (+ optional missing-TSX recovery)
    expect(chat.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(chat.mock.calls.length).toBeLessThanOrEqual(3);
    expect(admitFiles).not.toHaveBeenCalled();
    expect(existsSync(authoredDir(projectId))).toBe(false);
  });

  it("fails content-plan quality when scene count exceeds tier maxScenes (before TSX)", async () => {
    // Tier 3 maxScenes=14; N=17 never reaches author-batch too-large (cap 20).
    // Budget-cap coverage lives in author-batch-policy.test.ts.
    const projectId = "pa-plan-over-max-scenes";
    const admitFiles = vi.fn(async (files: readonly string[]) => ({ ok: true as const, componentIds: [], files: [...files] }));
    const chat = chatReplies(longContentPlanReply(17), blocksFor(ids(4)));
    const backend = new NineRouterAuthoringBackend({
      client: mockClient(chat),
      tools: {} as never,
      model: () => "test-model",
      apiKey: () => undefined,
      admitFiles,
    });

    const out = await backend.authorScenes({ projectId, input: { text: "too many scenes", urls: [], format: "tiktok", durationTier: 3 }, scriptGate: false });

    expect(out.scenes).toEqual([]);
    expect(out.message).toMatch(/kế hoạch nội dung|nhịp cảnh|hook|căn cứ/i);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(admitFiles).not.toHaveBeenCalled();
    expect(existsSync(authoredDir(projectId))).toBe(false);
  });

  it("keeps monolithic authoring for long plans with user images so image placement stays model-authored", async () => {
    const projectId = "pa-long-image-monolithic";
    const componentIds = ids(6);
    const providedRef = "assets/long-image.png";
    const assetsDir = join(home, ".video-tool", "projects", projectId, "assets");
    mkdirSync(assetsDir, { recursive: true });
    writeFileSync(join(home, ".video-tool", "projects", projectId, providedRef), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const admitFiles = vi.fn(async (_files: readonly string[]) => ({ ok: true as const, componentIds, files: [] }));
    const chat = chatReplies(longContentPlanReply(6), authorReplyForIds(componentIds, providedRef));
    const backend = new NineRouterAuthoringBackend({
      client: mockClient(chat),
      tools: {} as never,
      model: () => "test-model",
      apiKey: () => undefined,
      admitFiles,
    });

    await backend.authorScenes({
      projectId,
      input: { text: "long image topic", urls: [], images: [{ ref: providedRef, width: 800, height: 600 }], format: "tiktok", durationTier: 1 },
      scriptGate: false,
    });

    expect(chat).toHaveBeenCalledTimes(2);
    expect(messageText(chat.mock.calls[1]![1] as ChatMessage[])).toContain("AI_Output_Contract");
    expect(messageText(chat.mock.calls[1]![1] as ChatMessage[])).not.toContain("Batch 1/");
    const manifest = JSON.parse(readFileSync(join(home, ".video-tool", "projects", projectId, "manifest.json"), "utf8"));
    expect(manifest.scenes[0].image).toEqual({ ref: providedRef });
  });

  it("valid reply ⇒ writes one .tsx per unique id + open-id manifest + admits + returns scenes", async () => {
    const projectId = "pa-valid";
    const { backend, admitFiles } = makeBackend(validReply());
    const job: AuthorJob = { projectId, input: { text: "chủ đề", urls: [] }, scriptGate: false };

    const out = await backend.authorScenes(job);

    expect(out.scenes.map((s) => s.sceneId)).toEqual(["scene-01", "scene-02", "scene-03"]);
    expect(admitFiles).toHaveBeenCalledTimes(1);

    const dir = authoredDir(projectId);
    expect(existsSync(join(dir, "alpha.tsx"))).toBe(true);
    expect(existsSync(join(dir, "beta.tsx"))).toBe(true);

    const manifest = JSON.parse(readFileSync(join(home, ".video-tool", "projects", projectId, "manifest.json"), "utf8"));
    expect(manifest.scenes.map((s: { component: string }) => s.component)).toEqual(["alpha", "beta", "alpha"]);
  });

  it("logs admission failure counts by safety check", async () => {
    const projectId = "pa-admission-counts";
    const logger = fakeLogger();
    const admitFiles = vi.fn(async (_files: readonly string[]) => ({
      ok: false as const,
      violations: [
        { check: "N5", severity: "error" as const, path: "alpha.tsx:1", message: "forbidden API" },
        { check: "N5", severity: "error" as const, path: "beta.tsx:1", message: "forbidden API" },
        { check: "N10", severity: "error" as const, path: "manifest.json", message: "invalid timing" },
      ],
    }));
    const backend = new NineRouterAuthoringBackend({
      client: mockClient(chatReplies(validContentPlanReply(), validReply())),
      tools: {} as never,
      model: () => "test-model",
      apiKey: () => undefined,
      admitFiles,
      logger,
    });

    const out = await backend.authorScenes({ projectId, input: { text: "chủ đề", urls: [] }, scriptGate: false });

    expect(out.scenes).toEqual([]);
    expect(out.message).toMatch(/chưa hợp lệ/i);
    const admissionLog = logger.error.mock.calls.find((call) => call[1] === "admission failed");
    expect(admissionLog?.[0]).toMatchObject({
      failureClass: "admission",
      projectId,
      violationCounts: { N5: 2, N10: 1 },
    });
  });

  it("recovers a manifest-only author reply with one bounded missing-TSX call", async () => {
    const projectId = "pa-recover-json-only";
    const logger = fakeLogger();
    const admitFiles = vi.fn(async (files: readonly string[]) => ({ ok: true as const, componentIds: ["alpha", "beta"], files: [...files] }));
    const chat = chatReplies(validContentPlanReply(), manifestOnlyReply(), block("alpha") + "\n\n" + block("beta"));
    const backend = new NineRouterAuthoringBackend({
      client: mockClient(chat),
      tools: {} as never,
      model: () => "test-model",
      apiKey: () => undefined,
      admitFiles,
      logger,
    });

    const out = await backend.authorScenes({ projectId, input: { text: "chủ đề", urls: [] }, scriptGate: false });

    expect(out.scenes.map((scene) => scene.sceneId)).toEqual(["scene-01", "scene-02", "scene-03"]);
    expect(chat).toHaveBeenCalledTimes(3);
    const recoveryText = messageText(chat.mock.calls[2]![1] as ChatMessage[]);
    expect(recoveryText).toContain("Manifest đã hợp lệ");
    expect(recoveryText).toContain("CHỈ viết các id này");
    expect(recoveryText).toContain("alpha\nbeta");
    expect(logger.warn.mock.calls).toContainEqual([
      expect.objectContaining({ projectId, recoveryAttempt: 1, missingComponentIds: ["alpha", "beta"] }),
      "author-reply missing TSX recovery attempted; author-reply missing TSX modules; requesting bounded recovery",
    ]);
    expect(logger.info.mock.calls).toContainEqual([
      expect.objectContaining({ projectId, recoveryAttempt: 1, recoveredComponentIds: ["alpha", "beta"] }),
      "author-reply missing TSX recovery succeeded",
    ]);
    expect(admitFiles).toHaveBeenCalledTimes(1);
    expect(existsSync(join(authoredDir(projectId), "alpha.tsx"))).toBe(true);
    expect(existsSync(join(authoredDir(projectId), "beta.tsx"))).toBe(true);
  });

  it("recovers only the missing component id and preserves valid first-pass modules", async () => {
    const projectId = "pa-recover-partial";
    const admitFiles = vi.fn(async (files: readonly string[]) => ({ ok: true as const, componentIds: ["alpha", "beta"], files: [...files] }));
    const chat = chatReplies(validContentPlanReply(), partialReply(), block("beta"));
    const backend = new NineRouterAuthoringBackend({
      client: mockClient(chat),
      tools: {} as never,
      model: () => "test-model",
      apiKey: () => undefined,
      admitFiles,
    });

    const out = await backend.authorScenes({ projectId, input: { text: "chủ đề", urls: [] }, scriptGate: false });

    expect(out.scenes.map((scene) => scene.sceneId)).toEqual(["scene-01", "scene-02", "scene-03"]);
    expect(chat).toHaveBeenCalledTimes(3);
    const recoveryText = messageText(chat.mock.calls[2]![1] as ChatMessage[]);
    const missingSection = /Component ids còn thiếu code \.tsx, CHỈ viết các id này:\n([\s\S]*?)\n\nComponent ids đã có code/.exec(recoveryText)?.[1];
    expect(missingSection?.trim()).toBe("beta");
    expect(recoveryText).toContain("Component ids đã có code hợp lệ, KHÔNG viết lại:\nalpha");

    const dir = authoredDir(projectId);
    expect(readFileSync(join(dir, "alpha.tsx"), "utf8")).toContain('id: "alpha"');
    expect(readFileSync(join(dir, "beta.tsx"), "utf8")).toContain('id: "beta"');
  });

  it("does not accept partial code when the bounded missing-TSX recovery is still invalid", async () => {
    const projectId = "pa-recover-negative";
    const logger = fakeLogger();
    const admitFiles = vi.fn(async (files: readonly string[]) => ({ ok: true as const, componentIds: ["alpha", "beta"], files: [...files] }));
    const chat = chatReplies(validContentPlanReply(), partialReply(), "I cannot provide TSX.");
    const backend = new NineRouterAuthoringBackend({
      client: mockClient(chat),
      tools: {} as never,
      model: () => "test-model",
      apiKey: () => undefined,
      admitFiles,
      logger,
    });

    const out = await backend.authorScenes({ projectId, input: { text: "chủ đề", urls: [] }, scriptGate: false });

    expect(out.scenes).toEqual([]);
    expect(out.message).toMatch(/hợp lệ/i);
    expect(chat).toHaveBeenCalledTimes(3);
    expect(logger.warn.mock.calls).toContainEqual([
      expect.objectContaining({ projectId, recoveryAttempt: 1, missingComponentIds: ["beta"] }),
      "author-reply missing TSX recovery attempted; author-reply missing TSX modules; requesting bounded recovery",
    ]);
    expect(logger.error.mock.calls).toContainEqual([
      expect.objectContaining({ projectId, missingComponentIds: ["beta"], recoveredComponentIds: [] }),
      "author-reply missing TSX recovery failed",
    ]);
    expect(admitFiles).not.toHaveBeenCalled();
    expect(existsSync(authoredDir(projectId))).toBe(false);
  });

  it("clears stale authored .tsx files before writing a fresh authoring batch", async () => {
    const projectId = "pa-clears-stale";
    const dir = authoredDir(projectId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "orphan.tsx"), "this is not valid tsx");
    writeFileSync(join(dir, "_entry.tsx"), "// generated entry must survive");
    const { backend, admitFiles } = makeBackend(validReply());
    const job: AuthorJob = { projectId, input: { text: "chủ đề", urls: [] }, scriptGate: false };

    await backend.authorScenes(job);

    expect(admitFiles).toHaveBeenCalledTimes(1);
    expect(existsSync(join(dir, "orphan.tsx"))).toBe(false);
    expect(existsSync(join(dir, "_entry.tsx"))).toBe(true);
    expect(existsSync(join(dir, "alpha.tsx"))).toBe(true);
    expect(existsSync(join(dir, "beta.tsx"))).toBe(true);
  });

  it("invalid reply ⇒ {scenes:[]}, no admit call, no kit/.tsx written", async () => {
    const projectId = "pa-invalid";
    const { backend, admitFiles } = makeBackend("xin lỗi, không có gì ở đây");
    const job: AuthorJob = { projectId, input: { text: "chủ đề", urls: [] }, scriptGate: false };

    const out = await backend.authorScenes(job);

    expect(out.scenes).toEqual([]);
    expect(out.message).toMatch(/hợp lệ/i);
    expect(admitFiles).not.toHaveBeenCalled();
    expect(existsSync(authoredDir(projectId))).toBe(false);
  });

  it("logs a compact author-reply parse summary without raw replies by default", async () => {
    const projectId = "pa-invalid-logged";
    const logger = fakeLogger();
    const longInvalidReply = "x".repeat(3000);
    const admitFiles = vi.fn(async (files: readonly string[]) => ({ ok: true as const, componentIds: ["alpha", "beta"], files: [...files] }));
    const chat = chatReplies(validContentPlanReply(), longInvalidReply);
    const backend = new NineRouterAuthoringBackend({
      client: mockClient(chat),
      tools: {} as never,
      model: () => "test-model",
      apiKey: () => undefined,
      admitFiles,
      logger,
    });

    const out = await backend.authorScenes({ projectId, input: { text: "chủ đề", urls: [] }, scriptGate: false });

    expect(out.scenes).toEqual([]);
    const infoCall = logger.info.mock.calls.find((call) => call[1] === "AI replied");
    expect(infoCall?.[0]).toMatchObject({
      projectId,
      replyChars: 3000,
      parseSummary: {
        manifestFound: false,
        manifestValid: false,
        sceneCount: 0,
        tsxModuleCount: 0,
        missingComponentIdsCount: 0,
        idMismatchCount: 0,
        complete: false,
        recoveryAttempted: false,
      },
    });
    const errorCall = logger.error.mock.calls.find((call) => call[1] === "author-reply parse failed");
    expect(errorCall?.[0]).toMatchObject({
      failureClass: "author-reply-parse",
      projectId,
      reason: "no-manifest",
      parseSummary: {
        manifestFound: false,
        manifestValid: false,
        recoveryAttempted: false,
      },
    });
    expect((errorCall?.[0] as { rawReply?: string }).rawReply).toBeUndefined();
    expect(JSON.stringify(errorCall?.[0])).not.toContain("x".repeat(100));
    expect(admitFiles).not.toHaveBeenCalled();
  });

  it("logs capped raw author replies only when the diagnostic flag is enabled", async () => {
    const previousFlag = process.env.MOTIONREAL_AUTHORING_RAW_LOGS;
    process.env.MOTIONREAL_AUTHORING_RAW_LOGS = "1";
    try {
      const projectId = "pa-invalid-raw-logged";
      const logger = fakeLogger();
      const longInvalidReply = "x".repeat(3000);
      const admitFiles = vi.fn(async (files: readonly string[]) => ({ ok: true as const, componentIds: ["alpha", "beta"], files: [...files] }));
      const chat = chatReplies(validContentPlanReply(), longInvalidReply);
      const backend = new NineRouterAuthoringBackend({
        client: mockClient(chat),
        tools: {} as never,
        model: () => "test-model",
        apiKey: () => undefined,
        admitFiles,
        logger,
      });

      await backend.authorScenes({ projectId, input: { text: "chủ đề", urls: [] }, scriptGate: false });

      const errorCall = logger.error.mock.calls.find((call) => call[1] === "author-reply parse failed");
      expect((errorCall?.[0] as { rawReply?: string }).rawReply).toHaveLength(2000);
      expect(JSON.stringify(errorCall?.[0])).not.toContain("x".repeat(2001));
    } finally {
      if (previousFlag === undefined) delete process.env.MOTIONREAL_AUTHORING_RAW_LOGS;
      else process.env.MOTIONREAL_AUTHORING_RAW_LOGS = previousFlag;
    }
  });

  it("invalid content plan stops before authoring and does not fall back to one-step authoring", async () => {
    const projectId = "pa-invalid-plan";
    const logger = fakeLogger();
    const admitFiles = vi.fn(async (files: readonly string[]) => ({ ok: true as const, componentIds: ["alpha", "beta"], files: [...files] }));
    const { backend, chat } = makeBackend(validReply(), admitFiles, "not a json plan", logger);
    const job: AuthorJob = { projectId, input: { text: "chủ đề", urls: [] }, scriptGate: false };

    const out = await backend.authorScenes(job);

    expect(out.scenes).toEqual([]);
    expect(out.message).toMatch(/kế hoạch nội dung/i);
    expect(chat).toHaveBeenCalledTimes(1);
    const parseLog = logger.error.mock.calls.find((call) => call[1] === "content-plan parse invalid; content-plan parse failed");
    expect(parseLog?.[0]).toMatchObject({ projectId, reason: "no-json" });
    expect(admitFiles).not.toHaveBeenCalled();
    expect(existsSync(authoredDir(projectId))).toBe(false);
  });

  it("weak content plans fail the local quality gate before code authoring", async () => {
    const projectId = "pa-weak-plan";
    const admitFiles = vi.fn(async (files: readonly string[]) => ({ ok: true as const, componentIds: ["alpha", "beta"], files: [...files] }));
    const { backend, chat } = makeBackend(validReply(), admitFiles, weakContentPlanReply());
    const job: AuthorJob = { projectId, input: { text: "chủ đề", urls: [] }, scriptGate: false };

    const out = await backend.authorScenes(job);

    expect(out.scenes).toEqual([]);
    expect(out.message).toMatch(/kế hoạch nội dung/i);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(admitFiles).not.toHaveBeenCalled();
    expect(existsSync(authoredDir(projectId))).toBe(false);
  });

  it("repairs a claim-ledger-only content-plan failure once, then proceeds to authoring", async () => {
    const projectId = "pa-plan-repair-ok";
    const admitFiles = vi.fn(async (files: readonly string[]) => ({ ok: true as const, componentIds: ["alpha", "beta"], files: [...files] }));
    const chat = chatReplies(claimLedgerContentPlanReply(), repairedClaimLedgerContentPlanReply(), validReply());
    const backend = new NineRouterAuthoringBackend({
      client: mockClient(chat),
      tools: {} as never,
      model: () => "test-model",
      apiKey: () => undefined,
      admitFiles,
    });

    const out = await backend.authorScenes({ projectId, input: { text: "chủ đề", urls: [] }, scriptGate: false });

    expect(out.scenes.map((scene) => scene.sceneId)).toEqual(["scene-01", "scene-02", "scene-03"]);
    expect(chat).toHaveBeenCalledTimes(3);
    const repairText = messageText(chat.mock.calls[1]![1] as ChatMessage[]);
    expect(repairText).toContain("CONTENT PLAN REPAIR");
    expect(repairText).toContain("claim-ledger @scene-01");
    expect(repairText).toContain("Do not make uncertain/omit claims supported");
    expect(admitFiles).toHaveBeenCalledTimes(1);
  });

  it("stops with CONTENT_PLAN_QUALITY_FAILURE when claim-ledger repair still fails", async () => {
    const projectId = "pa-plan-repair-fails";
    const admitFiles = vi.fn(async (files: readonly string[]) => ({ ok: true as const, componentIds: ["alpha", "beta"], files: [...files] }));
    const chat = chatReplies(claimLedgerContentPlanReply(), claimLedgerContentPlanReply(), validReply());
    const backend = new NineRouterAuthoringBackend({
      client: mockClient(chat),
      tools: {} as never,
      model: () => "test-model",
      apiKey: () => undefined,
      admitFiles,
    });

    const out = await backend.authorScenes({ projectId, input: { text: "chủ đề", urls: [] }, scriptGate: false });

    expect(out.scenes).toEqual([]);
    expect(out.message).toMatch(/kế hoạch nội dung/i);
    expect(chat).toHaveBeenCalledTimes(2);
    expect(admitFiles).not.toHaveBeenCalled();
    expect(existsSync(authoredDir(projectId))).toBe(false);
  });

  it("passes advisory-only content plan issues into authoring instead of blocking", async () => {
    const projectId = "pa-advisory-plan";
    const admitFiles = vi.fn(async (files: readonly string[]) => ({ ok: true as const, componentIds: ["alpha", "beta"], files: [...files] }));
    const { backend, chat } = makeBackend(validReply(), admitFiles, advisoryContentPlanReply());
    const job: AuthorJob = { projectId, input: { text: "chủ đề", urls: [] }, scriptGate: false };

    const out = await backend.authorScenes(job);

    expect(out.scenes.map((scene) => scene.sceneId)).toEqual(["scene-01", "scene-02", "scene-03"]);
    expect(chat).toHaveBeenCalledTimes(2);
    expect(admitFiles).toHaveBeenCalledTimes(1);
    const authorMessages = chat.mock.calls[1]![1] as ChatMessage[];
    const authorText = authorMessages.map((message) => message.content).join("\n");
    expect(authorText).toContain("CONTENT PLAN ADVISORIES TO RESOLVE IN TSX");
    expect(authorText).not.toContain("motion-progression @scene-01");
    expect(authorText).toContain("layout-diversity");
  });

  it("no model ⇒ guarded with a message", async () => {
    const { backend } = makeBackend(validReply());
    (backend as unknown as { deps: NineRouterBackendDeps }).deps.model = () => undefined;
    const out = await backend.authorScenes({ projectId: "pa-nomodel", input: { text: "x", urls: [] }, scriptGate: false });
    expect(out.scenes).toEqual([]);
    expect(out.message).toMatch(/model/i);
  });

  it("continues authoring when URL ingest throws and reports the URL as unreadable", async () => {
    const projectId = "pa-ingest-fallback";
    const client = mockClient(chatReplies(validContentPlanReply(), validReply()));
    const extractUrl = vi.fn(async () => { throw new Error("ingest offline"); });
    const backend = new NineRouterAuthoringBackend({
      client,
      tools: {} as never,
      model: () => "test-model",
      apiKey: () => undefined,
      admitFiles: vi.fn(async (files: readonly string[]) => ({
        ok: true as const,
        componentIds: ["alpha", "beta"],
        files: [...files],
      })),
      extractUrl,
    });

    const out = await backend.authorScenes({
      projectId,
      input: { text: "chủ đề", urls: ["https://example.test/article"] },
      scriptGate: false,
    });

    expect(out.scenes).toHaveLength(3);
    expect(out.unreadableUrls).toEqual(["https://example.test/article"]);
    expect(extractUrl).toHaveBeenCalledOnce();
  });

  it("injects fixed short-form delivery + videoLanguage into the manifest — the AI never authors them", async () => {
    const projectId = "pa-delivery";
    const { backend } = makeBackend(validReply());
    // The model's manifest carries only theme + scenes; format/durationTier/videoLanguage
    // are injected by the backend (short-form fixed; language from create).
    const job: AuthorJob = {
      projectId,
      input: { text: "topic", urls: [], format: "tiktok", durationTier: 1, videoLanguage: "en" },
      scriptGate: false,
    };

    await backend.authorScenes(job);

    const manifest = JSON.parse(readFileSync(join(home, ".video-tool", "projects", projectId, "manifest.json"), "utf8"));
    expect(manifest.format).toBe("tiktok");
    expect(manifest.durationTier).toBe(1);
    expect(manifest.videoLanguage).toBe("en");
  });

  it("omits the delivery knobs when none are chosen (manifest falls back to the engine defaults)", async () => {
    const projectId = "pa-delivery-default";
    const { backend } = makeBackend(validReply());
    const job: AuthorJob = { projectId, input: { text: "chủ đề", urls: [] }, scriptGate: false };

    await backend.authorScenes(job);

    const manifest = JSON.parse(readFileSync(join(home, ".video-tool", "projects", projectId, "manifest.json"), "utf8"));
    expect(manifest.format).toBeUndefined();
    expect(manifest.durationTier).toBeUndefined();
    expect(manifest.videoLanguage).toBeUndefined();
  });

  it("keeps a provided image.ref on a scene and STRIPS an invented one (create-time image staging)", async () => {
    const projectId = "pa-image";
    // The provided image must exist on disk so buildAuthorImages can read it into
    // the vision part (and thus add its ref to the allowed set). Use a tiny PNG.
    const assetsDir = join(home, ".video-tool", "projects", projectId, "assets");
    mkdirSync(assetsDir, { recursive: true });
    const providedRef = "assets/abc123.png";
    writeFileSync(join(home, ".video-tool", "projects", projectId, providedRef), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

    // The AI reply pins the provided ref on scene-01 and an INVENTED ref on scene-02.
    const manifest = {
      title: "Có ảnh",
      theme: { dominant: "#1E9CB0" },
      scenes: [
        { component: "alpha", eyebrow: "A", headline: "Một", narration: "Câu một.", image: { ref: "assets/abc123.png" } },
        { component: "beta", eyebrow: "B", headline: "Hai", narration: "Câu hai.", image: { ref: "https://evil.example/x.png" } },
        { component: "alpha", eyebrow: "C", headline: "Ba", narration: "Câu ba." },
      ],
    };
    const reply = "```json\n" + JSON.stringify(manifest) + "\n```\n\n" + block("alpha") + "\n\n" + block("beta");
    const { backend } = makeBackend(reply);
    const job: AuthorJob = {
      projectId,
      input: { text: "chủ đề", urls: [], images: [{ ref: providedRef, width: 800, height: 600 }] },
      scriptGate: false,
    };

    await backend.authorScenes(job);

    const written = JSON.parse(readFileSync(join(home, ".video-tool", "projects", projectId, "manifest.json"), "utf8"));
    expect(written.scenes[0].image).toEqual({ ref: "assets/abc123.png" }); // provided ref survives
    expect(written.scenes[1].image).toBeUndefined(); // invented remote ref stripped
    expect(written.scenes[2].image).toBeUndefined();
  });

  it("keeps a USER-APPROVED image even when its file can't be read for the vision part (FS race)", async () => {
    // The bug this guards: authority for an image comes from the user's PICK
    // (job.input.images), not from whether buildAuthorImages could read the bytes
    // into a vision data URL. A transient FS error (lock, race) on the approved
    // asset must NOT silently strip the user's image from the manifest. Here the
    // approved ref is NEVER written to disk, so buildAuthorImages skips it (the
    // model sees no vision part for it) — yet the ref must still survive the strip.
    const projectId = "pa-image-unreadable";
    const approvedRef = "assets/approved-but-missing.png"; // intentionally not on disk
    const manifest = {
      title: "Ảnh đã duyệt nhưng đọc lỗi",
      theme: { dominant: "#1E9CB0" },
      scenes: [
        { component: "alpha", eyebrow: "A", headline: "Một", narration: "Câu một.", image: { ref: approvedRef } },
        { component: "beta", eyebrow: "B", headline: "Hai", narration: "Câu hai." },
        { component: "alpha", eyebrow: "C", headline: "Ba", narration: "Câu ba." },
      ],
    };
    const reply = "```json\n" + JSON.stringify(manifest) + "\n```\n\n" + block("alpha") + "\n\n" + block("beta");
    const { backend } = makeBackend(reply);
    const job: AuthorJob = {
      projectId,
      input: { text: "chủ đề", urls: [], images: [{ ref: approvedRef, width: 800, height: 600 }] },
      scriptGate: false,
    };

    await backend.authorScenes(job);

    const written = JSON.parse(readFileSync(join(home, ".video-tool", "projects", projectId, "manifest.json"), "utf8"));
    expect(written.scenes[0].image).toEqual({ ref: approvedRef }); // approved ref survives despite unreadable bytes
  });

  it("reports links it could NOT read in unreadableUrls (so the UI can warn the user)", async () => {
    const projectId = "pa-unreadable";
    const { backend } = makeBackend(validReply());
    const extractUrl = vi.fn(async (url: string) => {
      if (url.includes("good")) {
        return {
          metadata: { sourceUrl: url, title: "good", fetchedAt: "2026-01-01T00:00:00.000Z" },
          body: "nội dung bài báo đọc được từ link với đủ ký tự cho provenance.",
          wordCount: 12,
        };
      }
      throw new Error("HTTP 403");
    });
    (backend as unknown as { deps: NineRouterBackendDeps }).deps.extractUrl = extractUrl;
    const job: AuthorJob = {
      projectId,
      input: { text: "hai link", urls: ["https://good.example.com/a", "https://bad.example.com/b"] },
      scriptGate: false,
    };

    const out = await backend.authorScenes(job);

    expect(out.scenes.length).toBeGreaterThan(0); // authoring still succeeds
    expect(out.unreadableUrls).toEqual(["https://bad.example.com/b"]);
    expect(extractUrl).toHaveBeenCalledTimes(2);
  });
});

// --- reauthor (code-level self-repair) -----------------------------------

const ORIGINAL = "// component: alpha\nexport default 1; // ORIGINAL";
function newBlock(): string {
  return ["```tsx", "// component: alpha", 'import { registerComponent } from "@motionreal/compositions";', "export default registerComponent({ id: \"alpha\" }); // NEW", "```"].join("\n");
}

function setupProject(projectId: string): { authoredPath: string } {
  const root = join(home, ".video-tool", "projects", projectId);
  mkdirSync(join(root, "authored"), { recursive: true });
  mkdirSync(join(root, "review"), { recursive: true });
  writeFileSync(
    join(root, "manifest.json"),
    JSON.stringify({ title: "t", theme: { dominant: "#1E9CB0" }, scenes: [{ id: "scene-01", component: "alpha", headline: "H", narration: "N" }] }),
  );
  const authoredPath = join(root, "authored", "alpha.tsx");
  writeFileSync(authoredPath, ORIGINAL);
  writeFileSync(join(root, "review", "scene-01.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  return { authoredPath };
}

function backendForReauthor(reply: string, admitOne: NineRouterBackendDeps["admitOne"], capture?: ChatMessage[]) {
  let callCount = 0;
  const client = {
    chat: vi.fn(async (_model: string, messages: ChatMessage[]) => {
      if (capture) capture.push(...messages);
      callCount++;
      if (callCount > 1) {
        return reply.replace("// NEW", "// NEW (RETRY)\nconst retryFix = true;");
      }
      return reply;
    }),
  } as unknown as NineRouterClient;
  const deps: NineRouterBackendDeps = { client, tools: {} as never, model: () => "m", apiKey: () => undefined, admitOne };
  return new NineRouterAuthoringBackend(deps);
}

describe("reauthor (self-repair)", () => {
  it("valid rewrite + admit ok ⇒ overwrites the scene file and returns it", async () => {
    const projectId = "ra-ok";
    const { authoredPath } = setupProject(projectId);
    const backend = backendForReauthor(newBlock(), async () => ({ ok: true, componentId: "alpha" }));

    const out = await backend.reauthor(projectId, [{ sceneId: "scene-01", issues: [{ check: "N17", severity: "error", message: "cắt chữ" }] }]);

    expect(out.scenes.map((s) => s.sceneId)).toEqual(["scene-01"]);
    expect(readFileSync(authoredPath, "utf8")).toContain("NEW");
  });

  it("rewrite that fails admission ⇒ rolls back to original code, returns no scene", async () => {
    const projectId = "ra-rollback";
    const { authoredPath } = setupProject(projectId);
    const backend = backendForReauthor(newBlock(), async () => ({ ok: false, violations: [{ check: "N5", severity: "error", path: authoredPath, message: "banned" }] }));

    const out = await backend.reauthor(projectId, [{ sceneId: "scene-01", issues: [{ check: "N17", severity: "error", message: "cắt chữ" }] }]);

    expect(out.scenes).toEqual([]);
    expect(readFileSync(authoredPath, "utf8")).toBe(ORIGINAL);
  });

  it("retries ONCE with the admission feedback when the first rewrite is rejected, succeeding on the second", async () => {
    const projectId = "ra-retry";
    const { authoredPath } = setupProject(projectId);
    let calls = 0;
    const admitOne: NineRouterBackendDeps["admitOne"] = async () => {
      calls++;
      return calls === 1
        ? { ok: false, violations: [{ check: "N4", severity: "error", path: authoredPath, message: 'No matching export for import "useTheme"' }] }
        : { ok: true, componentId: "alpha" };
    };
    const messages: ChatMessage[] = [];
    const out = await backendForReauthor(newBlock(), admitOne, messages).reauthor(projectId, [{ sceneId: "scene-01", intent: "đổi nền xanh" }]);
    expect(out.scenes.map((s) => s.sceneId)).toEqual(["scene-01"]);
    expect(calls).toBe(2); // first admit failed, retry admit succeeded
    const retryUserText = messages.filter((m) => m.role === "user").at(-1)!.content as string;
    expect(retryUserText).toContain("chỉ import react, remotion, zod, @motionreal/compositions");
    expect(retryUserText).toContain("TSX parse được");
    expect(retryUserText).not.toContain("useTheme/surfaceBorder");
    expect(retryUserText).not.toContain('nhập từ "@motionreal/blocks"');
  });

  it("needsVision: N14 attaches the still as an image part; other issues do not", async () => {
    const projectId = "ra-vision";
    setupProject(projectId);
    const okAdmit: NineRouterBackendDeps["admitOne"] = async () => ({ ok: true, componentId: "alpha" });

    const visionMsgs: ChatMessage[] = [];
    await backendForReauthor(newBlock(), okAdmit, visionMsgs).reauthor(projectId, [{ sceneId: "scene-01", issues: [{ check: "N14", severity: "error", message: "tràn" }] }]);
    const hasImage = visionMsgs.some((m) => Array.isArray(m.content) && (m.content as ContentPart[]).some((p) => p.type === "image_url"));
    expect(hasImage).toBe(true);

    const textMsgs: ChatMessage[] = [];
    await backendForReauthor(newBlock(), okAdmit, textMsgs).reauthor(projectId, [{ sceneId: "scene-01", issues: [{ check: "N20", severity: "error", message: "nhịp" }] }]);
    const noImage = textMsgs.every((m) => typeof m.content === "string");
    expect(noImage).toBe(true);
  });

  it("a visual intent (Canva edit / visual-QA) attaches the still even without issues", async () => {
    const projectId = "ra-visual-intent";
    setupProject(projectId);
    const okAdmit: NineRouterBackendDeps["admitOne"] = async () => ({ ok: true, componentId: "alpha" });
    const msgs: ChatMessage[] = [];
    await backendForReauthor(newBlock(), okAdmit, msgs).reauthor(projectId, [
      { sceneId: "scene-01", intent: "đổi nền sang xanh", visual: true },
    ]);
    const hasImage = msgs.some((m) => Array.isArray(m.content) && (m.content as ContentPart[]).some((p) => p.type === "image_url"));
    expect(hasImage).toBe(true);
  });

  it("unresolvable sceneId ⇒ skipped (no scene, no throw)", async () => {
    const projectId = "ra-missing";
    setupProject(projectId);
    const backend = backendForReauthor(newBlock(), async () => ({ ok: true, componentId: "alpha" }));
    const out = await backend.reauthor(projectId, [{ sceneId: "scene-99", issues: [] }]);
    expect(out.scenes).toEqual([]);
  });

  // A project whose manifest.json vanished mid-flow (deleted, or a partial
  // write) must NOT crash snapshot/restore/reauthor: resolveSceneFile reads the
  // manifest, so a bare loadManifest throw (ENOENT) would propagate and tear
  // down the whole edit run. These paths now swallow a missing manifest and
  // resolve nothing — the video stays renderable.
  it("snapshot/restore/reauthor on a project with NO manifest ⇒ no throw, resolves nothing", async () => {
    const projectId = "ra-no-manifest"; // never setupProject'd → no manifest.json on disk
    const backend = backendForReauthor(newBlock(), async () => ({ ok: true, componentId: "alpha" }));

    await expect(backend.snapshotScenes(projectId, ["scene-01"])).resolves.toEqual([]);
    await expect(backend.restoreScenes(projectId, [{ sceneId: "scene-01", code: "// x" }])).resolves.toBeUndefined();
    const out = await backend.reauthor(projectId, [{ sceneId: "scene-01", issues: [] }]);
    expect(out.scenes).toEqual([]);
  });
});

describe("authorCallErrorMessage (typed gateway failures → Vietnamese)", () => {
  it("a timeout says the model is too slow (and to try another model)", () => {
    const msg = authorCallErrorMessage(new GatewayChatError("timeout", "timed out after 300s"));
    expect(msg).toMatch(/quá lâu|hết thời gian/i);
    expect(msg).toMatch(/model/i);
  });

  it("a transient failure says it auto-retried and to wait/retry", () => {
    const msg = authorCallErrorMessage(new GatewayChatError("transient", "HTTP 502", { status: 502, attempts: 3 }));
    expect(msg).toMatch(/tạm thời|khởi động/i);
    expect(msg).toMatch(/thử lại/i);
  });

  it("a non-retryable http error points at the model selection", () => {
    const msg = authorCallErrorMessage(new GatewayChatError("http", "HTTP 404", { status: 404 }));
    expect(msg).toMatch(/từ chối|chưa sẵn sàng|Cài đặt/i);
  });

  it("a 401 with a 'reset after' window says quota-limited, echoes the wait, offers switching model", () => {
    const msg = authorCallErrorMessage(
      new GatewayChatError("http", '9router chat → HTTP 401: {"error":{"message":"[antigravity/gemini-3-flash-agent] [401]: HTTP 401 (reset after 2m)"}}', { status: 401 }),
    );
    expect(msg).toMatch(/giới hạn|hết hạn mức|quá tải/i);
    expect(msg).toMatch(/2m/); // the reset window is echoed back
    expect(msg).toMatch(/đổi.*model|model.*khác/i);
    // It must NOT mislead the user into thinking the model id is wrong.
    expect(msg).not.toMatch(/từ chối yêu cầu hoặc chưa sẵn sàng/);
  });

  it("a 429 (overload) without a reset window still reads as a temporary quota limit", () => {
    const msg = authorCallErrorMessage(new GatewayChatError("http", "HTTP 429", { status: 429 }));
    expect(msg).toMatch(/giới hạn|hết hạn mức|quá tải/i);
    expect(msg).toMatch(/tự mở lại|chờ/i);
  });

  it("a bare 401 invalid_api_key reports local authentication instead of quota", () => {
    const msg = authorCallErrorMessage(new GatewayChatError(
      "http",
      '9router chat → HTTP 401: {"error":{"message":"Missing API key","code":"invalid_api_key"}}',
      { status: 401 },
    ));
    expect(msg).toMatch(/khóa nội bộ|khởi động lại/i);
    expect(msg).not.toMatch(/hết hạn mức|quá tải/i);
  });

  it("a non-GatewayChatError falls back to the generic connection message", () => {
    const msg = authorCallErrorMessage(new Error("boom"));
    expect(msg).toMatch(/Không nhận được phản hồi/i);
  });
});

// --- vision-incapable model hardening ----------------------------------------

/** True when a chat message list carries at least one inline image part. */
function listHasImage(messages: ChatMessage[]): boolean {
  return messages.some((m) => Array.isArray(m.content) && m.content.some((p) => (p as ContentPart).type === "image_url"));
}

/** Write a tiny readable PNG asset so buildAuthorImages can build a vision part. */
function writeAsset(projectId: string, ref: string): void {
  const abs = join(home, ".video-tool", "projects", projectId, ref);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

describe("vision-incapable model hardening", () => {
  it("authorScenes: a 400 on the image call falls back to text-only and still authors", async () => {
    const projectId = "hard-fallback";
    writeAsset(projectId, "assets/img.png");
    const textReplies = [validContentPlanReply(), validReply()];
    const chat = vi.fn(async (_model: string, messages: ChatMessage[]) => {
      if (listHasImage(messages)) throw new GatewayChatError("http", "HTTP 400 improperly formed", { status: 400 });
      return textReplies.shift() ?? validReply();
    });
    const deps: NineRouterBackendDeps = {
      client: mockClient(chat),
      tools: {} as never,
      model: () => "kr/auto",
      apiKey: () => undefined,
      admitFiles: vi.fn(async (files: readonly string[]) => ({
        ok: true as const,
        componentIds: ["alpha", "beta"],
        files: [...files],
      })),
    };
    const backend = new NineRouterAuthoringBackend(deps);
    const out = await backend.authorScenes({
      projectId,
      input: { text: "chủ đề", urls: [], images: [{ ref: "assets/img.png", width: 800, height: 600 }] },
      scriptGate: false,
    });
    expect(out.scenes.length).toBeGreaterThan(0); // authored via the text-only retry
    expect(chat).toHaveBeenCalledTimes(3); // image plan attempt (400) + text-only plan retry + text-only authoring
    expect(listHasImage(chat.mock.calls[0]![1] as ChatMessage[])).toBe(true);
    expect(listHasImage(chat.mock.calls[1]![1] as ChatMessage[])).toBe(false);
    expect(listHasImage(chat.mock.calls[2]![1] as ChatMessage[])).toBe(false);
  });

  it("once a model rejects an image, filterCrawledImages short-circuits to [] (no call, no breaker)", async () => {
    const projectId = "hard-filter";
    writeAsset(projectId, "assets/a.png");
    const textReplies = [validContentPlanReply(), validReply()];
    const chat = vi.fn(async (_model: string, messages: ChatMessage[]) => {
      if (listHasImage(messages)) throw new GatewayChatError("http", "HTTP 400 improperly formed", { status: 400 });
      return textReplies.shift() ?? validReply();
    });
    const deps: NineRouterBackendDeps = {
      client: mockClient(chat),
      tools: {} as never,
      model: () => "kr/auto",
      apiKey: () => undefined,
      admitFiles: vi.fn(async (files: readonly string[]) => ({
        ok: true as const,
        componentIds: ["alpha", "beta"],
        files: [...files],
      })),
    };
    const backend = new NineRouterAuthoringBackend(deps);
    // First, an authoring call that hits the 400 marks the model image-unsupported.
    await backend.authorScenes({
      projectId,
      input: { text: "x", urls: [], images: [{ ref: "assets/a.png", width: 800, height: 600 }] },
      scriptGate: false,
    });
    chat.mockClear();
    // Now the filter must NOT call the model at all (it would only 400 + trip the breaker).
    const keep = await backend.filterCrawledImages(projectId, "bài báo", [{ ref: "assets/a.png", width: 800, height: 600 }]);
    expect(keep).toEqual([]);
    expect(chat).not.toHaveBeenCalled();
  });

  describe("isLogicChanged", () => {
    it("returns false if only comments and whitespace differ", () => {
      const code1 = `
        // Some comment
        const a = 1; /* inline block comment */
      `;
      const code2 = `
        const a = 1;
        // another comment
      `;
      expect(isLogicChanged(code1, code2)).toBe(false);
    });

    it("returns true if variables or logic differ", () => {
      const code1 = `const a = 1;`;
      const code2 = `const a = 2;`;
      expect(isLogicChanged(code1, code2)).toBe(true);
    });
  });
});
