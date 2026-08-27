import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BUNDLED_DEFAULT_BGM_TRACK_NAME,
  addBgmTrack,
  bundledDefaultBgmPath,
  ensureProject,
  PipelineError,
  projectPaths,
  writeJson,
  type RenderProjectResult,
} from "@motionreal/pipeline";
import {
  createTools,
  fullRenderAllowed,
  ingestUrlInput,
  renderFullInput,
  scaffoldProjectInput,
  type ToolDeps,
} from "./create-tools.js";

// internal tools over the orchestrator.

let home: string;
const prevHome = process.env.VIDEO_TOOL_HOME;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "news-tools-"));
  process.env.VIDEO_TOOL_HOME = join(home, ".video-tool");
});

afterEach(async () => {
  process.env.VIDEO_TOOL_HOME = prevHome;
  await rm(home, { recursive: true, force: true });
});

const okConfig: ToolDeps["ttsConfig"] = () => ({ apiKey: "k", voiceId: "v" });
const renderOk = (): RenderProjectResult =>
  ({ projectId: "p", mp4Path: "out.mp4", locked: {} as never, report: { ok: true, issues: [] } as never, cached: false });

describe("draft-first gate — Property 8", () => {
  it("fullRenderAllowed is true exactly when a draft exists OR forceFull", () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (draftExists, forceFull) => {
        expect(fullRenderAllowed(draftExists, forceFull)).toBe(draftExists || forceFull);
      }),
      { numRuns: 100 },
    );
  });

  it("render_full is refused exactly when no draft AND not forceFull (and never delegates then)", async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), fc.boolean(), async (draftExists, forceFull) => {
        let delegated = false;
        const tools = createTools({
          draftExistsFor: () => draftExists,
          ttsConfig: okConfig,
          renderProject: async () => {
            delegated = true;
            return renderOk();
          },
        });
        const res = await tools.render_full({ projectId: "p", forceFull });
        const allowed = draftExists || forceFull;
        expect(res.ok).toBe(allowed);
        expect(delegated).toBe(allowed);
        if (!res.ok) {
          expect(res.error.stage).toBe("render");
          expect(res.error.cause).toMatch(/draft/i);
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe("TTS provider preservation — Property 10", () => {
  it("render_draft/render_full fail naming the missing field and never delegate (no downgrade)", async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), fc.boolean(), fc.constantFrom("draft", "full"), async (hasKey, hasVoice, mode) => {
        fc.pre(!hasKey || !hasVoice); // at least one missing
        let delegated = false;
        const tools = createTools({
          draftExistsFor: () => true, // draft present so the gate isn't the cause
          ttsConfig: () => ({ apiKey: hasKey ? "k" : "", voiceId: hasVoice ? "v" : undefined }),
          renderProject: async () => {
            delegated = true;
            return renderOk();
          },
        });
        const res =
          mode === "draft"
            ? await tools.render_draft({ projectId: "p" })
            : await tools.render_full({ projectId: "p", forceFull: false });
        expect(res.ok).toBe(false);
        if (!res.ok) {
          expect(res.error.stage).toBe("config");
          if (!hasKey) expect(res.error.cause).toMatch(/API_KEY/);
          if (!hasVoice) expect(res.error.cause).toMatch(/VOICE_ID/);
        }
        // never delegated to a render → provider could not have been downgraded
        expect(delegated).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("passes credentials explicitly to the orchestrator instead of relying on process.env", async () => {
    let seen: Parameters<ToolDeps["renderProject"]>[1];
    const tools = createTools({
      ttsConfig: () => ({ apiKey: "closure-key", voiceId: "closure-voice" }),
      renderProject: async (_projectId, opts) => {
        seen = opts;
        return renderOk();
      },
    });

    const result = await tools.render_draft({ projectId: "p" });
    expect(result.ok).toBe(true);
    expect(seen).toMatchObject({ ttsApiKey: "closure-key", voiceId: "closure-voice" });
  });

  it("preserves the ElevenLabs provider, voice and model", async () => {
    let seen: Parameters<ToolDeps["renderProject"]>[1];
    const tools = createTools({
      ttsConfig: () => ({
        provider: "elevenlabs",
        apiKey: "eleven-key",
        voiceId: "eleven-voice",
        modelId: "eleven_multilingual_v2",
      }),
      renderProject: async (_projectId, opts) => {
        seen = opts;
        return renderOk();
      },
    });
    expect((await tools.render_draft({ projectId: "p" })).ok).toBe(true);
    expect(seen).toMatchObject({
      ttsProvider: "elevenlabs",
      ttsApiKey: "eleven-key",
      voiceId: "eleven-voice",
      modelId: "eleven_multilingual_v2",
    });
  });

  it("preserves VieNeu without requiring a fake API key", async () => {
    let seen: Parameters<ToolDeps["renderProject"]>[1];
    const tools = createTools({
      ttsConfig: () => ({
        provider: "vieneu",
        apiKey: "",
        voiceId: "Trúc Ly",
        modelId: "vieneu-runtime",
      }),
      renderProject: async (_projectId, opts) => {
        seen = opts;
        return renderOk();
      },
    });
    expect((await tools.render_draft({ projectId: "p" })).ok).toBe(true);
    expect(seen).toMatchObject({
      ttsProvider: "vieneu",
      ttsApiKey: "",
      voiceId: "Trúc Ly",
      modelId: "vieneu-runtime",
    });
  });

  it("resolves a selected project BGM track into render_draft/render_full options", async () => {
    const src = join(home, "picked.mp3");
    await writeFile(src, Buffer.alloc(32, 1));
    const track = await addBgmTrack(src);
    await ensureProject("p");
    await writeJson(projectPaths("p").manifest, { title: "T", bgm: track.name, scenes: [] });

    const seen: Array<Parameters<ToolDeps["renderProject"]>[1]> = [];
    const tools = createTools({
      draftExistsFor: () => true,
      ttsConfig: okConfig,
      renderProject: async (_projectId, opts) => {
        seen.push(opts);
        return renderOk();
      },
    });

    expect((await tools.render_draft({ projectId: "p" })).ok).toBe(true);
    expect((await tools.render_full({ projectId: "p" })).ok).toBe(true);
    expect(seen.map((opts) => opts?.bgmPath)).toEqual([track.path, track.path]);
  });

  it("resolves the bundled default BGM directly to the app asset without requiring a runtime copy", async () => {
    await ensureProject("p");
    await writeJson(projectPaths("p").manifest, { title: "T", bgm: BUNDLED_DEFAULT_BGM_TRACK_NAME, scenes: [] });

    const seen: Array<Parameters<ToolDeps["renderProject"]>[1]> = [];
    const tools = createTools({
      draftExistsFor: () => true,
      ttsConfig: okConfig,
      renderProject: async (_projectId, opts) => {
        seen.push(opts);
        return renderOk();
      },
    });

    expect((await tools.render_draft({ projectId: "p" })).ok).toBe(true);
    expect(seen[0]?.bgmPath).toBe(bundledDefaultBgmPath());
  });

  it("passes explicit no-music through draft and full instead of allowing the default fallback", async () => {
    await ensureProject("p");
    await writeJson(projectPaths("p").manifest, { title: "T", scenes: [] });

    const seen: Array<Parameters<ToolDeps["renderProject"]>[1]> = [];
    const tools = createTools({
      draftExistsFor: () => true,
      ttsConfig: okConfig,
      renderProject: async (_projectId, opts) => {
        seen.push(opts);
        return renderOk();
      },
    });

    expect((await tools.render_draft({ projectId: "p" })).ok).toBe(true);
    expect((await tools.render_full({ projectId: "p" })).ok).toBe(true);
    expect(seen.map((opts) => opts?.bgmPath)).toEqual([null, null]);
  });
});

describe("full grid in force — Property 9", () => {
  it("a hard grid defect from the orchestrator surfaces as ok:false naming the check (never done)", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom("N1", "N9", "N14", "N18", "N29"), async (check) => {
        const tools = createTools({
          draftExistsFor: () => true,
          ttsConfig: okConfig,
          renderProject: async () => {
            throw new PipelineError({ stage: "static-grid", cause: "hard safety defect", check });
          },
        });
        const res = await tools.render_full({ projectId: "p", forceFull: true });
        expect(res.ok).toBe(false);
        if (!res.ok) {
          expect(res.error.stage).toBe("static-grid");
          expect(res.error.check).toBe(check);
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe("doctor parity — Property 17", () => {
  it("the doctor tool returns exactly the runDoctor report (same source as the CLI)", async () => {
    const report = { ok: false, checks: [{ name: "x", ok: false, detail: "d" }] };
    const tools = createTools({ runDoctor: async () => report as never });
    const res = await tools.doctor();
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual(report);
  });
});

describe("tool input schemas + result shapes — 7.12", () => {
  it("accepts valid inputs and rejects bad ones", () => {
    expect(ingestUrlInput.safeParse({ url: "https://a.test/x" }).success).toBe(true);
    expect(ingestUrlInput.safeParse({ url: "not-a-url" }).success).toBe(false);
    expect(scaffoldProjectInput.safeParse({ prompt: "hi" }).success).toBe(true);
    expect(scaffoldProjectInput.safeParse({ prompt: "hi", format: "tiktok", durationTier: 3 }).success).toBe(true);
    expect(scaffoldProjectInput.safeParse({ prompt: "" }).success).toBe(false);
    expect(scaffoldProjectInput.safeParse({ prompt: "x", duration: 75 }).success).toBe(true);
    expect(scaffoldProjectInput.safeParse({ prompt: "x", duration: 0 }).success).toBe(false);
    expect(scaffoldProjectInput.safeParse({ prompt: "x", durationTier: 4 }).success).toBe(true);
    expect(renderFullInput.safeParse({ projectId: "p", forceFull: true }).success).toBe(true);
  });

  it("scaffold_project passes persisted delivery choices to the orchestrator", async () => {
    let received: Parameters<ToolDeps["scaffoldVideoProject"]>[0] | undefined;
    const tools = createTools({
      scaffoldVideoProject: async (opts) => {
        received = opts;
        return {
          projectId: "p1",
          brief: {} as never,
          manifestPath: "manifest.json",
          authoredDir: "authored",
        };
      },
    });
    const res = await tools.scaffold_project({ prompt: "Random Forest", format: "tiktok", durationTier: 3 });
    expect(res.ok).toBe(true);
    expect(received).toMatchObject({ prompt: "Random Forest", format: "tiktok", durationTier: 3 });
  });

  it("ingest_url failure carries a structured error (ok:false + serialized error)", async () => {
    const tools = createTools({
      ingestUrl: async () => {
        throw new PipelineError({ stage: "ingest", cause: "boom", remediation: "fix it" });
      },
    });
    const res = await tools.ingest_url({ url: "https://a.test/x" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.stage).toBe("ingest");
      expect(res.error.cause).toBe("boom");
      expect(res.error.remediation).toBe("fix it");
    }
  });
});

describe("single-process orchestrator path — 7.13", () => {
  it("scaffold_project then list_projects sees the project (one store/registry path)", async () => {
    const tools = createTools();
    const scaffolded = await tools.scaffold_project({ prompt: "Vì sao chip AI đắt đỏ", projectId: "chip-ai" });
    expect(scaffolded.ok).toBe(true);
    const listed = await tools.list_projects();
    expect(listed.ok).toBe(true);
    if (listed.ok) expect(listed.data.map((p) => p.projectId)).toContain("chip-ai");
  });

});

describe("get_safety_report", () => {
  const reportWith = (issues: Array<{ check: string; severity: "error" | "warning"; message: string }>): RenderProjectResult =>
    ({
      projectId: "p",
      mp4Path: "out.mp4",
      locked: {} as never,
      report: { ok: !issues.some((i) => i.severity === "error"), issues } as never,
      cached: false,
    });

  it("persists the last render's report and returns hard errors split from warnings", async () => {
    const issues = [
      { check: "N14", severity: "error" as const, message: "content in caption band" },
      { check: "N30", severity: "warning" as const, message: "dense scene" },
    ];
    const tools = createTools({
      draftExistsFor: () => true,
      ttsConfig: okConfig,
      renderProject: async () => reportWith(issues),
    });

    const draft = await tools.render_draft({ projectId: "rep-1" });
    expect(draft.ok).toBe(true);

    const res = await tools.get_safety_report({ projectId: "rep-1" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.ok).toBe(false); // a hard error is present
      expect(res.data.hardErrors.map((i) => i.check)).toEqual(["N14"]);
      expect(res.data.warnings.map((i) => i.check)).toEqual(["N30"]);
    }
  });

  it("reports ok:true with no hard errors when the report is clean", async () => {
    const tools = createTools({
      draftExistsFor: () => true,
      ttsConfig: okConfig,
      renderProject: async () => reportWith([{ check: "N30", severity: "warning", message: "advisory" }]),
    });
    await tools.render_draft({ projectId: "rep-2" });
    const res = await tools.get_safety_report({ projectId: "rep-2" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.ok).toBe(true);
      expect(res.data.hardErrors).toEqual([]);
      expect(res.data.warnings).toHaveLength(1);
    }
  });

  it("fails with a structured error when no report exists yet", async () => {
    const tools = createTools();
    const res = await tools.get_safety_report({ projectId: "never-rendered" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.stage).toBe("render-oracle");
      expect(res.error.cause).toMatch(/no safety report/i);
    }
  });
});

describe("render_stills — fast per-scene stills (no TTS)", () => {
  it("returns the rendered stills and needs NO Vivibe config (no TTS)", async () => {
    let calledProjectId: string | undefined;
    const tools = createTools({
      // No ttsConfig override → an absent key would block the MP4 tools; stills
      // must run anyway (they skip the Vivibe guard).
      ttsConfig: () => ({ apiKey: "", voiceId: undefined }),
      renderProjectStills: async (projectId) => {
        calledProjectId = projectId;
        return { projectId, stills: ["/p/review/scene-01.png", "/p/review/scene-02.png"] };
      },
    });
    const res = await tools.render_stills({ projectId: "st-1" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.stills).toHaveLength(2);
    expect(calledProjectId).toBe("st-1");
  });

  it("passes sceneIds through to the pipeline (subset render)", async () => {
    let seenSceneIds: string[] | undefined;
    const tools = createTools({
      renderProjectStills: async (projectId, opts) => {
        seenSceneIds = opts?.sceneIds;
        return { projectId, stills: ["/p/review/scene-02.png"] };
      },
    });
    const res = await tools.render_stills({ projectId: "st-2", sceneIds: ["scene-02"] });
    expect(res.ok).toBe(true);
    expect(seenSceneIds).toEqual(["scene-02"]);
  });

  it("surfaces a pipeline failure as a structured error (never throws)", async () => {
    const tools = createTools({
      renderProjectStills: async () => {
        throw new PipelineError({ stage: "build-gate", cause: "admission rejected scene-01" });
      },
    });
    const res = await tools.render_stills({ projectId: "st-3" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.stage).toBe("build-gate");
      expect(res.error.cause).toMatch(/admission/i);
    }
  });
});
