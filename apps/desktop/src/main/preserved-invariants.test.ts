import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectBrief, RenderProjectResult, ScaffoldVideoProjectResult } from "@news/pipeline";
import { createTools, type ToolDeps } from "@news/mcp";
import { ApproveController, type FullRenderBackend } from "./review/approve-controller.js";
import { CreateController, type CreateBackend } from "./create/create-controller.js";
import type { AgentWorker, AuthorOutcome } from "./agent/agent-worker.js";

/**
 * Feature: web-dashboard, Task 12.1 — the dashboard never bypasses the engine's
 * preserved invariants. The control plane drives the SAME `@news/mcp` tools
 * through ONE `createTools` instance (one registry), so the draft-first gate,
 * the Vivibe voice guard, and the no-downgrade rule all hold at the boundary.
 * (Req 12.1, 12.5, 12.7, 12.8, 12.10)
 */

let home: string;
const prevHome = process.env.VIDEO_TOOL_HOME;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "news-dash-"));
  process.env.VIDEO_TOOL_HOME = join(home, ".video-tool");
});
afterEach(async () => {
  process.env.VIDEO_TOOL_HOME = prevHome;
  await rm(home, { recursive: true, force: true });
});

const okConfig: ToolDeps["ttsConfig"] = () => ({ apiKey: "k", voiceId: "v" });
const renderOk = (): RenderProjectResult =>
  ({ projectId: "p", mp4Path: "out.mp4", locked: {} as never, report: { ok: true, issues: [] } as never, cached: false });
const scaffoldOk = (projectId: string): ScaffoldVideoProjectResult =>
  ({ projectId, brief: {} as ProjectBrief, manifestPath: "m.json", authoredDir: "authored" });

const stubWorker = (outcome: AuthorOutcome): AgentWorker => ({
  author: async () => outcome,
  reauthorScenes: async (): Promise<AuthorOutcome> => ({ kind: "authored", sceneIds: [] }),
  generateValidateRepair: async () => ({ kind: "passed" as const, attempts: 1 }),
});
const noopHooks = { onProgress() {}, onSceneProduced() {}, onRepair() {} };

describe("Task 12.1: preserved engine invariants at the dashboard boundary", () => {
  it("full render is refused without a reviewed draft and never delegates (Req 12.5)", async () => {
    let delegated = false;
    const tools = createTools({
      draftExistsFor: () => false,
      ttsConfig: okConfig,
      renderProject: async () => {
        delegated = true;
        return renderOk();
      },
    });
    const backend: FullRenderBackend = {
      renderFull: async (projectId, onProgress) => {
        const res = await tools.render_full({ projectId, forceFull: false }, onProgress);
        return res.ok ? { ok: true, outputPath: res.data.mp4Path } : { ok: false, error: res.error };
      },
    };
    const ctrl = new ApproveController(backend);

    // Dashboard gate refuses first…
    expect(await ctrl.approveDraft("p", false)).toEqual({ ok: false, reason: "draft-first" });
    // …and the engine tool itself refuses too (defense in depth), never rendering.
    const direct = await tools.render_full({ projectId: "p", forceFull: false });
    expect(direct.ok).toBe(false);
    expect(delegated).toBe(false);
  });

  it("create routes scaffold through ONE createTools instance — no second registry (Req 12.10)", async () => {
    let scaffolds = 0;
    const tools = createTools({
      scaffoldVideoProject: async (input) => {
        scaffolds++;
        return scaffoldOk(input.projectId ?? "p1");
      },
    });
    const backend: CreateBackend = {
      scaffold: async (prompt) => {
        const res = await tools.scaffold_project({ prompt });
        return res.ok ? { ok: true, projectId: res.data.projectId } : { ok: false, error: res.error };
      },
    };
    const ctrl = new CreateController(backend, stubWorker({ kind: "authored", sceneIds: ["scene-01"] }));
    const result = await ctrl.start({ raw: "tin công nghệ" }, noopHooks, () => {});
    expect(result.ok).toBe(true);
    expect(scaffolds).toBe(1);
  });

  it("voice-config-incomplete surfaces the exact missing setting and never downgrades (Req 12.7/12.8)", async () => {
    let delegated = false;
    const tools = createTools({
      draftExistsFor: () => true, // gate not the cause
      ttsConfig: () => ({ apiKey: "k", voiceId: undefined }),
      renderProject: async () => {
        delegated = true;
        return renderOk();
      },
    });
    // Exact missing setting is named at the engine/tool level…
    const direct = await tools.render_full({ projectId: "p", forceFull: false });
    expect(direct.ok).toBe(false);
    if (!direct.ok) {
      expect(direct.error.stage).toBe("config");
      expect(direct.error.cause).toMatch(/VOICE_ID/);
    }
    // …and the render is never delegated, so the voice is never downgraded.
    expect(delegated).toBe(false);

    // The dashboard surfaces a friendly (redacted) message via the controller.
    const ctrl = new ApproveController({
      renderFull: async (projectId) => {
        const res = await tools.render_full({ projectId, forceFull: false });
        return res.ok ? { ok: true, outputPath: res.data.mp4Path } : { ok: false, error: res.error };
      },
    });
    const outcome = await ctrl.approveDraft("p", true);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok && outcome.reason === "render-failed") {
      expect(outcome.error.message.length).toBeGreaterThan(0);
      expect(outcome.error.message).not.toMatch(/VOICE_ID/); // L0 detail redacted for the UI
    }
  });
});
