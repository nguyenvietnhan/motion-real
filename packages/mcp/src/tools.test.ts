import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PipelineError, type RenderProjectResult } from "@news/pipeline";
import {
  createTools,
  fullRenderAllowed,
  ingestUrlInput,
  renderFullInput,
  scaffoldProjectInput,
  trackerAddInput,
  type ToolDeps,
} from "./tools.js";

// Feature: tool-productization — MCP tools over the orchestrator (R3).

let home: string;
const prevHome = process.env.VIDEO_TOOL_HOME;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "news-mcp-"));
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
    expect(scaffoldProjectInput.safeParse({ prompt: "" }).success).toBe(false);
    expect(scaffoldProjectInput.safeParse({ prompt: "x", duration: 75 }).success).toBe(false);
    expect(renderFullInput.safeParse({ projectId: "p", forceFull: true }).success).toBe(true);
    expect(trackerAddInput.safeParse({ url: "https://a.test" }).success).toBe(true);
    expect(trackerAddInput.safeParse({ url: "x" }).success).toBe(false);
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

  it("tracker_add then tracker_list round-trips through the shared store", async () => {
    const trackerPath = join(home, "tracker.json");
    const tools = createTools();
    const added = await tools.tracker_add({ url: "https://a.test/x", title: "T", source: "S", trackerPath });
    expect(added.ok).toBe(true);
    const listed = await tools.tracker_list({ trackerPath });
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      expect(listed.data).toHaveLength(1);
      expect(listed.data[0]!.url).toBe("https://a.test/x");
      expect(listed.data[0]!.status).toBe("pending");
    }
  });
});
