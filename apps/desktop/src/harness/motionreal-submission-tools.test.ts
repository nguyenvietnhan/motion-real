import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apply } from "./motionreal-submission-tools.js";

type CapturedTool = {
  name: string;
  parameters: Record<string, unknown>;
  execute(args: unknown, execution: {
    signal: AbortSignal;
    agent: { session: { header: { cwd: string } } };
  }): Promise<unknown>;
};

const roots: string[] = [];
let previousDraftsRoot: string | undefined;

beforeEach(() => {
  previousDraftsRoot = process.env.MOTIONREAL_AGENT_DRAFTS_ROOT;
});

afterEach(async () => {
  if (previousDraftsRoot === undefined) delete process.env.MOTIONREAL_AGENT_DRAFTS_ROOT;
  else process.env.MOTIONREAL_AGENT_DRAFTS_ROOT = previousDraftsRoot;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<{ root: string; workspace: string; tools: Map<string, CapturedTool> }> {
  const root = await mkdtemp(join(tmpdir(), "motionreal-submission-tools-"));
  roots.push(root);
  const workspace = join(root, "agent-00000000-0000-0000-0000-000000000001");
  await mkdir(join(workspace, "handoff"), { recursive: true });
  await mkdir(join(workspace, "assets"), { recursive: true });
  process.env.MOTIONREAL_AGENT_DRAFTS_ROOT = root;
  const tools = new Map<string, CapturedTool>();
  apply({
    tools: {
      register(definition) {
        tools.set(definition.name, definition as CapturedTool);
        return () => tools.delete(definition.name);
      },
    },
  });
  return { root, workspace, tools };
}

function execution(workspace: string, signal = new AbortController().signal) {
  return { signal, agent: { session: { header: { cwd: workspace } } } };
}

describe("MotionReal Harness submission tools", () => {
  it("registers only the two narrow structured tools", async () => {
    const { tools } = await fixture();
    expect([...tools.keys()]).toEqual(["motionreal_submit_assets", "motionreal_submit_brief"]);
    for (const tool of tools.values()) {
      expect(tool.parameters).toMatchObject({ type: "object", additionalProperties: false });
    }
    const briefParameters = tools.get("motionreal_submit_brief")!.parameters as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(briefParameters.required).not.toContain("title");
    expect(briefParameters.properties).not.toHaveProperty("title");
    expect(briefParameters.properties.duration_tier).toMatchObject({
      description: "Target duration: 1=45s, 2=90s, 3=150s, 4=210s",
    });
  });

  it("atomically submits assets and makes an identical retry idempotent", async () => {
    const { workspace, tools } = await fixture();
    await writeFile(join(workspace, "assets", "logo.png"), "png");
    await writeFile(join(workspace, "handoff", "assets-request.json"), JSON.stringify({
      version: 1,
      job_id: "job-assets",
      request_revision: 2,
    }));
    const args = {
      job_id: "job-assets",
      request_revision: 2,
      items: [{ id: "logo", path: "assets/logo.png", source_url: "https://example.com/logo.png", label: "Logo" }],
    };
    const tool = tools.get("motionreal_submit_assets")!;

    await expect(tool.execute(args, execution(workspace))).resolves.toEqual({
      kind: "assets",
      status: "submitted",
      request_revision: 2,
    });
    await expect(tool.execute(args, execution(workspace))).resolves.toMatchObject({ status: "unchanged" });
    const saved = JSON.parse(await readFile(join(workspace, "handoff", "assets.json"), "utf8"));
    expect(saved).toMatchObject({ version: 1, job_id: "job-assets", request_revision: 2, items: args.items });
    await expect(tool.execute({ ...args, items: [{ ...args.items[0], label: "Khác" }] }, execution(workspace)))
      .rejects.toThrow(/đã có submission khác/);
  });

  it("rejects stale, external, and aborted asset submissions without writing the handoff", async () => {
    const { root, workspace, tools } = await fixture();
    const outside = join(root, "outside.png");
    await writeFile(outside, "png");
    await writeFile(join(workspace, "handoff", "assets-request.json"), JSON.stringify({
      version: 1,
      job_id: "job-current",
      request_revision: 3,
    }));
    const tool = tools.get("motionreal_submit_assets")!;
    const base = {
      job_id: "job-old",
      request_revision: 2,
      items: [{ id: "bad", path: "../outside.png", source_url: "https://example.com/x.png", label: "Bad" }],
    };
    await expect(tool.execute(base, execution(workspace))).rejects.toThrow(/đã cũ/);
    await expect(tool.execute({ ...base, job_id: "job-current", request_revision: 3 }, execution(workspace)))
      .rejects.toThrow(/ngoài assets/);

    const controller = new AbortController();
    controller.abort();
    await expect(tool.execute({ ...base, job_id: "job-current", request_revision: 3 }, execution(workspace, controller.signal)))
      .rejects.toMatchObject({ name: "AbortError" });
    await expect(readFile(join(workspace, "handoff", "assets.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("submits a brief only for the current request and approved asset set", async () => {
    const { workspace, tools } = await fixture();
    await writeFile(join(workspace, "handoff", "brief-request.json"), JSON.stringify({
      version: 1,
      job_id: "job-brief",
      request_revision: 4,
      selected_asset_ids: ["logo", "screen"],
      brief: { title: "Gemini là gì?" },
    }));
    const tool = tools.get("motionreal_submit_brief")!;
    const args = {
      job_id: "job-brief",
      request_revision: 4,
      prompt: "Giải thích Gemini bằng mạch kể rõ ràng, dùng logo làm hook và màn hình sản phẩm làm bằng chứng trực quan.",
      duration_tier: 1,
      video_language: "vi",
      voice_provider: "vieneu",
      selected_asset_ids: ["logo", "screen"],
    };

    await expect(tool.execute(args, execution(workspace))).resolves.toMatchObject({ kind: "brief", status: "submitted" });
    const saved = JSON.parse(await readFile(join(workspace, "handoff", "brief.json"), "utf8"));
    expect(saved).toMatchObject({ ...args, title: "Gemini là gì?", version: 1, brief_revision: 1, format: "tiktok" });
    await expect(tool.execute({ ...args, selected_asset_ids: ["logo"] }, execution(workspace)))
      .rejects.toThrow(/không khớp asset/);
  });
});
