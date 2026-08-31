import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apply, inject } from "./motionreal-submission-tools.js";

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

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

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
  await apply({
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
  it("registers the three narrow structured handoff tools", async () => {
    expect(inject).toContain("systemPrompt");
    const { tools } = await fixture();
    expect([...tools.keys()]).toEqual(["motionreal_submit_assets", "motionreal_submit_brief", "motionreal_submit_authoring"]);
    for (const tool of tools.values()) {
      expect(tool.parameters).toMatchObject({ type: "object", additionalProperties: false });
    }
    const briefParameters = tools.get("motionreal_submit_brief")!.parameters as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(briefParameters.required).toContain("title");
    expect(briefParameters.properties).toHaveProperty("title");
    expect(briefParameters.properties).not.toHaveProperty("duration_tier");
    expect(briefParameters.properties).not.toHaveProperty("voice_provider");
    const assetParameters = tools.get("motionreal_submit_assets")!.parameters as {
      properties: { items: { items: { required: string[]; properties: Record<string, unknown> } } };
    };
    expect(assetParameters.properties.items.items.required).toContain("role");
    expect(assetParameters.properties.items.items.properties.role).toMatchObject({
      enum: ["hero", "support", "logo", "icon"],
    });
  });

  it("atomically submits assets and makes an identical retry idempotent", async () => {
    const { workspace, tools } = await fixture();
    await writeFile(join(workspace, "assets", "logo.png"), ONE_PIXEL_PNG);
    await writeFile(join(workspace, "handoff", "assets-request.json"), JSON.stringify({
      version: 1,
      job_id: "job-assets",
      request_revision: 2,
    }));
    const args = {
      job_id: "job-assets",
      request_revision: 2,
      items: [{ id: "logo", path: "assets/logo.png", source_url: "https://example.com/logo.png", label: "Logo", role: "logo" }],
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
      items: [{ id: "bad", path: "../outside.png", source_url: "https://example.com/x.png", label: "Bad", role: "support" }],
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

  it("rejects HTML downloaded under a PNG filename before accepting the handoff", async () => {
    const { workspace, tools } = await fixture();
    await writeFile(join(workspace, "assets", "logo.png"), "<!DOCTYPE html><title>Download failed</title>");
    await writeFile(join(workspace, "handoff", "assets-request.json"), JSON.stringify({
      version: 1,
      job_id: "job-assets",
      request_revision: 1,
    }));

    await expect(tools.get("motionreal_submit_assets")!.execute({
      job_id: "job-assets",
      request_revision: 1,
      items: [{ id: "logo", path: "assets/logo.png", source_url: "https://example.com/logo.png", label: "Logo", role: "logo" }],
    }, execution(workspace))).rejects.toThrow(/không phải ảnh raster/);
    await expect(readFile(join(workspace, "handoff", "assets.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("submits a brief only for the current request and approved asset set", async () => {
    const { workspace, tools } = await fixture();
    await writeFile(join(workspace, "handoff", "brief-request.json"), JSON.stringify({
      version: 1,
      job_id: "job-brief",
      request_revision: 4,
      selected_asset_ids: ["logo", "screen"],
      brief: { title: "Tiêu đề gợi ý" },
    }));
    const tool = tools.get("motionreal_submit_brief")!;
    const args = {
      job_id: "job-brief",
      request_revision: 4,
      title: "Gemini là gì?",
      prompt: "Giải thích Gemini bằng mạch kể rõ ràng, dùng logo làm hook và màn hình sản phẩm làm bằng chứng trực quan.",
      video_language: "vi",
      selected_asset_ids: ["logo", "screen"],
    };

    await expect(tool.execute(args, execution(workspace))).resolves.toMatchObject({ kind: "brief", status: "submitted" });
    const saved = JSON.parse(await readFile(join(workspace, "handoff", "brief.generated.json"), "utf8"));
    expect(saved).toMatchObject({ ...args, version: 1, brief_revision: 1, format: "tiktok" });
    expect(saved).not.toHaveProperty("duration_tier");
    expect(saved).not.toHaveProperty("voice_provider");
    await expect(tool.execute({ ...args, selected_asset_ids: ["logo"] }, execution(workspace)))
      .rejects.toThrow(/không khớp asset/);
  });

  it("requires complete image review metadata for visual refine", async () => {
    const { workspace, tools } = await fixture();
    await mkdir(join(workspace, "project", "authored"), { recursive: true });
    await writeFile(join(workspace, "project", "authored", "scene-01.tsx"), "export default {};\n");
    await writeFile(join(workspace, "project", "manifest.json"), JSON.stringify({
      scenes: [{ id: "scene-01", component: "scene-01", image: { ref: "assets/logo.png", alt: "Logo", role: "logo" } }],
    }));
    await writeFile(join(workspace, "handoff", "authoring-request.json"), JSON.stringify({
      version: 1,
      job_id: "job-author",
      request_revision: 1,
      manifest: "project/manifest.json",
      authored_dir: "project/authored",
      assets: [{ id: "logo", ref: "assets/logo.png", role: "logo" }],
    }));
    const tool = tools.get("motionreal_submit_authoring")!;
    const args = { job_id: "job-author", request_revision: 1, scene_ids: ["scene-01"], used_asset_ids: ["logo"] };

    await writeFile(join(workspace, "project", "manifest.json"), JSON.stringify({
      scenes: [{ id: "scene-01", component: "scene-01", image: { ref: "assets/logo.png", alt: "Logo", role: "hero" } }],
    }));
    await expect(tool.execute(args, execution(workspace))).rejects.toThrow(/scene\.image\.role="logo"/);
    await writeFile(join(workspace, "project", "manifest.json"), JSON.stringify({
      scenes: [{ id: "scene-01", component: "scene-01", image: { ref: "assets/logo.png", alt: "Logo", role: "logo" } }],
    }));
    await expect(tool.execute(args, execution(workspace))).resolves.toMatchObject({ kind: "authoring", status: "submitted" });
    await expect(tool.execute({ ...args, used_asset_ids: [] }, execution(workspace))).rejects.toThrow(/đã có submission khác|used_asset_ids/);

    await rm(join(workspace, "handoff", "authoring.json"), { force: true });
    await writeFile(join(workspace, "handoff", "authoring-request.json"), JSON.stringify({
      version: 1,
      job_id: "job-author",
      request_revision: 2,
      phase: "visual_refine",
      manifest: "project/manifest.json",
      authored_dir: "project/authored",
      assets: [{ id: "logo", ref: "assets/logo.png", role: "logo" }],
    }));
    await expect(tool.execute({ ...args, request_revision: 2 }, execution(workspace))).rejects.toThrow(/reviewed_scene_ids/);
    await expect(tool.execute({
      ...args,
      request_revision: 2,
      reviewed_scene_ids: ["scene-01"],
      review_notes: "Đã mở still thật và kiểm tra asset, hierarchy cùng khoảng trống caption.",
    }, execution(workspace))).resolves.toMatchObject({ kind: "authoring", status: "submitted", request_revision: 2 });
  });

  it("allows an author to use a purposeful subset of the approved asset pool", async () => {
    const { workspace, tools } = await fixture();
    await mkdir(join(workspace, "project", "authored"), { recursive: true });
    await writeFile(join(workspace, "project", "authored", "scene-01.tsx"), "export default {};\n");
    await writeFile(join(workspace, "project", "manifest.json"), JSON.stringify({
      scenes: [{ id: "scene-01", component: "scene-01", image: { ref: "assets/hero.png", role: "hero" } }],
    }));
    await writeFile(join(workspace, "handoff", "authoring-request.json"), JSON.stringify({
      version: 1, job_id: "job-author", request_revision: 1,
      manifest: "project/manifest.json", authored_dir: "project/authored",
      assets: [
        { id: "hero", ref: "assets/hero.png", role: "hero" },
        { id: "logo", ref: "assets/logo.png", role: "logo" },
      ],
    }));

    await expect(tools.get("motionreal_submit_authoring")!.execute({
      job_id: "job-author", request_revision: 1, scene_ids: ["scene-01"], used_asset_ids: ["hero"],
    }, execution(workspace))).resolves.toMatchObject({ kind: "authoring", status: "submitted" });
  });

  it("rejects a descriptive timeline id before persisting an authoring submission", async () => {
    const { workspace, tools } = await fixture();
    await mkdir(join(workspace, "project", "authored"), { recursive: true });
    await writeFile(join(workspace, "project", "authored", "hook.tsx"), "export default {};\n");
    await writeFile(join(workspace, "project", "manifest.json"), JSON.stringify({
      scenes: [{ id: "scene-01-hook", component: "hook" }],
    }));
    await writeFile(join(workspace, "handoff", "authoring-request.json"), JSON.stringify({
      version: 1, job_id: "job-author", request_revision: 1,
      manifest: "project/manifest.json", authored_dir: "project/authored", assets: [],
    }));

    await expect(tools.get("motionreal_submit_authoring")!.execute({
      job_id: "job-author", request_revision: 1, scene_ids: ["scene-01-hook"], used_asset_ids: [],
    }, execution(workspace))).rejects.toThrow(/scene-01, scene-02/);
    await expect(readFile(join(workspace, "handoff", "authoring.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    { name: "a repeated logo enlarged to hero", ref: "assets/logo.png", role: "hero", expected: /trong mọi cảnh sử dụng/ },
    { name: "a repeated logo with its role omitted", ref: "assets/logo.png", role: undefined, expected: /trong mọi cảnh sử dụng/ },
    { name: "an unapproved ref alongside an approved logo", ref: "assets/other.png", role: "logo", expected: /scene-02.*chưa được duyệt/ },
  ])("rejects $name without writing a handoff, then accepts a corrected retry", async ({ ref, role, expected }) => {
    const { workspace, tools } = await fixture();
    await mkdir(join(workspace, "project", "authored"), { recursive: true });
    // Submission checks metadata, while pipeline admission owns TSX execution.
    await writeFile(join(workspace, "project", "authored", "visual.tsx"), "export default {};\n");
    const image = { ref: "assets/logo.png", role: "logo" };
    const first = { id: "scene-01", component: "logo", image };
    const second = { id: "scene-02", component: "repeat", image: { ref, role } };
    await writeFile(join(workspace, "project", "manifest.json"), JSON.stringify({ scenes: [first, second] }));
    await writeFile(join(workspace, "handoff", "authoring-request.json"), JSON.stringify({
      version: 1, job_id: "job-author", request_revision: 1,
      manifest: "project/manifest.json", authored_dir: "project/authored",
      assets: [{ id: "logo", ...image }],
    }));
    const args = { job_id: "job-author", request_revision: 1, scene_ids: ["scene-01", "scene-02"], used_asset_ids: ["logo"] };
    const tool = tools.get("motionreal_submit_authoring")!;
    await expect(tool.execute(args, execution(workspace))).rejects.toThrow(expected);
    await expect(readFile(join(workspace, "handoff", "authoring.json"))).rejects.toMatchObject({ code: "ENOENT" });
    await writeFile(join(workspace, "project", "manifest.json"), JSON.stringify({ scenes: [first, { ...second, image }] }));
    await expect(tool.execute(args, execution(workspace))).resolves.toMatchObject({ status: "submitted" });
  });

  it("does not count a directory ending in .tsx as authored code", async () => {
    const { workspace, tools } = await fixture();
    await mkdir(join(workspace, "project", "authored", "fake.tsx"), { recursive: true });
    await writeFile(join(workspace, "project", "manifest.json"), JSON.stringify({ scenes: [{ id: "scene-01", component: "fake" }] }));
    await writeFile(join(workspace, "handoff", "authoring-request.json"), JSON.stringify({
      version: 1, job_id: "job-author", request_revision: 1,
      manifest: "project/manifest.json", authored_dir: "project/authored", assets: [],
    }));
    await expect(tools.get("motionreal_submit_authoring")!.execute({
      job_id: "job-author", request_revision: 1, scene_ids: ["scene-01"], used_asset_ids: [],
    }, execution(workspace))).rejects.toThrow(/chưa có module/);
    await expect(readFile(join(workspace, "handoff", "authoring.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
