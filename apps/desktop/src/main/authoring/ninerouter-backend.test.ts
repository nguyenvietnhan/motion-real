import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NineRouterAuthoringBackend, type NineRouterBackendDeps } from "./ninerouter-backend.js";
import type { NineRouterClient, ChatMessage, ContentPart } from "../gateway/ninerouter-client.js";
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
    'import { registerComponent } from "@news/compositions";',
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

function makeBackend(reply: string, admit = vi.fn(async () => ({ ok: true as const, componentIds: ["alpha", "beta"], files: [] }))) {
  const client = { chat: vi.fn(async () => reply) } as unknown as NineRouterClient;
  const deps: NineRouterBackendDeps = {
    client,
    tools: {} as never,
    model: () => "test-model",
    apiKey: () => undefined,
    admit,
  };
  return { backend: new NineRouterAuthoringBackend(deps), admit, client };
}

function authoredDir(projectId: string): string {
  return join(home, ".video-tool", "projects", projectId, "authored");
}

describe("authorScenes (pure-author)", () => {
  it("valid reply ⇒ writes one .tsx per unique id + open-id manifest + admits + returns scenes", async () => {
    const projectId = "pa-valid";
    const { backend, admit } = makeBackend(validReply());
    const job: AuthorJob = { projectId, input: { kind: "topic", text: "chủ đề" }, scriptGate: false };

    const out = await backend.authorScenes(job);

    expect(out.scenes.map((s) => s.sceneId)).toEqual(["scene-01", "scene-02", "scene-03"]);
    expect(admit).toHaveBeenCalledTimes(1);

    const dir = authoredDir(projectId);
    expect(existsSync(join(dir, "alpha.tsx"))).toBe(true);
    expect(existsSync(join(dir, "beta.tsx"))).toBe(true);

    const manifest = JSON.parse(readFileSync(join(home, ".video-tool", "projects", projectId, "manifest.json"), "utf8"));
    expect(manifest.scenes.map((s: { component: string }) => s.component)).toEqual(["alpha", "beta", "alpha"]);
  });

  it("invalid reply ⇒ {scenes:[]}, no admit call, no kit/.tsx written", async () => {
    const projectId = "pa-invalid";
    const { backend, admit } = makeBackend("xin lỗi, không có gì ở đây");
    const job: AuthorJob = { projectId, input: { kind: "topic", text: "chủ đề" }, scriptGate: false };

    const out = await backend.authorScenes(job);

    expect(out.scenes).toEqual([]);
    expect(out.message).toMatch(/chưa hợp lệ/i);
    expect(admit).not.toHaveBeenCalled();
    expect(existsSync(authoredDir(projectId))).toBe(false);
  });

  it("no model ⇒ guarded with a message", async () => {
    const { backend } = makeBackend(validReply());
    (backend as unknown as { deps: NineRouterBackendDeps }).deps.model = () => undefined;
    const out = await backend.authorScenes({ projectId: "pa-nomodel", input: { kind: "topic", text: "x" }, scriptGate: false });
    expect(out.scenes).toEqual([]);
    expect(out.message).toMatch(/model/i);
  });
});

// --- reauthor (code-level self-repair) -----------------------------------

const ORIGINAL = "// component: alpha\nexport default 1; // ORIGINAL";
function newBlock(): string {
  return ["```tsx", "// component: alpha", 'import { registerComponent } from "@news/compositions";', "export default registerComponent({ id: \"alpha\" }); // NEW", "```"].join("\n");
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
  const client = {
    chat: vi.fn(async (_model: string, messages: ChatMessage[]) => {
      if (capture) capture.push(...messages);
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

  it("needsVision: N14/N18 attach the still as an image part; other issues do not", async () => {
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

  it("unresolvable sceneId ⇒ skipped (no scene, no throw)", async () => {
    const projectId = "ra-missing";
    setupProject(projectId);
    const backend = backendForReauthor(newBlock(), async () => ({ ok: true, componentId: "alpha" }));
    const out = await backend.reauthor(projectId, [{ sceneId: "scene-99", issues: [] }]);
    expect(out.scenes).toEqual([]);
  });
});
