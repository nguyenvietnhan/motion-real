import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NineRouterAuthoringBackend, authorCallErrorMessage, isLogicChanged, type NineRouterBackendDeps } from "./ninerouter-backend.js";
import { GatewayChatError, type NineRouterClient, type ChatMessage, type ContentPart } from "../gateway/ninerouter-client.js";
import type { AuthorJob } from "../agent/agent-worker.js";

/**
 * Feature: desktop-author-mode — authorScenes writes AI-authored `.tsx` modules
 * + an open-id manifest and admits them (no kit fallback). Admission is stubbed
 * (the real esbuild loader's repo-root resolution doesn't hold under vitest).
 */

let home: string;
beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "nrt-author-"));
  process.env.VIDEO_TOOL_HOME = home;
});
afterAll(() => {
  rmSync(home, { recursive: true, force: true });
  delete process.env.VIDEO_TOOL_HOME;
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

function validReply(): string {
  const manifest = {
    title: "Video kiểm thử pure-author",
    theme: { dominant: "#1E9CB0", mood: "thử" },
    scenes: [
      { component: "alpha", eyebrow: "A", headline: "Một", narration: "Câu một." },
      { component: "beta", eyebrow: "B", headline: "Hai", narration: "Câu hai." },
      { component: "alpha", eyebrow: "C", headline: "Ba", narration: "Câu ba." },
    ],
  };
  return "```json\n" + JSON.stringify(manifest) + "\n```\n\n" + block("alpha") + "\n\n" + block("beta");
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
        support: "source_material",
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
        narration: "Con chip không đắt vì nó nhỏ. Nó đắt vì gần như không ai làm nổi.",
        onScreenText: "Đắt vì khan hiếm",
        visualMetaphor: "A tiny glowing chip behind a locked factory gate.",
        motionProgression: "Early: the chip glows alone; mid: the gate closes; late: the queue compresses toward the bottleneck.",
        layoutFamily: "signature-visual",
        evidenceClaimIds: ["claim-01"],
      },
      {
        sceneId: "scene-02",
        purpose: "context",
        beat: "Show why capacity, not hype, is the bottleneck.",
        narration: "Khi chỉ vài nơi làm được, mỗi đơn hàng phải xếp hàng trước một cánh cửa hẹp.",
        onScreenText: "Cổ chai là nhà máy",
        visualMetaphor: "A narrowing production timeline.",
        motionProgression: "Early: chips enter the timeline; mid: the path narrows into one gate; late: the queue pauses at the bottleneck.",
        layoutFamily: "timeline",
        evidenceClaimIds: ["claim-01"],
      },
      {
        sceneId: "scene-03",
        purpose: "payoff",
        beat: "Resolve the open loop with the scarcity takeaway.",
        narration: "Thứ được định giá không phải vật liệu, mà là quyền bước qua cánh cổng sản xuất.",
        onScreenText: "Giá nằm ở năng lực biến thiết kế thành hàng thật",
        visualMetaphor: "Blueprint lines turning into one finished glowing chip.",
        motionProgression: "Early: blueprint lines draw in; mid: traces brighten; late: the finished chip holds as the payoff lands.",
        layoutFamily: "diagram",
        evidenceClaimIds: ["claim-01"],
      },
    ],
  };
  return JSON.stringify(plan);
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

function chatReplies(...replies: string[]) {
  const queue = [...replies];
  const fallback = replies.at(-1) ?? validReply();
  return vi.fn(async (_model: string, _messages: ChatMessage[]) => queue.shift() ?? fallback);
}

function makeBackend(
  authorReply = validReply(),
  admit = vi.fn(async () => ({ ok: true as const, componentIds: ["alpha", "beta"], files: [] })),
  planReply = validContentPlanReply(),
) {
  const chat = chatReplies(planReply, authorReply);
  const client = { chat } as unknown as NineRouterClient;
  const deps: NineRouterBackendDeps = {
    client,
    tools: {} as never,
    model: () => "test-model",
    apiKey: () => undefined,
    admit,
  };
  return { backend: new NineRouterAuthoringBackend(deps), admit, client, chat };
}

function authoredDir(projectId: string): string {
  return join(home, ".video-tool", "projects", projectId, "authored");
}

describe("authorScenes (pure-author)", () => {
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

  it("valid reply ⇒ writes one .tsx per unique id + open-id manifest + admits + returns scenes", async () => {
    const projectId = "pa-valid";
    const { backend, admit } = makeBackend(validReply());
    const job: AuthorJob = { projectId, input: { text: "chủ đề", urls: [] }, scriptGate: false };

    const out = await backend.authorScenes(job);

    expect(out.scenes.map((s) => s.sceneId)).toEqual(["scene-01", "scene-02", "scene-03"]);
    expect(admit).toHaveBeenCalledTimes(1);

    const dir = authoredDir(projectId);
    expect(existsSync(join(dir, "alpha.tsx"))).toBe(true);
    expect(existsSync(join(dir, "beta.tsx"))).toBe(true);

    const manifest = JSON.parse(readFileSync(join(home, ".video-tool", "projects", projectId, "manifest.json"), "utf8"));
    expect(manifest.scenes.map((s: { component: string }) => s.component)).toEqual(["alpha", "beta", "alpha"]);
  });

  it("clears stale authored .tsx files before writing a fresh authoring batch", async () => {
    const projectId = "pa-clears-stale";
    const dir = authoredDir(projectId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "orphan.tsx"), "this is not valid tsx");
    writeFileSync(join(dir, "_entry.tsx"), "// generated entry must survive");
    const { backend, admit } = makeBackend(validReply());
    const job: AuthorJob = { projectId, input: { text: "chủ đề", urls: [] }, scriptGate: false };

    await backend.authorScenes(job);

    expect(admit).toHaveBeenCalledTimes(1);
    expect(existsSync(join(dir, "orphan.tsx"))).toBe(false);
    expect(existsSync(join(dir, "_entry.tsx"))).toBe(true);
    expect(existsSync(join(dir, "alpha.tsx"))).toBe(true);
    expect(existsSync(join(dir, "beta.tsx"))).toBe(true);
  });

  it("invalid reply ⇒ {scenes:[]}, no admit call, no kit/.tsx written", async () => {
    const projectId = "pa-invalid";
    const { backend, admit } = makeBackend("xin lỗi, không có gì ở đây");
    const job: AuthorJob = { projectId, input: { text: "chủ đề", urls: [] }, scriptGate: false };

    const out = await backend.authorScenes(job);

    expect(out.scenes).toEqual([]);
    expect(out.message).toMatch(/hợp lệ/i);
    expect(admit).not.toHaveBeenCalled();
    expect(existsSync(authoredDir(projectId))).toBe(false);
  });

  it("invalid content plan stops before authoring and does not fall back to one-step authoring", async () => {
    const projectId = "pa-invalid-plan";
    const admit = vi.fn(async () => ({ ok: true as const, componentIds: ["alpha", "beta"], files: [] }));
    const { backend, chat } = makeBackend(validReply(), admit, "not a json plan");
    const job: AuthorJob = { projectId, input: { text: "chủ đề", urls: [] }, scriptGate: false };

    const out = await backend.authorScenes(job);

    expect(out.scenes).toEqual([]);
    expect(out.message).toMatch(/kế hoạch nội dung/i);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(admit).not.toHaveBeenCalled();
    expect(existsSync(authoredDir(projectId))).toBe(false);
  });

  it("weak content plans fail the local quality gate before code authoring", async () => {
    const projectId = "pa-weak-plan";
    const admit = vi.fn(async () => ({ ok: true as const, componentIds: ["alpha", "beta"], files: [] }));
    const { backend, chat } = makeBackend(validReply(), admit, weakContentPlanReply());
    const job: AuthorJob = { projectId, input: { text: "chủ đề", urls: [] }, scriptGate: false };

    const out = await backend.authorScenes(job);

    expect(out.scenes).toEqual([]);
    expect(out.message).toMatch(/kế hoạch nội dung/i);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(admit).not.toHaveBeenCalled();
    expect(existsSync(authoredDir(projectId))).toBe(false);
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
    const client = { chat: chatReplies(validContentPlanReply(), validReply()) } as unknown as NineRouterClient;
    const ingestUrl = vi.fn(async () => { throw new Error("ingest offline"); });
    const backend = new NineRouterAuthoringBackend({
      client,
      tools: { ingest_url: ingestUrl } as never,
      model: () => "test-model",
      apiKey: () => undefined,
      admit: vi.fn(async () => ({ ok: true as const, componentIds: ["alpha", "beta"], files: [] })),
    });

    const out = await backend.authorScenes({
      projectId,
      input: { text: "chủ đề", urls: ["https://example.test/article"] },
      scriptGate: false,
    });

    expect(out.scenes).toHaveLength(3);
    expect(out.unreadableUrls).toEqual(["https://example.test/article"]);
    expect(ingestUrl).toHaveBeenCalledOnce();
  });

  it("injects the user-chosen delivery knobs (format/tier/videoLanguage) into the manifest — the AI never authors them", async () => {
    const projectId = "pa-delivery";
    const { backend } = makeBackend(validReply());
    // The model's manifest carries only theme + scenes; the create-screen knobs
    // (format/durationTier/videoLanguage) are injected by the backend so the
    // canvas + word-budget + full content language are the user's choice, not the AI's.
    const job: AuthorJob = {
      projectId,
      input: { text: "topic", urls: [], format: "youtube", durationTier: 2, videoLanguage: "en" },
      scriptGate: false,
    };

    await backend.authorScenes(job);

    const manifest = JSON.parse(readFileSync(join(home, ".video-tool", "projects", projectId, "manifest.json"), "utf8"));
    expect(manifest.format).toBe("youtube");
    expect(manifest.durationTier).toBe(2);
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

  it("keeps a provided image.ref on a scene and STRIPS an invented one (Phase 2 Block A)", async () => {
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
      theme: { dominant: "#1E9CB0", mood: "thử" },
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
      theme: { dominant: "#1E9CB0", mood: "thử" },
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
    // One link extracts text (ingest_url writes a research file and returns its
    // path — the body is read from disk, NOT from the result), the other fails.
    // Only the failed one is reported.
    const goodResearch = join(home, ".video-tool", "planning", "pa-unreadable-good.md");
    mkdirSync(join(home, ".video-tool", "planning"), { recursive: true });
    writeFileSync(goodResearch, "# tiêu đề\n\nnội dung bài báo đọc được từ link.");
    const ingest_url = vi.fn(async ({ url }: { url: string }) =>
      url.includes("good")
        ? { ok: true as const, data: { id: "g", researchPath: goodResearch, metadata: {}, wordCount: 7 } }
        : { ok: false as const, error: { stage: "ingest", cause: "HTTP 403" } },
    );
    (backend as unknown as { deps: NineRouterBackendDeps }).deps.tools = { ingest_url } as never;
    const job: AuthorJob = {
      projectId,
      input: { text: "hai link", urls: ["https://good.example.com/a", "https://bad.example.com/b"] },
      scriptGate: false,
    };

    const out = await backend.authorScenes(job);

    expect(out.scenes.length).toBeGreaterThan(0); // authoring still succeeds
    expect(out.unreadableUrls).toEqual(["https://bad.example.com/b"]);
    expect(ingest_url).toHaveBeenCalledTimes(2);
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
    JSON.stringify({ title: "t", theme: { dominant: "#1E9CB0", mood: "m" }, scenes: [{ id: "scene-01", component: "alpha", headline: "H", narration: "N" }] }),
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

  it("a non-GatewayChatError falls back to the generic connection message", () => {
    const msg = authorCallErrorMessage(new Error("boom"));
    expect(msg).toMatch(/Không nhận được phản hồi/i);
  });
});

// --- vision-incapable model hardening (Phase 2 Block B) ------------------

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
      client: { chat } as unknown as NineRouterClient,
      tools: {} as never,
      model: () => "kr/auto",
      apiKey: () => undefined,
      admit: vi.fn(async () => ({ ok: true as const, componentIds: ["alpha", "beta"], files: [] })),
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
      client: { chat } as unknown as NineRouterClient,
      tools: {} as never,
      model: () => "kr/auto",
      apiKey: () => undefined,
      admit: vi.fn(async () => ({ ok: true as const, componentIds: ["alpha", "beta"], files: [] })),
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
