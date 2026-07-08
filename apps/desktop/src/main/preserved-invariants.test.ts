import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createTools,
  type ProjectBrief,
  type RenderProjectResult,
  type ScaffoldVideoProjectResult,
  type ToolDeps,
} from "@motionreal/pipeline";
import { CreateController } from "./create/create-controller.js";

/**
 * Desktop must not bypass pipeline invariants. These tests drive the same
 * `createTools` instance (one registry) and assert draft-before-full, configured
 * provider/voice guard, and no silent TTS downgrade via `tools.render_full`
 * directly — not through removed approve/Review_Edit_Loop controllers.
 */

let home: string;
const prevHome = process.env.VIDEO_TOOL_HOME;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "motionreal-"));
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

describe("preserved engine invariants at the desktop boundary", () => {
  it("full render is refused without a reviewed draft and never delegates (R8.2)", async () => {
    let delegated = false;
    const tools = createTools({
      draftExistsFor: () => false,
      ttsConfig: okConfig,
      renderProject: async () => {
        delegated = true;
        return renderOk();
      },
    });
    // The engine tool itself refuses the full render (draft-first gate) and
    // never delegates to renderProject.
    const direct = await tools.render_full({ projectId: "p", forceFull: false });
    expect(direct.ok).toBe(false);
    expect(delegated).toBe(false);
  });

  it("create routes scaffold through ONE createTools instance — no second registry (R4.6/R8.1)", async () => {
    let scaffolds = 0;
    const tools = createTools({
      scaffoldVideoProject: async (input) => {
        scaffolds++;
        return scaffoldOk(input.projectId ?? "p1");
      },
    });
    const ctrl = new CreateController({
      scaffold: async (prompt) => {
        const res = await tools.scaffold_project({ prompt });
        return res.ok ? { ok: true, projectId: res.data.projectId } : { ok: false, error: res.error };
      },
      beginCreate: () => {},
    });
    const result = await ctrl.create("tin công nghệ");
    expect(result).toEqual({ projectId: "p1" });
    expect(scaffolds).toBe(1);
  });

  it("voice-config-incomplete surfaces the exact missing setting and never downgrades (R8.3/R8.4)", async () => {
    let delegated = false;
    const tools = createTools({
      draftExistsFor: () => true, // gate not the cause
      ttsConfig: () => ({ apiKey: "k", voiceId: undefined }),
      renderProject: async () => {
        delegated = true;
        return renderOk();
      },
    });
    // The exact missing setting is named at the engine/tool level…
    const direct = await tools.render_full({ projectId: "p", forceFull: false });
    expect(direct.ok).toBe(false);
    if (!direct.ok) {
      expect(direct.error.stage).toBe("config");
      expect(direct.error.cause).toMatch(/VOICE_ID/);
    }
    // …and the render is never delegated, so the voice is never downgraded.
    expect(delegated).toBe(false);
  });
});
