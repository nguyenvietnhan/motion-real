import { describe, expect, it, vi } from "vitest";
import {
  getSafetyReportWithTools,
  renderDraftWithTools,
  renderStillsWithTools,
} from "./authoring-render-tools.js";

function fakeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  };
}

function baseDeps(tools: Record<string, unknown>) {
  return {
    tools: tools as never,
    loadManifest: vi.fn(async () => ({ scenes: [{ component: "alpha" }] })),
    unregisterComponent: vi.fn(),
    logger: fakeLogger(),
  };
}

describe("authoring render tools", () => {
  it("renderDraft returns engine error on failure", async () => {
    const deps = baseDeps({
      render_draft: vi.fn(async () => ({
        ok: false,
        error: { stage: "render", cause: "boom" },
      })),
    });
    const out = await renderDraftWithTools(deps, "p1");
    expect(out).toEqual({ ok: false, error: { stage: "render", cause: "boom" } });
    expect(deps.logger.error).toHaveBeenCalled();
  });

  it("renderStills preserves the engine error for callers that need to decide retry ownership", async () => {
    const deps = baseDeps({
      render_stills: vi.fn(async () => ({
        ok: false,
        error: { stage: "stills", cause: "nope" },
      })),
    });
    await expect(renderStillsWithTools(deps, "p1", ["scene-01"])).resolves.toEqual({
      stills: [],
      error: { stage: "stills", cause: "nope" },
    });
  });

  it("forwards semantic multi-frame ids without changing ordinary still calls", async () => {
    const renderStills = vi.fn(async () => ({ ok: true, data: { stills: ["scene-02.png", "scene-02.f18.png", "scene-02.f82.png"] } }));
    const deps = baseDeps({ render_stills: renderStills });
    await renderStillsWithTools(deps, "p1", ["scene-02"], undefined, ["scene-02"]);
    expect(renderStills).toHaveBeenCalledWith(
      { projectId: "p1", sceneIds: ["scene-02"], multiFrameSceneIds: ["scene-02"] },
      undefined,
      undefined,
    );
  });

  it("getSafetyReport preserves every hard error reported by the pipeline", async () => {
    const deps = {
      tools: {
        get_safety_report: vi.fn(async () => ({
          ok: true,
          data: {
            hardErrors: [
              { check: "N5", message: "bad" },
              { check: "N10", message: "type error" },
            ],
            warnings: [{ check: "N1", message: "warn" }],
          },
        })),
      } as never,
      logger: fakeLogger(),
    };
    const report = await getSafetyReportWithTools(deps, "p1");
    expect(report.ok).toBe(false);
    expect(report.hardErrors).toEqual([
      { check: "N5", message: "bad" },
      { check: "N10", message: "type error" },
    ]);
    expect(report.warnings).toEqual([{ check: "N1", message: "warn" }]);
  });

  it("getSafetyReport keeps a pipeline hard error even when it has no scene target", async () => {
    const deps = {
      tools: {
        get_safety_report: vi.fn(async () => ({
          ok: true,
          data: {
            hardErrors: [{ check: "N10", message: "type error" }],
            warnings: [],
          },
        })),
      } as never,
      logger: fakeLogger(),
    };
    const report = await getSafetyReportWithTools(deps, "p1");
    expect(report).toEqual({ ok: false, hardErrors: [{ check: "N10", message: "type error" }], warnings: [] });
  });
});
